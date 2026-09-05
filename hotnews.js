/* ================================================================
   AI Tool Box — 热点雷达（Hot News Radar）v0.25.8
   检索链路（Tavily 驱动）：
     ① AI 按卡片提示词提取 3-5 个核心搜索关键词（含同义词/相关词）
     ② 逐词调用 Tavily 新闻搜索（api.tavily.com，CORS 开放可直连）
     ③ AI 按「时效性(24h优先) / 热度(频次·讨论量) / 影响力(涉及范围)」打分，
        归类为 ≤10 个主题；每条输出 标题/摘要/来源/热度评分
   存储遵循项目惯例：扩展 chrome.storage.local / 网页 localStorage('hn_*')
   ================================================================ */

(function () {
  "use strict";

  // ===== 常量 =====
  var TOP_N = 10;           // 每张卡片最多展示主题数
  var MAX_RESULTS = 8;      // Tavily 每个关键词返回条数
  var TAVILY_URL = 'https://api.tavily.com/search';
  var TAVILY_DAYS = 2;      // 新闻时间窗（天）
  var KEYWORDS_TTL = 30 * 60 * 1000;   // 关键词提取缓存（同提示词 30 分钟复用）
  var SEARCH_TTL = 5 * 60 * 1000;      // Tavily 搜索缓存（同关键词 5 分钟复用）
  var TAVILY_TIMEOUT = 15000;
  var FETCH_TIMEOUT = 12000;
  var TAVILY_KEY = 'hn_tavily_key';
  var keywordCache = {};    // promptKey -> {kws, ts}
  var searchCache = {};     // kwKey -> {items, ts}

  // ===== Storage（扩展 chrome.storage.local / 网页 localStorage，键名 hn_*）=====
  var isExtension = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id);
  var storage = {
    cache: {},
    load: function (keys) {
      var self = this;
      return new Promise(function (resolve) {
        if (isExtension) {
          chrome.storage.local.get(keys, function (r) {
            keys.forEach(function (k) {
              self.cache[k] = r[k];
              // 镜像进 localStorage，供同步读取（tavilyKey()）
              try { if (r[k] !== undefined && r[k] !== null) localStorage.setItem(k, JSON.stringify(r[k])); } catch (e) {}
            });
            resolve();
          });
        } else {
          keys.forEach(function (k) {
            try { self.cache[k] = JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { self.cache[k] = null; }
          });
          resolve();
        }
      });
    },
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
      var self = this;
      return new Promise(function (resolve) {
        Object.keys(obj).forEach(function (k) {
          self.cache[k] = obj[k];
          try { localStorage.setItem(k, JSON.stringify(obj[k])); } catch (e) {}
        });
        if (isExtension) { chrome.storage.local.set(obj, resolve); }
        else { resolve(); }
      });
    }
  };

  // Tavily Key 同步读取（storage.cache 启动预载 + localStorage 兜底）
  function tavilyKey() {
    var v = storage.cache[TAVILY_KEY];
    if (typeof v === 'string' && v.trim()) return v.trim();
    try { v = JSON.parse(localStorage.getItem(TAVILY_KEY) || 'null'); } catch (e) { v = null; }
    return (typeof v === 'string') ? v.trim() : '';
  }

  // ===== 状态 =====
  var cards = [];          // [{id, name, prompt, groups, updatedAt}]，error/loading/keywords 仅内存态
  var editingId = null;

  // ===== 工具 =====
  var $ = function (id) { var el = document.getElementById(id); if (!el) console.error('[HotNews] #' + id + ' not found'); return el; };
  function escapeHtml(s) { var d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function delay(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

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

  // 发布时间简短展示：N小时前 / N天前 / 月日
  function fmtPublished(published) {
    if (!published) return '';
    var d = new Date(published);
    if (isNaN(d.getTime())) return '';
    var diff = Date.now() - d.getTime();
    if (diff < 0) diff = 0;
    if (diff < 3600000) return Math.max(1, Math.floor(diff / 60000)) + '分钟前';
    if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前';
    if (diff < 7 * 86400000) return Math.floor(diff / 86400000) + '天前';
    return (d.getMonth() + 1) + '/' + d.getDate();
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

  // 宽松 JSON 解析：容忍代理附加的 markdown 前后缀
  function parseJsonLoose(text) {
    var t = String(text || '').trim();
    t = t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    var s = t.indexOf('{'), e = t.lastIndexOf('}');
    if (s === -1 || e <= s) throw new Error('非 JSON 响应');
    return JSON.parse(t.slice(s, e + 1));
  }

  // 底层 GET（模型列表兜底通道用）
  function fetchText(url, timeout, headers) {
    var ms = timeout || FETCH_TIMEOUT;
    return new Promise(function (resolve, reject) {
      var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var timer = setTimeout(function () {
        if (ctrl) ctrl.abort();
        reject(new Error('请求超时'));
      }, ms);
      fetch(url, { cache: 'no-store', signal: ctrl ? ctrl.signal : undefined, headers: headers || undefined })
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

  // ===== Tavily 检索层（v0.25.8）=====
  // api.tavily.com CORS 开放（实测预检回显 Origin），网页版与扩展版均可直连，无需代理桥。
  async function fetchJson(url, body, headers) {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, TAVILY_TIMEOUT);
    try {
      var r = await fetch(url, {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}),
        body: JSON.stringify(body),
        cache: 'no-store',
        signal: ctrl ? ctrl.signal : undefined
      });
      if (r.status === 401 || r.status === 403) throw new Error('Tavily Key 无效或无权限（HTTP ' + r.status + '）');
      if (r.status === 429) throw new Error('Tavily 请求过于频繁（429），请稍后重试');
      if (!r.ok) throw new Error('Tavily 服务异常（HTTP ' + r.status + '）');
      return await r.json();
    } catch (e) {
      if (e && e.name === 'AbortError') throw new Error('Tavily 请求超时');
      if (e && /Failed to fetch|NetworkError|Load failed/i.test(String(e.message || ''))) throw new Error('无法连接 Tavily（网络异常），请检查网络后重试');
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  // ① 关键词提取：卡片提示词 → 3-5 个搜索关键词（含同义词/相关词），按提示词缓存
  function extractKeywords(prompt) {
    var key = String(prompt || '').trim().toLowerCase();
    var c = keywordCache[key];
    if (c && Date.now() - c.ts < KEYWORDS_TTL) return Promise.resolve(c.kws);
    if (!window.AiService || typeof window.AiService.chat !== 'function') {
      return Promise.resolve([String(prompt || '').trim().slice(0, 60)]);
    }
    return window.AiService.chat({
      messages: [
        { role: 'system', content: '你是搜索规划助手。根据用户给出的主题，提取 3-5 个适合实时新闻检索的核心搜索关键词（中文与英文混合，覆盖同义词与相关概念）。只输出 JSON 字符串数组，禁止解释或 markdown 代码块。示例：["OpenAI GPT-6","大模型 发布","AI 监管 法案"]' },
        { role: 'user', content: String(prompt) }
      ],
      temperature: 0.2
    }).then(function (text) {
      var t = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
      var s2 = t.indexOf('['), e2 = t.lastIndexOf(']');
      var kws = [];
      if (s2 !== -1 && e2 > s2) {
        try {
          var arr = JSON.parse(t.slice(s2, e2 + 1));
          if (Array.isArray(arr)) kws = arr.filter(function (x) { return x && typeof x === 'string'; }).map(function (x) { return x.trim(); }).slice(0, 5);
        } catch (err) {}
      }
      if (!kws.length) kws = [String(prompt || '').trim().slice(0, 60)]; // 解析失败 → 提示词兜底
      keywordCache[key] = { kws: kws, ts: Date.now() };
      return kws;
    }).catch(function () {
      return [String(prompt || '').trim().slice(0, 60)]; // AI 不可用也能检索
    });
  }

  // ② Tavily 新闻搜索：单关键词 → 候选条目（按关键词缓存）
  function searchOne(kw, apiKey) {
    var ckey = kw.toLowerCase();
    var c = searchCache[ckey];
    if (c && Date.now() - c.ts < SEARCH_TTL) return Promise.resolve(c.items);
    return fetchJson(TAVILY_URL, {
      api_key: apiKey,
      query: kw,
      topic: 'news',
      days: TAVILY_DAYS,
      max_results: MAX_RESULTS,
      search_depth: 'basic',
      include_answer: false
    }).then(function (data) {
      var results = data && Array.isArray(data.results) ? data.results : [];
      var items = results.map(function (r) {
        if (!r || !r.title) return null;
        var src = '';
        try { src = new URL(r.url).hostname.replace(/^www\./, ''); } catch (e) { src = ''; }
        return {
          title: String(r.title),
          summary: String(r.content || '').slice(0, 300),
          url: String(r.url || ''),
          source: src,
          score: typeof r.score === 'number' ? r.score : '',
          published: String(r.published_date || '')
        };
      }).filter(Boolean);
      if (items.length) searchCache[ckey] = { items: items, ts: Date.now() };
      return items;
    });
  }

  // 多关键词并行搜索，按 url 去重合并；全部失败/为空时抛错（带诊断）
  function searchAll(keywords, apiKey) {
    return Promise.allSettled(keywords.map(function (kw) { return searchOne(kw, apiKey); }))
      .then(function (rs) {
        var ok = rs.filter(function (r) { return r.status === 'fulfilled'; });
        if (!ok.length && rs.length) throw (rs[0].reason) || new Error('Tavily 搜索失败');
        var items = [], seen = {};
        ok.forEach(function (r) {
          r.value.forEach(function (it) {
            var k = it.url || it.title;
            if (k && !seen[k]) { seen[k] = 1; items.push(it); }
          });
        });
        if (!items.length) throw new Error('Tavily 未返回相关结果：可尝试放宽或更换提示词');
        return items;
      });
  }

  // ===== AI 分析归类（评分维度：时效性/热度/影响力） =====
  function aiAnalyze(prompt, candidates) {
    if (!window.AiService || typeof window.AiService.chat !== 'function') {
      return Promise.reject(new Error('请先在「大模型接口」中配置 Base URL / API Key / 模型'));
    }
    var payload = candidates.slice(0, 50).map(function (it) {
      return { title: it.title, summary: it.summary, source: it.source, url: it.url, published: it.published, score: it.score };
    });
    var system = '你是一个热点分析助手。用户给出主题提示词与一组 Tavily 全网新闻搜索的候选条目（JSON 数组，字段 title/summary/source/url/published/score）。任务：\n'
      + '1. 按以下三个维度为候选条目打分：\n'
      + '   - 时效性：24 小时内发布的优先（published 字段可判断，缺失视为较旧）\n'
      + '   - 热度：出现频次与讨论量（同一事件被多来源报道视为高热度；score 为搜索引擎相关性参考）\n'
      + '   - 影响力：涉及范围（跨国家/跨行业/受众规模）\n'
      + '2. 与主题弱相关的条目剔除（宁缺毋滥），按维度综合排序；\n'
      + '3. 将保留的条目归类为不超过 ' + TOP_N + ' 个主题（category 用 2-6 字中文标签，如 政策监管/行业动态/产品技术/芯片半导体/融资并购），无明确归属的放「其他」；\n'
      + '4. 每个主题内的条目给出四字段：\n'
      + '   - title：中文标题（外文标题翻译为中文，专有名词与公司/产品名保留原文）\n'
      + '   - summary：不超过 40 字的一句话摘要（依据候选 summary 字段，禁止编造）\n'
      + '   - source：来源域名（保持候选条目 source 原文）\n'
      + '   - heat：0-100 整数热度评分（按 时效40%/热度30%/影响力30% 综合）\n'
      + '   另附 url 与 published 字段保持候选条目原文，不得改写。\n'
      + '只输出 JSON 数组，禁止任何解释或 markdown 代码块标记。格式：\n'
      + '[{"category":"政策监管","items":[{"title":"...","summary":"...","source":"reuters.com","url":"...","published":"...","heat":85}]}]';
    var user = '主题提示词：' + prompt + '\n\n候选条目：\n' + JSON.stringify(payload);
    return window.AiService.chat({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ],
      temperature: 0.2
    }).then(function (text) {
      var groups = extractGroups(text);
      if (!groups.length && !/^\s*\[\s*\]\s*$/.test(String(text || ''))) {
        console.warn('[HotNews] AI 原始返回（解析失败）:', text);
      }
      return groups;
    });
  }

  // 解析分组结果 [{category, items:[{title,summary,source,url,published,heat}]}]
  function extractGroups(text) {
    var t = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    var s2 = t.indexOf('['), e2 = t.lastIndexOf(']');
    if (s2 === -1 || e2 <= s2) return [];
    var slice = t.slice(s2, e2 + 1);
    var arr = null;
    try { arr = JSON.parse(slice); } catch (e) {
      try { arr = JSON.parse(slice.replace(/,\s*([\]}])/g, '$1')); } catch (e2) { arr = null; }
    }
    if (!Array.isArray(arr)) return [];
    var out = [];
    arr.forEach(function (g) {
      if (!g || !Array.isArray(g.items)) return;
      var items = g.items.filter(function (it) { return it && it.title; }).slice(0, TOP_N).map(function (it) {
        return {
          title: String(it.title),
          summary: String(it.summary || ''),
          source: String(it.source || ''),
          url: String(it.url || ''),
          published: String(it.published || ''),
          heat: (typeof it.heat === 'number' && isFinite(it.heat)) ? Math.max(0, Math.min(100, Math.round(it.heat))) : ''
        };
      });
      if (items.length) out.push({ category: String(g.category || '其他'), items: items });
    });
    return out.slice(0, TOP_N);
  }

  // ===== 大模型配置（复用 AiService 配置体系：localStorage translate_config + chrome.storage config，全页互通） =====
  function apiOpenState() { return $('hnApiContent').classList.contains('open'); }

  function toggleApiPanel(open) {
    $('hnApiContent').classList.toggle('open', open);
    $('hnApiIcon').classList.toggle('collapsed', !open);
  }

  function setApiStatus(cfg) {
    var chip = $('hnApiStatus'), text = $('hnApiStatusText');
    if (!chip || !text) return;
    if (cfg && cfg.baseUrl) {
      var host = String(cfg.baseUrl).replace(/^https?:\/\//, '').split('/')[0];
      text.textContent = (cfg.model || '已配置') + ' @ ' + host;
      chip.classList.add('ok');
    } else {
      text.textContent = '未配置';
      chip.classList.remove('ok');
    }
  }

  function fillConfigInputs(cfg) {
    $('hnApiUrl').value = (cfg && cfg.baseUrl) || '';
    $('hnApiKey').value = (cfg && cfg.apiKey) || '';
    $('hnApiModel').value = (cfg && cfg.model) || '';
    setApiStatus(cfg);
  }

  function initConfigUi() {
    var cfg = { baseUrl: '', apiKey: '', model: '' };
    if (window.AiService && typeof window.AiService.getConfig === 'function') {
      cfg = window.AiService.getConfig();
    }
    fillConfigInputs(cfg);
    // 未配置 → 自动展开引导；已配置 → 收起
    toggleApiPanel(!cfg.baseUrl);
    // 其他页面 / 插件弹窗保存配置后，本页状态与表单实时回填
    if (window.AiService && typeof window.AiService.initConfigSync === 'function') {
      window.AiService.initConfigSync(function (c) { fillConfigInputs(c); });
    }
  }

  function saveApiConfig() {
    var baseUrl = $('hnApiUrl').value.trim().replace(/\/+$/, '');
    var apiKey = $('hnApiKey').value.trim();
    var model = $('hnApiModel').value.trim();
    if (!baseUrl || !apiKey || !model) { showToast('Base URL / API Key / 模型 均必填', 'error'); return; }
    if (!/^https?:\/\//i.test(baseUrl)) { showToast('Base URL 需以 http(s):// 开头', 'error'); return; }
    if (window.AiService && typeof window.AiService.saveConfig === 'function') {
      window.AiService.saveConfig({ baseUrl: baseUrl, apiKey: apiKey, model: model });
    }
    setApiStatus({ baseUrl: baseUrl, model: model });
    toggleApiPanel(false);
    showToast('API 配置已保存', 'success');
    // 自动重试此前因未配置而失败的卡片
    cards.forEach(function (c) {
      if (c.error && /请先配置|请先在/.test(c.error) && !c.loading) refreshCard(c);
    });
  }

  function clearApiConfig() {
    if (window.AiService && typeof window.AiService.saveConfig === 'function') {
      window.AiService.saveConfig({ baseUrl: '', apiKey: '', model: '' });
    }
    $('hnApiUrl').value = ''; $('hnApiKey').value = ''; $('hnApiModel').value = '';
    $('hnApiModelList').innerHTML = '';
    setApiStatus(null);
    toggleApiPanel(true);
    showToast('API 配置已清除', 'info');
  }

  // ===== 模型列表获取（GET {baseUrl}/models → datalist 自动补全） =====
  // 阿里云 Token Plan 等网关仅支持特定模型 ID（如 qwen3.6-flash，经典名 qwen-plus 会报 Model not exist）
  function fetchModels() {
    // 归一化复用 AiService.normalizeBaseUrl（清理全角「：／」/ 空白 / 误填重复端点），无 AiService 时退化为仅去尾斜杠
    var _nb = (window.AiService && window.AiService.normalizeBaseUrl) ? window.AiService.normalizeBaseUrl : function (u) { return String(u || '').trim().replace(/\/+$/, ''); };
    var baseUrl = _nb($('hnApiUrl').value);
    var apiKey = $('hnApiKey').value.trim();
    if (!baseUrl || !apiKey) {
      var cfg = (window.AiService && window.AiService.getConfig) ? window.AiService.getConfig() : {};
      baseUrl = baseUrl || _nb(cfg.baseUrl);
      apiKey = apiKey || String(cfg.apiKey || '');
    }
    if (!baseUrl || !apiKey) { showToast('请先填写 Base URL 与 API Key', 'error'); return; }
    if (!/^https?:\/\//i.test(baseUrl)) { showToast('Base URL 需以 http(s):// 开头', 'error'); return; }

    var btn = $('hnApiFetchModels');
    btn.disabled = true; btn.textContent = '获取中…';
    var url = baseUrl + '/models';
    var opts = { headers: { 'Authorization': 'Bearer ' + apiKey } };
    var req;
    // 经 AiService.proxyFetch：网页直连失败时自动走扩展代理桥（Token Plan 等无 CORS 端点网页版也可用）
    if (window.AiService && typeof window.AiService.proxyFetch === 'function') {
      req = window.AiService.proxyFetch(url, opts);
    } else {
      req = fetchText(url, 15000, opts.headers).then(function (t) { return { ok: true, status: 200, text: t }; });
    }
    req.then(function (pr) {
      if (!pr.ok) throw new Error('HTTP ' + pr.status);
      return pr.text().then(function (body) {
        var j = parseJsonLoose(body);
        var arr = j && Array.isArray(j.data) ? j.data : (Array.isArray(j) ? j : []);
        var ids = arr.map(function (m) { return m && (m.id || m.model || m.name); }).filter(Boolean).map(String);
        if (!ids.length) throw new Error('端点未返回模型列表');
        $('hnApiModelList').innerHTML = ids.map(function (id) {
          return '<option value="' + escapeHtml(id) + '"></option>';
        }).join('');
        toggleApiPanel(true);
        showToast('已获取 ' + ids.length + ' 个模型，点击「模型名称」输入框选择（如 ' + ids.slice(0, 3).join(' / ') + '）', 'success');
      });
    }).catch(function (e) {
      var msg = e && e.message ? e.message : '未知错误';
      if (/HTTP 401|HTTP 403/.test(msg)) {
        showToast('获取失败：Key 无效或无权限（' + msg + '）', 'error');
      } else if (/桥接/.test(msg)) {
        showToast('获取失败：该端点未开放跨域且扩展代理桥不可用，请在 Chrome 扩展内操作', 'error');
      } else {
        showToast('获取失败：该端点可能未开放浏览器跨域（如阿里云 Token Plan），请安装并启用扩展后重试', 'error');
      }
    }).then(function () {
      btn.disabled = false; btn.textContent = '获取模型列表';
    });
  }

  // ===== Tavily 配置（网页搜索 Key，存 hn_tavily_key 双端同步） =====
  function setTavilyStatus() {
    var chip = $('hnTavilyStatus'), text = $('hnTavilyStatusText');
    if (!chip || !text) return;
    var key = tavilyKey();
    if (key) {
      text.textContent = '已配置（' + key.slice(0, 8) + '…）';
      chip.classList.add('ok');
    } else {
      text.textContent = '未配置';
      chip.classList.remove('ok');
    }
  }

  function initTavilyUi() {
    var key = tavilyKey();
    var input = $('hnTavilyKey');
    if (input) input.value = key;
    setTavilyStatus();
    toggleTavilyPanel(!key);
  }

  function toggleTavilyPanel(open) {
    var el = $('hnTavilyContent');
    if (el) el.classList.toggle('open', open);
    var icon = $('hnTavilyIcon');
    if (icon) icon.classList.toggle('collapsed', !open);
  }

  function saveTavilyKey() {
    var key = String($('hnTavilyKey').value || '').trim();
    if (!/^tvly-/i.test(key)) { showToast('Tavily Key 格式异常（应以 tvly- 开头，在 tavily.com 免费申请）', 'error'); return; }
    storage.set({ hn_tavily_key: key });
    // 网页 → 扩展反向同步（content.js 中继，映射表见 background.js）
    if (!isExtension) {
      try { (window.top || window).postMessage({ source: 'linguaflow-page', type: 'save-record', key: 'hn_tavily_key', value: key }, '*'); } catch (e) {}
    }
    setTavilyStatus();
    toggleTavilyPanel(false);
    showToast('Tavily Key 已保存', 'success');
    // 自动重试此前因未配置而失败的卡片
    cards.forEach(function (c) {
      if (c.error && /Tavily/.test(c.error) && !c.loading) refreshCard(c);
    });
  }

  function clearTavilyKey() {
    storage.set({ hn_tavily_key: '' });
    if (!isExtension) {
      try { (window.top || window).postMessage({ source: 'linguaflow-page', type: 'save-record', key: 'hn_tavily_key', value: '' }, '*'); } catch (e) {}
    }
    $('hnTavilyKey').value = '';
    setTavilyStatus();
    toggleTavilyPanel(true);
    showToast('Tavily Key 已清除', 'info');
  }

  function testTavily() {
    var key = String($('hnTavilyKey').value || '').trim();
    if (!key) { showToast('请先填写 Tavily API Key', 'error'); return; }
    var btn = $('hnTavilyTest');
    btn.disabled = true; btn.textContent = '测试中…';
    searchOne('AI news', key).then(function (items) {
      showToast('Tavily 连通正常（测试返回 ' + items.length + ' 条结果）', 'success');
    }).catch(function (e) {
      showToast('Tavily 测试失败：' + (e && e.message || e), 'error');
    }).then(function () {
      btn.disabled = false; btn.textContent = '测试';
    });
  }

  // ===== 卡片刷新（Tavily 检索 → AI 分析归类；AI 异常自动重试一次） =====
  function refreshCard(card, isRetry) {
    card.error = '';
    card.loading = true;
    render();
    var tk = tavilyKey();
    if (!tk) {
      card.loading = false;
      card.error = '请先配置 Tavily API Key（网页搜索用，tavily.com 免费注册）';
      toggleTavilyPanel(true);
      render();
      return Promise.resolve();
    }
    return extractKeywords(card.prompt)
      .then(function (kws) { card.keywords = kws; return searchAll(kws, tk); })
      .then(function (candidates) { return aiAnalyze(card.prompt, candidates); })
      .then(function (groups) {
        card.groups = groups;
        card.updatedAt = Date.now();
        card.loading = false;
        card.error = '';
        save();
        render();
      })
      .catch(function (e) {
        var msg = e && e.message ? e.message : '未知错误';
        if (!isRetry && !/数据源|Tavily 未返回|请先/.test(msg)) {
          return refreshCard(card, true); // AI 偶发格式/网络异常自动重试一次
        }
        card.loading = false;
        card.error = msg;
        // 常见失败场景 → 针对性引导
        if (/Tavily Key/.test(msg)) {
          card.error = 'Tavily Key 无效或未配置：请在「网页搜索（Tavily）」中填写有效 Key（tavily.com 免费注册）';
          toggleTavilyPanel(true);
        } else if (/请先在「大模型接口」/.test(msg)) {
          card.error = '请先在「大模型接口」中填写 Base URL / API Key / 模型';
          toggleApiPanel(true);
        } else if (/Model not exist|model_not_found/i.test(msg)) {
          card.error = '模型名不存在：该端点仅支持特定模型 ID，请点击「获取模型列表」查看并重新填写保存';
          toggleApiPanel(true);
        } else if (/网络请求失败/.test(msg)) {
          card.error = msg + '（跨域直连与扩展代理桥均不可用：请确认已安装扩展并在 chrome://extensions 开启「允许访问文件网址」后刷新，或直接在 Chrome 扩展内使用）';
        }
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
    if (!prompt) { showToast('请输入提示词，用于 AI 提取关键词与归类分析', 'error'); return; }
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

    var card = { id: uid(), name: name, prompt: prompt, groups: [], updatedAt: 0 };
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
    var bar = $('hnSettingsPanel');
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
      return { id: c.id, name: c.name, prompt: c.prompt, groups: c.groups || [], updatedAt: c.updatedAt || 0 };
    });
    // 网页 → 扩展反向同步（content.js 中继，映射表见 background.js）
    if (!isExtension) {
      try { (window.top || window).postMessage({ source: 'linguaflow-page', type: 'save-record', key: 'hn_cards', value: plain }, '*'); } catch (e) {}
    }
    return storage.set({ hn_cards: plain });
  }

  // 导出全部卡片到本地 JSON 文件（v0.24.2）
  function exportCards() {
    if (!cards.length) { showToast('还没有卡片', 'info'); return; }
    var fname = 'ai-toolbox-hotnews-cards-' + new Date().toISOString().slice(0, 10) + '.json';
    if (window.AiService && window.AiService.downloadText) {
      window.AiService.downloadText(fname, JSON.stringify(cards, null, 2), 'application/json');
      showToast('卡片已导出', 'success');
    }
  }

  // ===== 渲染 =====
  // 旧数据兼容：无 groups 但有旧版 items 时，包装为单组展示（刷新后覆盖为新格式）
  function cardGroups(c) {
    if (c.groups && c.groups.length) return c.groups;
    if (c.items && c.items.length) {
      return [{
        category: '热点条目',
        items: c.items.map(function (it) {
          return { title: it.title, summary: it.reason || '', source: it.source || '', url: it.url || '', published: '', heat: '' };
        })
      }];
    }
    return [];
  }

  function render() {
    var grid = $('hnGrid');
    if (!grid) return;
    if (!cards.length) {
      grid.innerHTML =
        '<div class="hn-empty">' +
        '<span class="emoji">📡</span>' +
        '<p class="hn-empty-title">还没有热点卡片</p>' +
        '<p class="hn-empty-hint">在上方输入名称与提示词创建第一张卡片，AI 将提取关键词经 Tavily 全网搜索，按时效/热度/影响力归类为 ≤10 个主题</p>' +
        '<p class="hn-empty-config">使用前请配置「网页搜索（Tavily）」Key 与「大模型接口」（Base URL / API Key / Model）</p>' +
        '</div>';
      return;
    }
    grid.innerHTML = cards.map(renderCard).join('');
  }

  function renderCard(c) {
    var groups = cardGroups(c);
    var hasContent = groups.length > 0;

    var html = '';
    html += '<div class="hn-card glass-card" data-id="' + c.id + '">';
    html += '<div class="hn-card-head">';
    html += '<h3 class="hn-card-title">' + escapeHtml(c.name) + '</h3>';
    html += '<span class="hn-tag">' + (hasContent ? groups.length + ' 主题' : 'Top ' + TOP_N) + '</span>';
    html += '</div>';

    if (c.loading) {
      html += '<div class="hn-loading"><div class="hn-spinner"></div><p class="hn-loading-text">AI 正在提取关键词 → Tavily 全网搜索 → 分析归类…</p></div>';
      html += '<div class="hn-skel-wrap">';
      for (var i = 0; i < 6; i++) html += '<div class="hn-skel"></div>';
      html += '</div>';
    } else if (c.error) {
      html += '<div class="hn-error"><p class="hn-error-text">' + escapeHtml(c.error) + '</p>';
      html += '<button class="hn-btn-retry" data-action="retry" data-id="' + c.id + '">↻ 重试</button></div>';
    } else if (!hasContent) {
      html += '<div class="hn-none"><p>未检索到与提示词强相关的热点</p><p style="margin-top:6px">可尝试放宽提示词范围，或点击刷新重新检索</p></div>';
    } else {
      if (c.keywords && c.keywords.length) {
        html += '<div class="hn-kw">搜索词：' + c.keywords.map(function (k) { return '<span>' + escapeHtml(k) + '</span>'; }).join('') + '</div>';
      }
      groups.forEach(function (g) {
        html += '<div class="hn-cat"><span class="hn-cat-name">' + escapeHtml(g.category) + '</span><span class="hn-cat-count">' + g.items.length + ' 条</span></div>';
        html += '<ol class="hn-list">';
        g.items.forEach(function (it, idx) {
          var rank = idx + 1;
          var heat = (typeof it.heat === 'number') ? String(it.heat) : formatHot(it.heat || '');
          var hotCls = '';
          var heatNum = typeof it.heat === 'number' ? it.heat : NaN;
          if (isFinite(heatNum)) hotCls = heatNum >= 85 ? ' r1' : heatNum >= 70 ? ' r2' : heatNum >= 55 ? ' r3' : '';
          var title = escapeHtml(it.title);
          var tip = title + (it.summary ? '（' + escapeHtml(it.summary) + '）' : '');
          html += '<li class="hn-item">';
          html += '<span class="hn-rank' + hotCls + '" title="组内排名，热度 ' + escapeHtml(heat || '-') + '/100">' + rank + '</span>';
          if (it.source) html += '<span class="hn-src">' + escapeHtml(it.source) + '</span>';
          html += '<div class="hn-item-main">';
          if (it.url) {
            html += '<a class="hn-item-title" href="' + escapeHtml(it.url) + '" target="_blank" rel="noopener noreferrer" title="' + tip + '">' + title + '</a>';
          } else {
            html += '<span class="hn-item-title" title="' + tip + '">' + title + '</span>';
          }
          if (it.summary) html += '<span class="hn-item-summary">' + escapeHtml(it.summary) + '</span>';
          html += '</div>';
          if (heat) html += '<span class="hn-item-hot' + hotCls + '" title="综合热度评分（0-100）">' + escapeHtml(heat) + '</span>';
          var pub = fmtPublished(it.published);
          if (pub) html += '<span class="hn-item-time">' + escapeHtml(pub) + '</span>';
          html += '</li>';
        });
        html += '</ol>';
      });
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
    bind('hnExportBtn', 'click', exportCards);
    bind('hnRefreshAllBtn', 'click', refreshAll);

    bind('hnName', 'keydown', function (e) { if (e.key === 'Enter') addOrUpdate(); });
    bind('hnPrompt', 'keydown', function (e) { if (e.key === 'Enter') addOrUpdate(); });
    bind('hnApiHeader', 'click', function () { toggleApiPanel(!apiOpenState()); });
    bind('hnApiSave', 'click', saveApiConfig);
    bind('hnApiClear', 'click', clearApiConfig);
    bind('hnApiFetchModels', 'click', fetchModels);

    bind('hnTavilyHeader', 'click', function () { toggleTavilyPanel(!$('hnTavilyContent').classList.contains('open')); });
    bind('hnTavilySave', 'click', saveTavilyKey);
    bind('hnTavilyTest', 'click', testTavily);
    bind('hnTavilyClear', 'click', clearTavilyKey);

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
        if (area !== 'local') return;
        if (changes.hn_cards && !editingId) reload();
        if (changes.hn_tavily_key) {
          var v = changes.hn_tavily_key.newValue;
          storage.cache[TAVILY_KEY] = v;
          try { if (v) localStorage.setItem(TAVILY_KEY, JSON.stringify(v)); } catch (e) {}
          setTavilyStatus();
          var input = $('hnTavilyKey');
          if (input && typeof v === 'string' && v) input.value = v;
        }
      });
    } else {
      window.addEventListener('storage', function (e) {
        if (e.key === 'hn_cards' && !editingId) reload();
        if (e.key === 'hn_tavily_key') {
          storage.cache[TAVILY_KEY] = null; // 强制 tavilyKey() 重读 localStorage
          setTavilyStatus();
        }
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
      return {
        id: String(c.id), name: String(c.name || '综合热点'), prompt: String(c.prompt),
        groups: Array.isArray(c.groups) ? c.groups : [],
        items: Array.isArray(c.items) ? c.items : [],   // 旧数据兼容（cardGroups 包装展示）
        updatedAt: c.updatedAt || 0
      };
    });
  }

  // ===== Init =====
  storage.load([TAVILY_KEY]).then(function () {
    return reload();
  }).then(function () {
    bindEvents();
    initConfigUi();
    initTavilyUi();
  }).catch(function (e) {
    console.error('[HotNews] init failed:', e);
    bindEvents();
    initConfigUi();
    initTavilyUi();
  });
})();
