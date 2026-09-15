// ================================================================
// LinguaFlow — 云同步抽屉组件 v0.31.0
// 作用：让工作报告/任务清单/英语学习/邮件总结/AI解析/AI提示词/主页等页面，
//       像「微信工具」页一样拥有完整的 Google Drive 云同步控制。
// 形态：自包含的右侧滑出抽屉 + 内嵌目录选择弹窗 + 自带 toast，不依赖宿主页结构。
// 触发：data-sync.js 注入的「☁」状态胶囊点击 → LfCloudSync.toggle()。
// 依赖：仅本机 wechat_scheduler 服务（/api/settings|backup|listdir|restore|autostart|browser-data）。
// 红线：备份包永不含 API Key / 服务口令（服务端已剥离，客户端 data-sync.js 推送前也剥）。
// ================================================================
(function (global) {
  'use strict';

  var isExtension = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id);
  var open = false, dirState = { path: '', parent: null }, loaded = false;

  function base() {
    var b = null;
    try { b = JSON.parse(localStorage.getItem('ws_api_base') || 'null'); } catch (e) {}
    if (b) return String(b).replace(/\/+$/, '');
    if (location.protocol === 'http:' || location.protocol === 'https:') return location.origin;
    return 'http://127.0.0.1:8765';
  }
  function token() { try { return JSON.parse(localStorage.getItem('ws_api_token') || 'null') || ''; } catch (e) { return ''; } }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmtTime(s) { return s ? String(s).replace('T', ' ').slice(5, 16) : '—'; }
  function fmtSize(n) { return n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }

  function api(method, path, body) {
    var headers = { 'Content-Type': 'application/json' };
    if (token()) headers['X-Api-Token'] = token();
    return fetch(base() + path, { method: method, headers: headers, body: body ? JSON.stringify(body) : undefined })
      .then(function (res) {
        return res.json().catch(function () { throw new Error('HTTP ' + res.status + ' 响应非 JSON'); }).then(function (data) {
          if (!data.ok) throw new Error(data.error || ('HTTP ' + res.status));
          return data;
        });
      });
  }
  function failMsg(err) {
    var m = String((err && err.message) || err);
    if (/Failed to fetch|NetworkError|Load failed|down/i.test(m)) return '无法连接服务（' + base() + '），请先启动 wechat_scheduler 服务';
    return m;
  }

  // ---- 样式（lfcs- 前缀，注入一次）----
  function injectStyle() {
    if (document.getElementById('lfcs-style')) return;
    var css =
      /* 抽屉主体：主题自适应玻璃拟态 */
      '.lfcs-drawer{position:fixed;top:0;right:0;height:100vh;height:100dvh;width:min(420px,94vw);z-index:100000;' +
      'transform:translateX(106%);transition:transform .4s cubic-bezier(.22,.61,.36,1);' +
      'background:var(--glass-bg,rgba(24,26,32,.9));backdrop-filter:blur(30px) saturate(1.6);-webkit-backdrop-filter:blur(30px) saturate(1.6);' +
      'color:var(--text,#e8eaf0);border-left:1px solid var(--glass-border,rgba(255,255,255,.12));' +
      'box-shadow:-24px 0 70px rgba(var(--shadow-tint-rgb,0,0,0),.32);overflow-y:auto;overscroll-behavior:contain;' +
      'font:13px/1.6 -apple-system,"Segoe UI","Noto Sans SC",sans-serif}' +
      '.lfcs-drawer.open{transform:none}' +
      '.lfcs-drawer::-webkit-scrollbar,.lfcs-list::-webkit-scrollbar{width:8px}' +
      '.lfcs-drawer::-webkit-scrollbar-thumb,.lfcs-list::-webkit-scrollbar-thumb{background:var(--scrollbar-color,rgba(128,128,128,.4));border-radius:8px}' +
      /* 渐变头部 */
      '.lfcs-head{position:sticky;top:0;z-index:2;display:flex;align-items:center;gap:12px;padding:18px 20px;' +
      'background:linear-gradient(135deg,rgba(var(--primary-rgb,80,120,220),.16),rgba(var(--primary-rgb,80,120,220),.02));' +
      'border-bottom:1px solid var(--glass-border,rgba(255,255,255,.1));backdrop-filter:blur(20px)}' +
      '.lfcs-head .ic{width:36px;height:36px;border-radius:12px;display:grid;place-items:center;flex:0 0 auto;' +
      'background:var(--btn-gradient,linear-gradient(135deg,#005bbf,#47a3ff));color:#fff;box-shadow:0 6px 18px rgba(var(--primary-rgb,80,120,220),.4)}' +
      '.lfcs-head .ic svg{width:20px;height:20px}' +
      '.lfcs-head .tt{font-size:15px;font-weight:700;letter-spacing:.01em;line-height:1.25}' +
      '.lfcs-head .sub{font-size:11px;color:var(--text-dim,#9aa3b2);font-weight:500}' +
      '.lfcs-x{margin-left:auto;cursor:pointer;border:1px solid transparent;background:transparent;color:var(--text-dim,#9aa3b2);' +
      'width:30px;height:30px;border-radius:9px;font-size:16px;line-height:1;display:grid;place-items:center;transition:.18s}' +
      '.lfcs-x:hover{background:rgba(var(--shadow-tint-rgb,120,120,120),.14);color:var(--text,#fff);border-color:var(--glass-border)}' +
      '.lfcs-body{padding:16px 20px 44px}' +
      /* 状态胶囊 */
      '.lfcs-status{display:inline-flex;align-items:center;gap:8px;font-size:12px;font-weight:600;' +
      'padding:7px 13px;border-radius:999px;background:var(--primary-a08,rgba(80,120,220,.1));' +
      'border:1px solid var(--glass-border,rgba(255,255,255,.1));color:var(--text-secondary,#c2c9d6);margin-bottom:4px}' +
      '.lfcs-status .d{width:7px;height:7px;border-radius:50%;background:var(--neon-green,#2ea86e);box-shadow:0 0 0 3px rgba(46,168,110,.2);flex:0 0 auto}' +
      '.lfcs-status.warn .d{background:var(--orange,#e8a33d);box-shadow:0 0 0 3px rgba(232,163,61,.2)}' +
      '.lfcs-status.err .d{background:var(--red,#cf5c5c);box-shadow:0 0 0 3px rgba(207,92,92,.2)}' +
      /* 分区标题 */
      '.lfcs-sec{display:flex;align-items:center;gap:9px;margin:22px 0 11px;font-size:11px;font-weight:700;' +
      'text-transform:uppercase;letter-spacing:.09em;color:var(--text-dim,#9aa3b2)}' +
      '.lfcs-sec::before{content:"";width:3px;height:13px;border-radius:2px;background:var(--btn-gradient,linear-gradient(135deg,#005bbf,#47a3ff))}' +
      /* 卡片 */
      '.lfcs-card{background:var(--bg-card2,rgba(255,255,255,.04));border:1px solid var(--glass-border,rgba(255,255,255,.08));border-radius:14px;padding:13px 14px}' +
      /* 输入 */
      '.lfcs-in{width:100%;box-sizing:border-box;height:40px;padding:0 13px;border-radius:11px;' +
      'border:1px solid var(--glass-border,rgba(255,255,255,.14));background:var(--bg-card2,rgba(255,255,255,.06));' +
      'color:var(--text,#e8eaf0);font:inherit;outline:none;transition:border-color .2s,box-shadow .2s}' +
      '.lfcs-in::placeholder{color:var(--text-dim,#8a93a2)}' +
      '.lfcs-in:focus{border-color:var(--primary,#4c8dff);box-shadow:var(--focus-ring,0 0 0 4px rgba(76,141,255,.14))}' +
      '.lfcs-row{display:flex;gap:8px;align-items:center}' +
      /* 按钮 */
      '.lfcs-btn{height:36px;padding:0 15px;border-radius:10px;border:1px solid var(--glass-border,rgba(255,255,255,.16));' +
      'background:var(--bg-card2,rgba(255,255,255,.06));color:var(--text,#e8eaf0);font:inherit;font-size:12.5px;font-weight:600;' +
      'cursor:pointer;white-space:nowrap;transition:transform .12s,box-shadow .2s,background .2s,border-color .2s,color .2s}' +
      '.lfcs-btn:hover{border-color:var(--primary-a25,rgba(76,141,255,.4));background:var(--primary-a08,rgba(76,141,255,.12));color:var(--primary,#4c8dff);transform:translateY(-1px)}' +
      '.lfcs-btn.primary{background:var(--btn-gradient,linear-gradient(135deg,#005bbf,#47a3ff));background-size:160% 130%;background-position:0 50%;' +
      'border:none;color:#fff;box-shadow:0 4px 14px rgba(var(--primary-rgb,76,141,255),.3)}' +
      '.lfcs-btn.primary:hover{background-position:100% 50%;color:#fff;transform:translateY(-1px);box-shadow:0 9px 24px rgba(var(--primary-rgb,76,141,255),.42)}' +
      '.lfcs-btn.danger:hover{background:var(--red-a08,rgba(207,92,92,.14));border-color:var(--red-a25,rgba(207,92,92,.4));color:var(--red,#ff8a8a);transform:translateY(-1px)}' +
      '.lfcs-btn:disabled{opacity:.45;cursor:not-allowed;transform:none;box-shadow:none}' +
      '.lfcs-btn:active:not(:disabled){transform:translateY(0) scale(.98)}' +
      '.lfcs-grid{display:flex;flex-wrap:wrap;gap:9px;margin-top:10px}' +
      /* 快照行 */
      '.lfcs-snap{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:12px;' +
      'background:var(--bg-card2,rgba(255,255,255,.05));border:1px solid var(--glass-border,rgba(255,255,255,.08));' +
      'font-size:12px;margin-top:8px;transition:border-color .2s,transform .12s,box-shadow .2s}' +
      '.lfcs-snap:hover{border-color:var(--primary-a25,rgba(76,141,255,.35));transform:translateY(-1px);box-shadow:0 6px 18px rgba(var(--shadow-tint-rgb,0,0,0),.14)}' +
      '.lfcs-snap .fi{width:30px;height:30px;border-radius:9px;display:grid;place-items:center;flex:0 0 auto;' +
      'background:var(--primary-a10,rgba(76,141,255,.14));color:var(--primary,#4c8dff)}' +
      '.lfcs-snap .fi svg{width:15px;height:15px}' +
      '.lfcs-snap b{font-weight:600;font-size:12.5px}' +
      '.lfcs-snap .m{color:var(--text-dim,#9aa3b2);font-size:11px;margin-left:auto;white-space:nowrap}' +
      '.lfcs-empty{font-size:12px;color:var(--text-dim,#9aa3b2);text-align:center;padding:16px;border:1px dashed var(--glass-border,rgba(255,255,255,.12));border-radius:12px;margin-top:8px}' +
      /* 开关 */
      '.lfcs-sw{position:relative;display:inline-block;width:44px;height:26px;flex:0 0 auto}' +
      '.lfcs-sw input{opacity:0;width:0;height:0;position:absolute}' +
      '.lfcs-sw i{position:absolute;inset:0;border-radius:999px;background:var(--glass-border,rgba(255,255,255,.16));transition:.24s}' +
      '.lfcs-sw i:before{content:"";position:absolute;width:20px;height:20px;left:3px;top:3px;border-radius:50%;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.3);transition:.24s}' +
      '.lfcs-sw input:checked+i{background:var(--btn-gradient,linear-gradient(135deg,#005bbf,#47a3ff))}' +
      '.lfcs-sw input:checked+i:before{transform:translateX(20px)}' +
      '.lfcs-hint{font-size:11.5px;color:var(--text-dim,#9aa3b2);line-height:1.65;margin-top:8px}' +
      /* 目录选择弹窗 */
      '.lfcs-mask{position:fixed;inset:0;z-index:100001;background:rgba(8,10,16,.5);backdrop-filter:blur(7px);-webkit-backdrop-filter:blur(7px);' +
      'display:flex;align-items:center;justify-content:center;opacity:0;pointer-events:none;transition:opacity .22s}' +
      '.lfcs-mask.open{opacity:1;pointer-events:auto}' +
      '.lfcs-modal{width:min(560px,92vw);max-height:80vh;display:flex;flex-direction:column;' +
      'background:var(--glass-bg,rgba(28,30,38,.94));backdrop-filter:blur(30px) saturate(1.6);-webkit-backdrop-filter:blur(30px) saturate(1.6);' +
      'border:1px solid var(--glass-border,rgba(255,255,255,.14));border-radius:18px;padding:18px 20px;' +
      'box-shadow:0 30px 80px rgba(0,0,0,.45);color:var(--text,#e8eaf0);transform:scale(.96);transition:transform .22s}' +
      '.lfcs-mask.open .lfcs-modal{transform:none}' +
      '.lfcs-modal h3{margin:0 0 12px;font-size:14px;font-weight:700;display:flex;justify-content:space-between;align-items:center}' +
      '.lfcs-cur{font:12px/1.4 Consolas,"Courier New",monospace;color:var(--text-dim,#9aa3b2);margin-bottom:10px;' +
      'padding:8px 11px;background:var(--bg-card2,rgba(255,255,255,.04));border-radius:9px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      '.lfcs-list{flex:1;min-height:200px;max-height:46vh;overflow-y:auto;border:1px solid var(--glass-border,rgba(255,255,255,.1));border-radius:12px;padding:6px}' +
      '.lfcs-dir{display:flex;align-items:center;gap:9px;padding:9px 11px;border-radius:9px;cursor:pointer;font-size:13px;transition:background .15s}' +
      '.lfcs-dir:hover{background:var(--primary-a10,rgba(76,141,255,.14))}' +
      '.lfcs-dir svg{color:var(--primary,#4c8dff);flex:0 0 auto}' +
      /* toast */
      '.lfcs-toast{position:fixed;top:18px;left:50%;transform:translateX(-50%) translateY(-90px);z-index:100002;' +
      'padding:10px 18px;border-radius:12px;font-size:13px;font-weight:600;color:var(--text,#fff);' +
      'background:var(--bg-elevated,#22272f);border:1px solid var(--glass-border,rgba(255,255,255,.14));' +
      'box-shadow:0 14px 40px rgba(0,0,0,.32);backdrop-filter:blur(20px);opacity:0;transition:.28s cubic-bezier(.22,.61,.36,1);max-width:82vw}' +
      '.lfcs-toast.show{transform:translateX(-50%) translateY(0);opacity:1}' +
      '.lfcs-toast.ok{background:rgba(46,168,110,.94);border-color:transparent;color:#fff}' +
      '.lfcs-toast.err{background:rgba(207,92,92,.94);border-color:transparent;color:#fff}';
    var st = document.createElement('style'); st.id = 'lfcs-style'; st.textContent = css;
    (document.head || document.documentElement).appendChild(st);
  }

  var toastTimer;
  function toast(msg, type) {
    var t = document.getElementById('lfcs-toast');
    if (!t) { t = document.createElement('div'); t.id = 'lfcs-toast'; t.className = 'lfcs-toast'; document.body.appendChild(t); }
    t.textContent = msg; t.className = 'lfcs-toast show ' + (type || '');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2600);
  }

  // ---- 抽屉骨架 ----
  function ensureDom() {
    if (document.getElementById('lfcsDrawer')) return;
    injectStyle();
    var d = document.createElement('div');
    d.className = 'lfcs-drawer'; d.id = 'lfcsDrawer';
    var cloud = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/></svg>';
    d.innerHTML =
      '<div class="lfcs-head"><div class="ic">' + cloud + '</div>' +
        '<div><div class="tt">数据与云同步</div><div class="sub">Google Drive · 全模块统一</div></div>' +
        '<button class="lfcs-x" id="lfcsClose" title="关闭">✕</button></div>' +
      '<div class="lfcs-body">' +
        '<div class="lfcs-status" id="lfcsStatusPill"><span class="d"></span><span id="lfcsStatus">加载中…</span></div>' +
        '<div class="lfcs-sec">Google Drive 路径</div>' +
        '<div class="lfcs-card">' +
          '<div class="lfcs-row"><input class="lfcs-in" id="lfcsPath" placeholder="如 D:\\Google Drive（桌面客户端同步目录）"><button class="lfcs-btn" id="lfcsBrowse">浏览…</button></div>' +
          '<div class="lfcs-hint">数据写入其下 LinguaFlow/ 子文件夹；含全部模块浏览器数据 + 微信任务/历史/总结。备份永不含 API Key 与口令。</div>' +
        '</div>' +
        '<div class="lfcs-card" style="margin-top:10px;display:flex;align-items:center;justify-content:space-between;gap:12px">' +
          '<div><div style="font-weight:600;font-size:13px">自动备份</div><div class="lfcs-hint" style="margin:2px 0 0">数据变化后去抖 5 秒静默写入</div></div>' +
          '<label class="lfcs-sw"><input type="checkbox" id="lfcsAuto"><i></i></label>' +
        '</div>' +
        '<div class="lfcs-grid">' +
          '<button class="lfcs-btn primary" id="lfcsSave">保存并测试</button>' +
          '<button class="lfcs-btn" id="lfcsBackup">立即备份</button>' +
          '<button class="lfcs-btn" id="lfcsRestore">从 Drive 恢复</button>' +
          '<button class="lfcs-btn" id="lfcsImport">导入 JSON</button>' +
          '<button class="lfcs-btn" id="lfcsExport">导出 JSON</button>' +
          '<input type="file" id="lfcsFile" accept=".json,application/json" style="display:none">' +
        '</div>' +
        '<div class="lfcs-sec">备份快照</div><div id="lfcsSnaps"><div class="lfcs-empty">未配置或暂无快照</div></div>' +
        '<div class="lfcs-sec">服务自启</div>' +
        '<div class="lfcs-card" style="display:flex;align-items:center;gap:12px"><button class="lfcs-btn" id="lfcsAutostart">注册开机自启</button><span class="lfcs-hint" id="lfcsAutoHint" style="margin:0;flex:1"></span></div>' +
      '</div>';
    document.body.appendChild(d);

    var mask = document.createElement('div');
    mask.className = 'lfcs-mask'; mask.id = 'lfcsMask';
    mask.innerHTML = '<div class="lfcs-modal"><h3>选择文件夹 <button class="lfcs-x" id="lfcsDirX">✕</button></h3>' +
      '<div class="lfcs-cur" id="lfcsDirCur">（选择盘符）</div><div class="lfcs-list" id="lfcsDirList"></div>' +
      '<div class="lfcs-grid" style="justify-content:flex-end"><button class="lfcs-btn" id="lfcsDirUp">↑ 上一级</button><button class="lfcs-btn primary" id="lfcsDirPick" disabled>选用此目录</button></div></div>';
    document.body.appendChild(mask);
    bind(d, mask);
  }

  function bind(d, mask) {
    d.querySelector('#lfcsClose').onclick = close;
    d.querySelector('#lfcsBrowse').onclick = function () { mask.classList.add('open'); loadDir(d.querySelector('#lfcsPath').value.trim() || ''); };
    d.querySelector('#lfcsSave').onclick = saveSettings;
    d.querySelector('#lfcsAuto').onchange = function () {
      api('PUT', '/api/settings', { auto_backup: d.querySelector('#lfcsAuto').checked }).then(function () { toast('自动备份已' + (d.querySelector('#lfcsAuto').checked ? '开启' : '关闭'), 'ok'); refresh(); })
        .catch(function (e) { toast(failMsg(e), 'err'); d.querySelector('#lfcsAuto').checked = !d.querySelector('#lfcsAuto').checked; });
    };
    d.querySelector('#lfcsBackup').onclick = function () {
      api('POST', '/api/backup').then(function (r) { toast(r.ok ? '已备份到 Drive' : '备份失败：' + r.error, r.ok ? 'ok' : 'err'); refresh(); })
        .catch(function (e) { toast(failMsg(e), 'err'); });
    };
    d.querySelector('#lfcsRestore').onclick = function () { restore({ name: 'latest.json' }, 'Drive 最新备份'); };
    d.querySelector('#lfcsExport').onclick = function () {
      api('GET', '/api/backup/snapshot?name=latest.json').then(function (r) {
        var blob = new Blob([JSON.stringify(r.bundle, null, 1)], { type: 'application/json' });
        var a = document.createElement('a'); a.href = URL.createObjectURL(blob);
        a.download = 'linguaflow-backup-' + new Date().toISOString().slice(0, 10) + '.json';
        document.body.appendChild(a); a.click(); a.remove(); toast('已导出', 'ok');
      }).catch(function (e) { toast('导出失败：' + failMsg(e), 'err'); });
    };
    d.querySelector('#lfcsImport').onclick = function () { d.querySelector('#lfcsFile').click(); };
    d.querySelector('#lfcsFile').onchange = function () {
      var f = this.files && this.files[0]; this.value = ''; if (!f) return;
      var rd = new FileReader(); rd.onload = function () { try { restore({ bundle: JSON.parse(rd.result) }, '本地文件'); } catch (e) { toast('JSON 解析失败：' + e.message, 'err'); } };
      rd.readAsText(f, 'utf-8');
    };
    d.querySelector('#lfcsAutostart').onclick = function () {
      var enable = d.querySelector('#lfcsAutostart')._reg !== true;
      api('POST', '/api/autostart', { enable: enable }).then(function (r) {
        toast(r.ok ? (enable ? '已注册开机自启 ✓' : '已取消开机自启') : '操作失败：' + (r.error || '需本机权限'), r.ok ? 'ok' : 'err'); refresh();
      }).catch(function (e) { toast(failMsg(e), 'err'); });
    };
    // 目录弹窗
    mask.querySelector('#lfcsDirX').onclick = function () { mask.classList.remove('open'); };
    mask.addEventListener('click', function (e) { if (e.target === mask) mask.classList.remove('open'); });
    mask.querySelector('#lfcsDirUp').onclick = function () { loadDir(dirState.parent == null ? '' : dirState.parent); };
    mask.querySelector('#lfcsDirPick').onclick = function () {
      if (!dirState.path) return;
      d.querySelector('#lfcsPath').value = dirState.path; mask.classList.remove('open'); toast('已填入路径，点「保存并测试」生效', 'ok');
    };
  }

  function saveSettings() {
    var d = document.getElementById('lfcsDrawer');
    var p = d.querySelector('#lfcsPath').value.trim();
    d.querySelector('#lfcsSave').disabled = true;
    api('PUT', '/api/settings', { drive_path: p, test: !!p }).then(function (r) {
      if (r.test_error) toast('路径可用但试写失败：' + r.test_error, 'err');
      else if (p) toast('Drive 路径已保存并完成首次备份', 'ok');
      else toast('已清除 Drive 路径（停止云备份）', 'ok');
      refresh();
    }).catch(function (e) { toast(failMsg(e), 'err'); })
      .finally(function () { d.querySelector('#lfcsSave').disabled = false; });
  }

  function restore(body, label) {
    if (!confirm('确定用「' + label + '」覆盖本地全部数据？\n（不影响 Drive 里的备份；API Key 不在备份内，恢复后需重填）')) return;
    api('POST', '/api/restore', body).then(function (r) {
      if (global.LinguaFlowDataSync && r.browser_state) LinguaFlowDataSync.applyState(r.browser_state);
      toast('已恢复（' + label + '），2 秒后刷新…', 'ok');
      setTimeout(function () { location.reload(); }, 2000);
    }).catch(function (e) { toast('恢复失败：' + failMsg(e), 'err'); });
  }

  function loadDir(p) {
    var d = document.getElementById('lfcsDrawer');
    var mask = document.getElementById('lfcsMask');
    var list = mask.querySelector('#lfcsDirList');
    list.innerHTML = '<div class="lfcs-empty">加载中…</div>';
    api('GET', '/api/listdir?path=' + encodeURIComponent(p || '')).then(function (r) {
      dirState = { path: r.path || '', parent: r.parent };
      mask.querySelector('#lfcsDirCur').textContent = r.path || '（选择盘符）';
      mask.querySelector('#lfcsDirUp').style.visibility = r.path ? '' : 'hidden';
      mask.querySelector('#lfcsDirPick').disabled = !r.path;
      if (!r.dirs.length) { list.innerHTML = '<div class="lfcs-empty">此目录无子文件夹，可直接「选用此目录」</div>'; return; }
      var folder = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>';
      list.innerHTML = r.dirs.map(function (n) { return '<div class="lfcs-dir">' + folder + '<span>' + esc(n) + '</span></div>'; }).join('');
      Array.prototype.forEach.call(list.children, function (el, i) {
        el.onclick = function () { loadDir(r.path ? (/[\\/]$/.test(r.path) ? r.path : r.path + '\\') + r.dirs[i] : r.dirs[i] + '\\'); };
      });
    }).catch(function (e) { list.innerHTML = '<div class="lfcs-empty">读取失败：' + esc(failMsg(e)) + '</div>'; });
  }

  function refresh() {
    var d = document.getElementById('lfcsDrawer');
    var pill = function (cls) { var p = d.querySelector('#lfcsStatusPill'); if (p) p.className = 'lfcs-status' + (cls ? ' ' + cls : ''); };
    api('GET', '/api/settings').then(function (r) {
      var s = r.settings || {};
      d.querySelector('#lfcsPath').value = s.drive_path || '';
      d.querySelector('#lfcsAuto').checked = s.auto_backup !== false;
      d.querySelector('#lfcsStatus').textContent = s.last_backup_at ? '最近备份 ' + fmtTime(s.last_backup_at) + (s.last_backup_error ? '（上次失败：' + s.last_backup_error + '）' : '') : '从未备份（配置路径后自动备份）';
      d.querySelector('#lfcsRestore').disabled = !s.drive_path;
      pill(s.last_backup_error ? 'warn' : (s.last_backup_at ? '' : 'warn'));
    }).catch(function (e) { d.querySelector('#lfcsStatus').textContent = failMsg(e); pill('err'); });
    api('GET', '/api/backup/status').then(function (r) {
      var snaps = r.snapshots || [];
      var box = d.querySelector('#lfcsSnaps');
      if (!snaps.length) { box.innerHTML = '<div class="lfcs-empty">未配置或暂无快照</div>'; return; }
      var fileIco = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
      box.innerHTML = snaps.map(function (sn) {
        return '<div class="lfcs-snap"><span class="fi">' + fileIco + '</span><b>' + esc(sn.name) + '</b><span class="m">' + fmtTime(sn.mtime) + ' · ' + fmtSize(sn.size) + '</span>' +
          '<button class="lfcs-btn" data-dl="' + esc(sn.name) + '" style="height:28px;padding:0 10px">下载</button>' +
          (sn.name === 'latest.json' ? '' : '<button class="lfcs-btn" data-re="' + esc(sn.name) + '" style="height:28px;padding:0 10px">恢复</button>') + '</div>';
      }).join('');
      Array.prototype.forEach.call(box.querySelectorAll('[data-dl]'), function (b) {
        b.onclick = function () { api('GET', '/api/backup/snapshot?name=' + encodeURIComponent(b.dataset.dl)).then(function (r) {
          var blob = new Blob([JSON.stringify(r.bundle, null, 1)], { type: 'application/json' }); var a = document.createElement('a');
          a.href = URL.createObjectURL(blob); a.download = b.dataset.dl; document.body.appendChild(a); a.click(); a.remove();
        }).catch(function (e) { toast(failMsg(e), 'err'); }); };
      });
      Array.prototype.forEach.call(box.querySelectorAll('[data-re]'), function (b) { b.onclick = function () { restore({ name: b.dataset.re }, '快照 ' + b.dataset.re); }; });
    }).catch(function () {});
    api('GET', '/api/autostart').then(function (r) {
      var btn = d.querySelector('#lfcsAutostart'); btn._reg = !!r.registered;
      btn.textContent = r.registered ? '取消开机自启' : '注册开机自启';
      d.querySelector('#lfcsAutoHint').textContent = r.registered ? '已注册：登录系统自动静默启动 ✓' : '注册后登录系统自动静默启动服务';
    }).catch(function () {});
  }

  function openDrawer() { ensureDom(); open = true; document.getElementById('lfcsDrawer').classList.add('open'); refresh(); }
  function close() { open = false; var d = document.getElementById('lfcsDrawer'); if (d) d.classList.remove('open'); }
  function toggle() { if (!open) openDrawer(); else close(); }

  global.LfCloudSync = { toggle: toggle, open: openDrawer, close: close, refresh: refresh };
})(typeof window !== 'undefined' ? window : this);
