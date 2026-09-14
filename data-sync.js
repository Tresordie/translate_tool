// ================================================================
// LinguaFlow — 数据云同步客户端 v0.29.0（所有页面引入）
// 职责：把本页可见的浏览器数据（localStorage 全量；扩展环境另并入
//       chrome.storage.local）推给本机 wechat_scheduler 服务，由服务
//       落本地 + 镜像到 Google Drive。恢复由「微信工具」页统一执行。
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
      if (!s.drive_path) { chipSet('☁ 未配置 Drive', true); return; }
      chipSet(s.last_backup_at ? '☁ 已同步 ' + String(s.last_backup_at).slice(5, 16).replace('T', ' ') : '☁ 待首次备份');
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
    el.title = '数据与云同步 · 点击前往设置（Google Drive / 备份 / 恢复）';
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

  // 触发：加载后延迟推一次；storage 变更去抖推；心跳兜底
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', schedulePush);
  else schedulePush();
  global.addEventListener('storage', schedulePush);
  setInterval(push, HEARTBEAT_MS);
})(typeof window !== 'undefined' ? window : this);
