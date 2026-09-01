/* ================================================================
   AI Tool Box — 热点雷达（Hot News Radar）v0.22.1
   两段式：真实热榜聚合数据（无需密钥）+ AI 按卡片提示词筛选 Top 10
   数据源回退链：60s 分板块热榜（CORS 开放）→ UApi 热榜（直连/代理）→ 60s 日报
   存储遵循项目惯例：扩展 chrome.storage.local / 网页 localStorage('hn_*')
   ================================================================ */

(function () {
  "use strict";

  // ===== 常量 =====
  var TOP_N = 10;           // 每张卡片展示条数
  var PER_BOARD = 12;       // 候选池中每个板块最多取多少条
  var POOL_TTL = 60 * 1000; // 候选池复用时长（60s 内刷新卡片不重复抓取）
  var MIN_POOL = 20;        // 候选池最低条数（少于则视为该通道失败）

  // 主数据源：UApi 全网热榜（逐板块抓取，字段 {type, list:[{index,title,url,hot_value}]}）
  var UAPIS_BASE = 'https://uapis.cn/api/v1/misc/hotboard?type=';
  var BOARDS = [
    { type: 'weibo',    name: '微博' },
    { type: 'zhihu',    name: '知乎' },
    { type: 'baidu',    name: '百度' },
    { type: 'douyin',   name: '抖音' },
    { type: 'bilibili', name: 'B站' },
    { type: 'toutiao',  name: '头条' },
    { type: 'ithome',   name: 'IT之家' },
    { type: '36kr',     name: '36氪' },
    { type: 'sspai',    name: '少数派' },
    { type: 'qq-news',  name: '腾讯新闻' }
  ];
  // 兜底数据源：60s 日报（CORS 开放，稳定可用；真实每日新闻，无热度值）
  var FALLBACK_60S = 'https://60s.viki.moe/v2/60s';
  var FETCH_TIMEOUT = 12000;

  // ===== Storage（扩展 chrome.storage.local / 网页 localStorage，键名 hn_*）=====
  var isExtension = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id);
  var storage = {
    get: function (keys) {
      return new Promise(function (resolve) {
        if (isExtension) { chrome.storage.local.get(keys, resolve); }
        else {
          var r = {};
          keys.forEach(function (k) {
            try { r[k] = JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { r[k] = null; }
          });
          resolve(r);
        }
      });
    },
    set: function (obj) {
      return new Promise(function (resolve) {
        if (isExtension) { chrome.storage.local.set(obj, resolve); }
        else {
          Object.keys(obj).forEach(function (k) { localStorage.setItem(k, JSON.stringify(obj[k])); });
          resolve();
        }
      });
    }
  };

  // ===== 状态 =====
  var cards = [];          // [{id, name, prompt, items, updatedAt}]，error/loading 仅内存态
  var editingId = null;
  var pool = null;         // { items: [{title, source, hot, url}], fetchedAt, source }
  var poolPromise = null;

  // ===== 工具 =====
  var $ = function (id) { var el = document.getElementById(id); if (!el) console.error('[HotNews] #' + id + ' not found'); return el; };
  function escapeHtml(s) { var d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  function formatHot(v) {
    if (v === undefined || v === null || v === '') return '';
    if (typeof v === 'number' || /^\d+(\.\d+)?$/.test(String(v))) {
      var n = Number(v);
      if (!isFinite(n)) return String(v);
      if (n >= 1e8) return (n / 1e8).toFixed(1).replace(/\.0$/, '') + '亿';
      if (n >= 1e4) return (n / 1e4).toFixed(1).replace(/\.0$/, '') + '万';
      return String(n);
    }
    return String(v); // 已是 "254.3万" 等预格式化文本
  }

  function timeAgo(ts) {
    if (!ts) return '未更新';
    var s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return '刚刚更新';
    if (s < 3600) return Math.floor(s / 60) + ' 分钟前更新';
    if (s < 86400) return Math.floor(s / 3600) + ' 小时前更新';
    return Math.floor(s / 86400) + ' 天前更新';
  }

  function showToast(msg, type) {
    var t = $('hnToast'); if (!t) return;
    t.textContent = msg; t.className = 'toast ' + (type || 'success') + ' show';
    clearTimeout(t._t); t._t = setTimeout(function () { t.classList.remove('show'); }, 2800);
  }

  // ===== 底层请求（超时 + 文本返回） =====
  function fetchText(url, timeout) {
    var ms = timeout || FETCH_TIMEOUT;
    return new Promise(function (resolve, reject) {
      var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var timer = setTimeout(function () {
        if (ctrl) ctrl.abort();
        reject(new Error('请求超时'));
      }, ms);
      fetch(url, { cache: 'no-store', signal: ctrl ? ctrl.signal : undefined })
        .then(function (r) {
          clearTimeout(timer);
          if (!r.ok) { reject(new Error('HTTP ' + r.status)); return; }
          return r.text();
        })
        .then(function (t) { if (t !== undefined) resolve(t); })
        .catch(function (e) {
          clearTimeout(timer);
          reject(new Error(e && e.name === 'AbortError' ? '请求超时' : '无法连接'));
        });
    });
  }

  // 宽松 JSON 解析：容忍代理附加的 markdown 前后缀
  function parseJsonLoose(text) {
    var t = String(text || '').trim();
    t = t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    var s = t.indexOf('{'), e = t.lastIndexOf('}');
    if (s === -1 || e <= s) throw new Error('非 JSON 响应');
    return JSON.parse(t.slice(s, e + 1));
  }

  // allorigins /get 变体：{ contents: "<上游 JSON 字符串>" }
  function parseContents(text) {
    var j = JSON.parse(String(text));
    if (j && typeof j.contents === 'string') return JSON.parse(j.contents);
    return j;
  }

  // ===== 数据源回退链（v0.22.1）=====
  // 源1 60s 分板块热榜（CORS 开放，网页/扩展均可直连）→ 源2 UApi 直连（扩展免跨域）
  // → 源3-5 公共 CORS 代理 → UApi（网页版回退）→ 源6 60s 日报兜底（真实每日新闻）
  function delay(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function boardName(type) {
    for (var i = 0; i < BOARDS.length; i++) {
      if (BOARDS[i].type === type) return BOARDS[i].name;
    }
    return type;
  }

  // 60s 分板块热榜解析（字段别名防御：hot_value / hot_value_desc / hot，link / url）
  function parse60sBoard(text, type) {
    var j = parseJsonLoose(text);
    var arr = j && Array.isArray(j.data) ? j.data : [];
    return arr.map(function (it) {
      if (!it || !it.title) return null;
      return {
        title: String(it.title),
        source: boardName(type),
        hot: (it.hot_value !== undefined ? it.hot_value : (it.hot_value_desc !== undefined ? it.hot_value_desc : (it.hot !== undefined ? it.hot : ''))),
        url: String(it.link || it.url || '')
      };
    }).filter(Boolean);
  }

  // 源 1：60s 分板块热榜。官方限速较严：串行抓取 + 429 退避重试一次
  function fetch60sBoards() {
    var boards60 = ['weibo', 'zhihu', 'douyin', 'toutiao', 'ithome', '36kr'];
    var items = [];
    var chain = Promise.resolve();
    boards60.forEach(function (type, i) {
      chain = chain.then(function () {
        function once() {
          return fetchText('https://60s.viki.moe/v2/' + type, 10000).then(function (text) {
            items = items.concat(parse60sBoard(text, type));
          });
        }
        return delay(i ? 250 : 0).then(once).catch(function (e) {
          if (/HTTP 429/.test(e.message)) {
            return delay(900).then(once).catch(function () {});
          }
        });
      });
    });
    return chain.then(function () {
      if (items.length < MIN_POOL) throw new Error('可用板块不足');
      return items;
    });
  }

  // 源 2：UApi 直连（扩展 host_permissions 免跨域；网页版该通道会被 CORS 拦截，自动落入代理通道）
  var DIRECT_STRATEGY = { name: 'UApi直连', timeout: FETCH_TIMEOUT, wrap: function (u) { return u; }, parse: parseJsonLoose };

  // 源 3-5：公共 CORS 代理 → UApi（网页版回退通道；不同代理在不同网络环境下可用性不同）
  function buildProxyStrategies() {
    return [
      { name: '代理A', timeout: 15000, wrap: function (u) { return 'https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(u); }, parse: parseJsonLoose },
      { name: '代理B', timeout: 15000, wrap: function (u) { return 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u); }, parse: parseJsonLoose },
      { name: '代理C', timeout: 25000, wrap: function (u) { return 'https://r.jina.ai/' + u; }, parse: parseJsonLoose },
      { name: '代理D', timeout: 15000, wrap: function (u) { return 'https://api.allorigins.win/get?url=' + encodeURIComponent(u); }, parse: parseContents }
    ];
  }

  // 经指定通道抓取全部板块（并行，个别板块失败可容忍）
  function fetchBoardsVia(st) {
    return Promise.all(BOARDS.map(function (b) {
      return fetchText(st.wrap(UAPIS_BASE + encodeURIComponent(b.type)), st.timeout)
        .then(function (text) {
          var json = st.parse(text);
          var list = json && Array.isArray(json.list) ? json.list : [];
          var name = (json && json.type && boardName(json.type)) || b.name;
          return list.slice(0, PER_BOARD).map(function (it) {
            if (!it || !it.title) return null;
            return {
              title: String(it.title),
              source: String(name),
              hot: (it.hot_value !== undefined ? it.hot_value : (it.hot !== undefined ? it.hot : '')),
              url: String(it.url || '')
            };
          }).filter(Boolean);
        })
        .catch(function () { return []; });
    })).then(function (groups) {
      var items = [];
      groups.forEach(function (g) { items = items.concat(g); });
      if (items.length < MIN_POOL) throw new Error('该通道可用板块不足');
      return items;
    });
  }

  // 源 6：60s 日报兜底（真实每日新闻，无热度值与链接）
  function fetch60sDaily() {
    return fetchText(FALLBACK_60S, FETCH_TIMEOUT).then(function (text) {
      var j = JSON.parse(text);
      var news = j && j.data && Array.isArray(j.data.news) ? j.data.news : [];
      if (!news.length) throw new Error('兜底数据源返回空');
      return news.map(function (t) {
        return { title: String(t), source: '60s日报', hot: '', url: '' };
      });
    });
  }

  // ===== 候选池抓取（数据源回退链） =====
  function fetchPool(force) {
    if (pool && !force && Date.now() - pool.fetchedAt < POOL_TTL) return Promise.resolve(pool);
    if (poolPromise && !force) return poolPromise;

    var runners = [
      { name: '60s热榜', run: fetch60sBoards },
      { name: 'UApi直连', run: function () { return fetchBoardsVia(DIRECT_STRATEGY); } }
    ];
    buildProxyStrategies().forEach(function (st) {
      runners.push({ name: st.name, run: function () { return fetchBoardsVia(st); } });
    });
    runners.push({ name: '60s日报', run: fetch60sDaily });

    var idx = 0;
    function attempt() {
      if (idx >= runners.length) throw new Error('所有数据源暂不可用（接口限制或网络异常），请稍后重试');
      var r = runners[idx++];
      return r.run().then(function (items) {
        pool = { items: items, fetchedAt: Date.now(), source: r.name };
        poolPromise = null;
        return pool;
      }).catch(function (e) {
        console.warn('[HotNews] 数据源 ' + r.name + ' 失败:', e && e.message);
        return attempt();
      });
    }
    poolPromise = attempt();
    return poolPromise;
  }

  // ===== AI 筛选 =====
  function aiSelect(prompt, poolItems) {
    if (!window.AiService || typeof window.AiService.chat !== 'function') {
      return Promise.reject(new Error('AiService 未加载，请刷新页面'));
    }
    var payload = poolItems.map(function (it) {
      return { title: it.title, source: it.source, hot: it.hot, url: it.url };
    });
    var system = '你是全网热点新闻筛选助手。用户给出主题提示词与一组来自各平台热榜的候选条目（JSON 数组）。'
      + '请筛选出与主题最相关的条目并排序：相关性优先，相关性相近时按热度从高到低；恰好输出 ' + TOP_N + ' 条，若相关条目不足 ' + TOP_N + ' 条，用候选池中综合热度最高的其他条目补足；'
      + '标题、来源、热度、链接必须保持候选条目原文，不得改写或编造；hot 为空的条目保持为空。'
      + '只输出 JSON 数组，禁止输出任何解释、前后缀或 markdown 代码块标记。输出格式：'
      + '[{"title":"原文标题","source":"来源平台","hot":"热度值","url":"原文链接"}]';
    var user = '主题提示词：' + prompt + '\n\n候选条目：\n' + JSON.stringify(payload);
    return window.AiService.chat({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ],
      temperature: 0.2
    }).then(function (text) {
      var items = extractJsonItems(text);
      if (!items.length) throw new Error('AI 返回格式异常，未解析到条目');
      return items.slice(0, TOP_N);
    });
  }

  function extractJsonItems(text) {
    var t = String(text || '').trim();
    t = t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    var start = t.indexOf('['), end = t.lastIndexOf(']');
    if (start === -1 || end === -1 || end <= start) return [];
    var arr;
    try { arr = JSON.parse(t.slice(start, end + 1)); } catch (e) { return []; }
    if (!Array.isArray(arr)) return [];
    return arr.filter(function (it) { return it && it.title; }).map(function (it) {
      return { title: String(it.title), source: String(it.source || ''), hot: it.hot, url: String(it.url || '') };
    });
  }

  // ===== 卡片刷新（抓取 + AI 筛选；AI 异常自动重试一次） =====
  function refreshCard(card, isRetry) {
    card.error = '';
    card.loading = true;
    render();
    return fetchPool().then(function (p) {
      return aiSelect(card.prompt, p.items);
    }).then(function (items) {
      card.items = items;
      card.updatedAt = Date.now();
      card.loading = false;
      card.error = '';
      save();
      render();
    }).catch(function (e) {
      var msg = e && e.message ? e.message : '未知错误';
      var isPoolError = /数据源/.test(msg);
      if (!isRetry && !isPoolError) {
        return refreshCard(card, true); // AI 偶发格式/网络异常自动重试一次
      }
      card.loading = false;
      card.error = msg;
      render();
    });
  }

  function refreshCardById(id) {
    var c = cards.find(function (x) { return x.id === id; });
    if (c && !c.loading) refreshCard(c);
  }

  function refreshAll() {
    if (!cards.length) { showToast('还没有卡片', 'info'); return; }
    showToast('正在刷新全部卡片…', 'info');
    cards.reduce(function (p, c) { return p.then(function () { return refreshCard(c); }); }, Promise.resolve());
  }

  // ===== CRUD =====
  function addOrUpdate() {
    var nameEl = $('hnName'), promptEl = $('hnPrompt');
    var name = nameEl.value.trim();
    var prompt = promptEl.value.trim();
    if (!prompt) { showToast('请输入提示词，用于 AI 归类筛选', 'error'); return; }
    if (!name) name = '综合热点';

    if (editingId) {
      var c = cards.find(function (x) { return x.id === editingId; });
      if (c) {
        c.name = name; c.prompt = prompt;
        editingId = null;
        resetForm();
        save(); render();
        showToast('卡片已更新，正在重新检索…', 'info');
        refreshCard(c);
        return;
      }
      editingId = null;
    }

    var card = { id: uid(), name: name, prompt: prompt, items: [], updatedAt: 0 };
    cards.unshift(card);
    resetForm();
    save(); render();
    showToast('卡片已创建，AI 正在检索…', 'info');
    refreshCard(card);
  }

  function editCard(id) {
    var c = cards.find(function (x) { return x.id === id; });
    if (!c) return;
    editingId = id;
    $('hnName').value = c.name;
    $('hnPrompt').value = c.prompt;
    var btn = $('hnAddBtn');
    btn.textContent = '✓ 更新卡片';
    btn.classList.add('editing');
    var bar = $('hnCreatePanel');
    if (bar && bar.scrollIntoView) bar.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    $('hnName').focus();
  }

  function deleteCard(id) {
    cards = cards.filter(function (x) { return x.id !== id; });
    if (editingId === id) { editingId = null; resetForm(); }
    save(); render();
    showToast('卡片已删除', 'success');
  }

  function resetForm() {
    $('hnName').value = '';
    $('hnPrompt').value = '';
    var btn = $('hnAddBtn');
    btn.textContent = '＋ 添加卡片';
    btn.classList.remove('editing');
  }

  // ===== 持久化（剥离内存态字段） =====
  function save() {
    var plain = cards.map(function (c) {
      return { id: c.id, name: c.name, prompt: c.prompt, items: c.items || [], updatedAt: c.updatedAt || 0 };
    });
    return storage.set({ hn_cards: plain });
  }

  // ===== 渲染 =====
  function render() {
    var grid = $('hnGrid');
    if (!grid) return;
    if (!cards.length) {
      grid.innerHTML =
        '<div class="hn-empty">' +
        '<span class="emoji">📡</span>' +
        '<p class="hn-empty-title">还没有热点卡片</p>' +
        '<p class="hn-empty-hint">在上方输入名称与提示词创建第一张卡片，AI 将按提示词从全网热榜中筛选 Top 10</p>' +
        '<p class="hn-empty-config">使用前请确认已在翻译页或插件弹窗配置 API（Base URL / API Key / Model）</p>' +
        '</div>';
      return;
    }
    grid.innerHTML = cards.map(renderCard).join('');
  }

  function renderCard(c) {
    var html = '';
    html += '<div class="hn-card glass-card" data-id="' + c.id + '">';
    html += '<div class="hn-card-head">';
    html += '<h3 class="hn-card-title">' + escapeHtml(c.name) + '</h3>';
    html += '<span class="hn-tag">Top ' + TOP_N + '</span>';
    html += '</div>';

    if (c.loading) {
      html += '<div class="hn-loading"><div class="hn-spinner"></div><p class="hn-loading-text">AI 正在全网检索…</p></div>';
      html += '<div class="hn-skel-wrap">';
      for (var i = 0; i < 6; i++) html += '<div class="hn-skel"></div>';
      html += '</div>';
    } else if (c.error) {
      html += '<div class="hn-error"><p class="hn-error-text">' + escapeHtml(c.error) + '</p>';
      html += '<button class="hn-btn-retry" data-action="retry" data-id="' + c.id + '">↻ 重试</button></div>';
    } else if (!c.items || !c.items.length) {
      html += '<div class="hn-none"><p>暂无数据，点击下方刷新按钮检索</p></div>';
    } else {
      html += '<ol class="hn-list">';
      c.items.forEach(function (it, idx) {
        var rank = idx + 1;
        var hot = formatHot(it.hot);
        var title = escapeHtml(it.title);
        html += '<li class="hn-item">';
        html += '<span class="hn-rank r' + rank + '">' + rank + '</span>';
        if (it.source) html += '<span class="hn-src">' + escapeHtml(it.source) + '</span>';
        if (it.url) {
          html += '<a class="hn-item-title" href="' + escapeHtml(it.url) + '" target="_blank" rel="noopener noreferrer" title="' + title + '">' + title + '</a>';
        } else {
          html += '<span class="hn-item-title" title="' + title + '">' + title + '</span>';
        }
        if (hot) html += '<span class="hn-item-hot">' + escapeHtml(hot) + '</span>';
        html += '</li>';
      });
      html += '</ol>';
    }

    html += '<div class="hn-card-foot">';
    html += '<span class="hn-time">' + (c.loading ? '检索中…' : escapeHtml(timeAgo(c.updatedAt))) + '</span>';
    html += '<div class="hn-actions">';
    html += '<button class="hn-icon-btn hn-refresh" data-action="refresh" data-id="' + c.id + '" title="刷新（AI 重新检索）"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg></button>';
    html += '<button class="hn-icon-btn hn-edit" data-action="edit" data-id="' + c.id + '" title="编辑卡片"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>';
    html += '<button class="hn-icon-btn hn-del" data-action="del" data-id="' + c.id + '" title="删除卡片"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>';
    html += '</div></div>';
    html += '</div>';
    return html;
  }

  // ===== 事件绑定（委托，零内联事件，MV3 CSP 兼容） =====
  function bindEvents() {
    bind('hnAddBtn', 'click', addOrUpdate);
    bind('hnRefreshAllBtn', 'click', refreshAll);
    bind('hnName', 'keydown', function (e) { if (e.key === 'Enter') addOrUpdate(); });
    bind('hnPrompt', 'keydown', function (e) { if (e.key === 'Enter') addOrUpdate(); });

    var grid = $('hnGrid');
    if (grid) {
      grid.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-action]');
        if (!btn) return;
        var id = btn.getAttribute('data-id');
        var action = btn.getAttribute('data-action');
        if (action === 'refresh' || action === 'retry') refreshCardById(id);
        else if (action === 'edit') editCard(id);
        else if (action === 'del') deleteCard(id);
      });
    }

    // 跨页同步：其他页面创建/修改卡片后自动刷新列表
    if (isExtension) {
      chrome.storage.onChanged.addListener(function (changes, area) {
        if (area === 'local' && changes.hn_cards && !editingId) reload();
      });
    } else {
      window.addEventListener('storage', function (e) {
        if (e.key === 'hn_cards' && !editingId) reload();
      });
    }
  }

  function bind(id, evt, fn) { var el = $(id); if (el) el.addEventListener(evt, fn); }

  function reload() {
    return storage.get(['hn_cards']).then(function (data) {
      cards = sanitize(data.hn_cards);
      render();
    });
  }

  function sanitize(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.filter(function (c) { return c && c.id && c.prompt; }).map(function (c) {
      return { id: String(c.id), name: String(c.name || '综合热点'), prompt: String(c.prompt), items: Array.isArray(c.items) ? c.items : [], updatedAt: c.updatedAt || 0 };
    });
  }

  // ===== Init =====
  reload().then(bindEvents).catch(function (e) {
    console.error('[HotNews] init failed:', e);
    bindEvents();
  });
})();
