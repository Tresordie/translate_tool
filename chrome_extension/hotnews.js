/* ================================================================
   AI Tool Box — 热点雷达（Hot News Radar）v0.22.0
   两段式：真实热榜聚合数据（无需密钥）+ AI 按卡片提示词筛选 Top 10
   存储遵循项目惯例：扩展 chrome.storage.local / 网页 localStorage('hn_*')
   ================================================================ */

(function () {
  "use strict";

  // ===== 常量 =====
  var HOTLIST_API = 'https://api.vvhan.com/api/hotlist/all';
  var TOP_N = 10;          // 每张卡片展示条数
  var PER_BOARD = 12;      // 候选池中每个板块最多取多少条
  var POOL_TTL = 60 * 1000;// 候选池复用时长（60s 内刷新卡片不重复抓取）

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
  var cards = [];          // [{id, name, prompt, items, updatedAt}]，error 仅内存态
  var editingId = null;
  var pool = null;         // { items: [{title, source, hot, url}], fetchedAt }
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

  // ===== 候选池抓取 =====
  function fetchPool(force) {
    if (pool && !force && Date.now() - pool.fetchedAt < POOL_TTL) return Promise.resolve(pool);
    if (poolPromise && !force) return poolPromise;
    poolPromise = fetch(HOTLIST_API, { cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error('热榜接口 HTTP ' + r.status);
        return r.json();
      })
      .then(function (json) {
        var items = parseAllResponse(json);
        if (!items.length) throw new Error('热榜接口返回空数据');
        pool = { items: items, fetchedAt: Date.now() };
        poolPromise = null;
        return pool;
      })
      .catch(function (e) {
        poolPromise = null;
        throw new Error('热榜抓取失败：' + (e && e.message ? e.message : '网络异常'));
      });
    return poolPromise;
  }

  // 防御性解析：兼容 data 为数组（[{type,name,color,data:[...]}]）或对象（{weibo:[...]}/{weibo:{data:[...]}}）
  function parseAllResponse(json) {
    var d = json && (json.data !== undefined ? json.data : (json.list !== undefined ? json.list : null));
    var boards = [];
    if (Array.isArray(d)) {
      boards = d;
    } else if (d && typeof d === 'object') {
      boards = Object.keys(d).map(function (k) {
        var v = d[k];
        if (Array.isArray(v)) return { name: k, data: v };
        if (v && typeof v === 'object') { if (!v.name) v.name = k; return v; }
        return null;
      }).filter(Boolean);
    }
    var items = [];
    boards.forEach(function (b) {
      if (!b) return;
      var name = b.name || b.title || b.type || '热榜';
      var list = Array.isArray(b.data) ? b.data
        : (Array.isArray(b.hotlist) ? b.hotlist
        : (Array.isArray(b.list) ? b.list : []));
      list.slice(0, PER_BOARD).forEach(function (it) {
        if (!it) return;
        var title = it.title || it.name || it.word;
        if (!title) return;
        items.push({
          title: String(title),
          source: String(name),
          hot: (it.hot !== undefined ? it.hot : (it.hot_value !== undefined ? it.hot_value : '')),
          url: String(it.url || it.link || it.mobileUrl || '')
        });
      });
    });
    return items;
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
      + '标题、来源、热度、链接必须保持候选条目原文，不得改写或编造。'
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
      var isPoolError = /热榜抓取失败/.test(msg);
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
