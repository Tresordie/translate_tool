// ================================================================
// LinguaFlow — 数据云同步客户端 v0.30.0（所有页面引入）
// 职责：把本页可见的浏览器数据（localStorage 全量；扩展环境另并入
//       chrome.storage.local）推给本机 wechat_scheduler 服务，由服务
//       落本地 + 同步到云端（Git 私有仓库双推 / 网盘文件夹镜像）。
//       恢复入口为「☁」胶囊抽屉（cloud-sync.js）。
// 红线：客户端与服务端双重脱密——API Key / 访问口令 / Tavily Key 永不上传。
// 静默原则：服务没开/不可达时完全无感，不打扰、不弹错。
// ================================================================
(function (global) {
  'use strict';

  var isExtension = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id);
  var PUSH_DEBOUNCE = 4000;      // 页面加载后延迟推送
  var HEARTBEAT_MS = 60000;      // 周期兜底
  var AVAIL_TTL = 30000;         // 服务可用性缓存
  var SECRET_DROP = { ws_api_token: 1, hn_tavily_key: 1, apiConfig: 0 }; // 口令/旧 Tavily Key 整键剔除；apiConfig 保留但去 apiKey
  var SECRET_FIELD = { translate_config: 1, config: 1 };

  var avail = { ok: false, at: 0 };
  var timer = null;

  function base() {
    var b = null;
    try { b = JSON.parse(localStorage.getItem('ws_api_base') || 'null'); } catch (e) {}
    if (b) return String(b).replace(/\/+$/, '');
    if (location.protocol === 'http:' || location.protocol === 'https:') return location.origin;
    return 'http://127.0.0.1:8765';
  }
  function token() {
    try { return JSON.parse(localStorage.getItem('ws_api_token') || 'null') || ''; } catch (e) { return ''; }
  }

  function stripSecrets(state) {
    for (var k in SECRET_DROP) if (SECRET_DROP[k]) delete state[k];
    Object.keys(SECRET_FIELD).forEach(function (k) {
      var v = state[k];
      if (v == null) return;
      var isStr = typeof v === 'string';
      var obj = null;
      if (isStr) { try { obj = JSON.parse(v); } catch (e) { return; } } else obj = v;
      if (obj && typeof obj === 'object' && obj.apiKey) {
        obj = Object.assign({}, obj, { apiKey: '' });
        state[k] = isStr ? JSON.stringify(obj) : obj;
      }
    });
    return state;
  }

  function collect() {
    var state = {};
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k) state[k] = localStorage.getItem(k);
      }
    } catch (e) {}
    return stripSecrets(state);
  }

  function collectExtension(cb) {
    var state = collect();
    if (!isExtension) { cb(state); return; }
    try {
      chrome.storage.local.get(null, function (res) {
        Object.keys(res || {}).forEach(function (k) {
          var v = res[k];
          state[k] = typeof v === 'string' ? v : JSON.stringify(v);
        });
        cb(stripSecrets(state));
      });
    } catch (e) { cb(state); }
  }

  function ping(cb) {
    if (avail.ok && Date.now() - avail.at < AVAIL_TTL) { cb(true); return; }
    var ctl = new AbortController();
    var tm = setTimeout(function () { ctl.abort(); }, 2500);
    fetch(base() + '/api/status', { signal: ctl.signal }).then(function (r) {
      clearTimeout(tm);
      avail = { ok: r.ok, at: Date.now() };
      cb(r.ok);
    }).catch(function () { clearTimeout(tm); avail = { ok: false, at: Date.now() }; cb(false); });
  }

  function push() {
    ping(function (ok) {
      if (!ok) return;
      collectExtension(function (state) {
        var headers = { 'Content-Type': 'application/json' };
        if (token()) headers['X-Api-Token'] = token();
        fetch(base() + '/api/browser-data', {
          method: 'POST', headers: headers, body: JSON.stringify({ state: state })
        }).catch(function () { avail.ok = false; });
      });
    });
  }

  function schedulePush() {
    clearTimeout(timer);
    timer = setTimeout(push, PUSH_DEBOUNCE);
  }

  // 恢复应用：把备份包里的浏览器数据写回本浏览器（服务侧已脱密）
  function applyState(state) {
    if (!state || typeof state !== 'object') return;
    Object.keys(state).forEach(function (k) {
      try { localStorage.setItem(k, String(state[k])); } catch (e) {}
    });
    if (isExtension) {
      try {
        var obj = {};
        Object.keys(state).forEach(function (k) {
          try { obj[k] = JSON.parse(state[k]); } catch (e) { obj[k] = state[k]; }
        });
        // 键名归一化（v0.50.1，与 background.js applyRestoredState 同一规则）：备份键多为
        // 网页 localStorage 名（td_todo_items/translate_history/…），逆映射回扩展本名写入
        // chrome.storage，否则扩展各模块读不到恢复的数据。两侧同名时保留扩展本名（权威源）。
        // 映射须与 background.js RECORD_SYNC_KEYS 一致。
        var LS_TO_CS = {
          translate_config: 'config',
          td_todo_items: 'todo_items', td_todo_cal_config: 'todo_cal_config',
          translate_history: 'history', translate_draft: 'draft',
          wr_work_records: 'work_records', wr_work_summaries: 'work_summaries',
          wr_work_config: 'work_config', wr_work_draft: 'work_draft',
          email_summary_history: 'email_summary_history', email_summary_config: 'email_summary_config',
          learningHistory: 'learningHistory', englishLearningData: 'englishLearningData',
          ai_parse_state: 'ai_parse_state', ai_prompts_state: 'ai_prompts_state',
          email_summary_draft: 'email_summary_draft',
          ws_api_base: 'ws_api_base', ws_api_token: 'ws_api_token',
          ws_risk_ack: 'ws_risk_ack', ws_sum_lang: 'ws_sum_lang', ws_contacts_cache: 'ws_contacts_cache',
        };
        Object.keys(LS_TO_CS).forEach(function (lsKey) {
          if (obj[lsKey] !== undefined && obj[LS_TO_CS[lsKey]] === undefined) {
            obj[LS_TO_CS[lsKey]] = obj[lsKey];
          }
        });
        chrome.storage.local.set(obj);
      } catch (e) {}
    }
  }

  global.LinguaFlowDataSync = { push: push, collect: collect, applyState: applyState, base: base, token: token };

  // ===== 云同步状态 chip（非微信工具页自动注入；点击跳控制中心）=====
  function chipStyle() {
    if (document.getElementById('lf-sync-chip-style')) return;
    var st = document.createElement('style');
    st.id = 'lf-sync-chip-style';
    st.textContent = '#lfSyncChip{position:fixed;left:12px;bottom:12px;z-index:99999;cursor:pointer;' +
      'font:11px/1.6 -apple-system,"Segoe UI","Noto Sans SC",sans-serif;padding:5px 12px;border-radius:999px;' +
      'background:rgba(20,24,32,.72);color:#cfd6e4;border:1px solid rgba(255,255,255,.14);' +
      'backdrop-filter:blur(10px);box-shadow:0 4px 14px rgba(0,0,0,.25);opacity:.85;transition:opacity .2s}' +
      '#lfSyncChip:hover{opacity:1}#lfSyncChip.warn{color:#e8b25a}';
    (document.head || document.documentElement).appendChild(st);
  }
  function chipSet(text, warn) {
    var el = document.getElementById('lfSyncChip');
    if (!el) return;
    el.textContent = text;
    el.className = warn ? 'warn' : '';
  }
  function refreshChip() {
    var h = { 'Content-Type': 'application/json' };
    if (token()) h['X-Api-Token'] = token();
    fetch(base() + '/api/status', { headers: h }).then(function (r) {
      if (!r.ok) throw new Error('down');
      avail = { ok: true, at: Date.now() };
      return fetch(base() + '/api/settings', { headers: h }).then(function (r2) { return r2.json(); });
    }).then(function (d) {
      var s = (d && d.settings) || {};
      if (!s.drive_path) { chipSet('☁ 未配置同步', true); return; }
      var idle = s.last_backup_at ? '☁ 已同步 ' + String(s.last_backup_at).slice(5, 16).replace('T', ' ') : '☁ 待首次备份';
      fetch(base() + '/api/backup/status', { headers: h }).then(function (r3) { return r3.json(); }).then(function (d2) {
        if (d2 && d2.settings && d2.settings.git_join_mode) { chipSet('☁ 首次接入 · 建议先恢复', true); return; }
        if (d2 && d2.remote && d2.remote.remote_newer) { chipSet('☁ 云端有更新', true); return; }
        chipSet(idle);
      }).catch(function () { chipSet(idle); });
    }).catch(function () {
      avail = { ok: false, at: Date.now() };
      chipSet('☁ 同步服务未启动', true);
    });
  }
  function mountChip() {
    if (document.getElementById('lfSyncChip')) return;
    chipStyle();
    var el = document.createElement('div');
    el.id = 'lfSyncChip';
    el.textContent = '☁ …';
    el.title = '数据与云同步 · 点击前往设置（备份 / 恢复 / Git 仓库）';
    el.addEventListener('click', function () {
      if (global.LfCloudSync) { global.LfCloudSync.toggle(); return; }
      try { location.href = new URL('wechat_schedule.html', location.href).href; } catch (e) {}
    });
    document.body.appendChild(el);
    refreshChip();
    setInterval(refreshChip, 60000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountChip);
  else mountChip();

  // ===== 重装自动恢复兜底 + 恢复提示（v0.50.0，仅扩展页） =====
  // background 已在 onInstalled 时尝试恢复；若当时服务未启动，这里在页面打开时补一次：
  // 本地 chrome.storage 为空 → 消息请求 background 执行恢复（拉取+键名归一化只此一份），
  // 成功后刷新页面（sessionStorage 守卫防循环）。
  function maybeAutoRestore() {
    try {
      if (sessionStorage.getItem('lf_auto_restored')) { showRestoredToast(); return; } // 本轮已恢复过，防循环
      chrome.storage.local.get(null, function (res) {
        if (res && Object.keys(res).length > 0) { showRestoredToast(); return; }
        try {
          chrome.runtime.sendMessage({ action: 'linguaflow:autoRestore' }, function (reply) {
            if (chrome.runtime.lastError) return;
            if (reply && reply.restored) {
              sessionStorage.setItem('lf_auto_restored', '1');
              setTimeout(function () { location.reload(); }, 800);
            }
          });
        } catch (e) {}
      });
    } catch (e) {}
  }

  // 恢复成功提示：chrome.storage 有 lf_restored_info（background 或页面恢复时写入）
  // → 显示「已从本地备份恢复 N 项数据」3 秒淡出，并删除该键避免重复提示。
  function showRestoredToast() {
    try {
      chrome.storage.local.get('lf_restored_info', function (res) {
        var info = res && res.lf_restored_info;
        if (!info) return;
        chrome.storage.local.remove('lf_restored_info');
        var el = document.createElement('div');
        el.textContent = '☁ 已从本地备份恢复 ' + (info.count || 0) + ' 项数据';
        el.style.cssText = 'position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:100000;' +
          'font:12px/1.6 -apple-system,"Segoe UI","Noto Sans SC",sans-serif;padding:6px 16px;border-radius:999px;' +
          'background:rgba(20,24,32,.85);color:#cfe3cf;border:1px solid rgba(255,255,255,.18);' +
          'box-shadow:0 4px 14px rgba(0,0,0,.25);transition:opacity .4s';
        document.body.appendChild(el);
        setTimeout(function () { el.style.opacity = '0'; }, 2600);
        setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 3100);
      });
    } catch (e) {}
  }

  // 触发：加载后延迟推一次；storage 变更去抖推；心跳兜底
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', schedulePush);
  else schedulePush();
  global.addEventListener('storage', schedulePush);
  setInterval(push, HEARTBEAT_MS);
  // v0.50.1 闲置自愈（目标：页面闲置后不再「全灰、无 GUI」）。四个闲置场景分别处理：
  // ① 标签页被 Chrome「内存节省程序」丢弃后重画失败整页灰掉 → 回到前台自动刷新；
  // ② 丢弃后 Chrome 自动重载出的新文档一出生就是 visible，visibilitychange 不会再
  //    触发，而重载页恰是灰屏高发时刻 → 加载时检测 wasDiscarded 主动强刷一次绘制；
  // ③ 系统休眠/锁屏使 GPU 进程重启后合成失效、内容发灰 → 回到前台 / 唤醒看门狗
  //    强制离线重排重建绘制树（单独 translateZ 对合成失效基本无效，故升级为强招）；
  // ④ 扩展被重载/更新后，旧页面的扩展上下文失效（渲染还在但一切 chrome 调用报错）→
  //    扩展页回到前台自动加载新版本。弹层开着时不自动刷新，防止丢未保存的草稿。
  // 网页版无 chrome API，④ 天然不触发，①②③ 已覆盖。
  // 强制重绘：根节点 display 离线重排逼 Chrome 重建绘制树（同一同步任务内完成，
  // 无中间帧，视觉无闪烁；display 切换会丢滚动位置，先记后补），最后挂合成层
  // 提示再强制一次重新光栅化。只动绘制层，不改 DOM 内容，草稿/弹层不受影响。
  function forceRepaint() {
    try {
      var html = document.documentElement, b = document.body;
      if (!html || !b) return;
      var x = window.scrollX, y = window.scrollY;
      html.style.display = 'none';
      void html.offsetHeight;
      html.style.display = '';
      if (x || y) window.scrollTo(x, y);
      b.style.transform = 'translateZ(0)';
      void b.offsetHeight;
      b.style.transform = '';
    } catch (e) {}
  }
  var lastTick = Date.now();
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible') return;
    var away = Date.now() - lastTick;
    lastTick = Date.now();
    if (document.wasDiscarded) { try { location.reload(); } catch (e) {} return; }
    if (away > 30000) forceRepaint(); // 闲置较久（含休眠唤醒）→ 强招；快速切回只需轻量重绘
    else try { var b = document.body; if (b) { b.style.transform = 'translateZ(0)'; void b.offsetHeight; b.style.transform = ''; } } catch (e) {}
    if (isExtension) {
      var staleCtx = false;
      try { chrome.runtime.getManifest(); } catch (e) { staleCtx = true; }
      if (staleCtx && !document.querySelector('.modal-overlay.open, .lfcs-mask.open')) {
        try { location.reload(); } catch (e) {}
      }
    }
  });
  // 唤醒看门狗（场景③）：覆盖「休眠唤醒后页面一直在前台」——此时 visibilitychange
  // 不触发。休眠期间定时器被冻结，唤醒后第一个 tick 心跳缺口远超周期 → 强制重绘。
  // 后台标签 timer 被节流到 ≥1min，但此时 visible=false 不会误触；阈值取 2min 留裕量。
  setInterval(function () {
    var now = Date.now();
    if (now - lastTick > 120000 && document.visibilityState === 'visible') forceRepaint();
    lastTick = now;
  }, 30000);
  // 丢弃重载后的灰屏兜底（场景②）：Chrome 丢弃标签后激活时自动重载，新文档
  // wasDiscarded=true 且出生即 visible，加载完成后主动强刷一次绘制。
  if (document.wasDiscarded) setTimeout(forceRepaint, 300);
  // v0.50.0：扩展页加载时，若本地存储为空而服务有备份 → 自动恢复（重装兜底）+ 恢复提示
  if (isExtension) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', maybeAutoRestore);
    else maybeAutoRestore();
    // v0.50.0：chrome.storage 变化 → 及时推送备份（消除 60s 心跳窗口内记录保存的丢失）
    try { chrome.storage.onChanged.addListener(schedulePush); } catch (e) {}
  }
})(typeof window !== 'undefined' ? window : this);
