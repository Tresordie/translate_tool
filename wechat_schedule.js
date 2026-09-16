// ================================================================
// LinguaFlow — 微信定时消息 管理页 v0.26.0
// 前端只做「任务 CRUD + 状态查看」，调度与发送全部由本机
// wechat_scheduler/server.py 完成；任务数据存服务端，
// 电脑 / 手机局域网访问天然一致（不走 localStorage 同步体系）。
// 存储遵循项目惯例：扩展 chrome.storage.local / 网页 localStorage（键 ws_*）
// ================================================================
(function () {
  'use strict';

  var isExtension = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id);
  var K_BASE = 'ws_api_base', K_TOKEN = 'ws_api_token', K_ACK = 'ws_risk_ack',
      K_LANG = 'ws_sum_lang', K_CONTACTS = 'ws_contacts_cache';
  var POLL_MS = 15000;
  var CONTACTS_TTL = 10 * 60 * 1000; // 联系人缓存有效期（毫秒）
  var WEEKDAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

  // ===== Storage（异步读、双写镜像，模式同 AI 解析）=====
  var store = {
    cache: {},
    init: function (done) {
      var keys = [K_BASE, K_TOKEN, K_ACK, K_LANG, K_CONTACTS];
      if (isExtension) {
        chrome.storage.local.get(keys, function (r) {
          keys.forEach(function (k) {
            var v = r[k] !== undefined ? r[k] : safeLocal(k);
            store.cache[k] = v;
            if (r[k] !== undefined) { try { localStorage.setItem(k, JSON.stringify(r[k])); } catch (e) {} }
          });
          done();
        });
      } else {
        keys.forEach(function (k) { store.cache[k] = safeLocal(k); });
        done();
      }
    },
    set: function (k, v) {
      store.cache[k] = v;
      try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {}
      if (isExtension) { var o = {}; o[k] = v; chrome.storage.local.set(o); }
      else { try { (window.top || window).postMessage({ source: 'linguaflow-page', type: 'save-record', key: k, value: v }, '*'); } catch (e) {} } // v0.44.0 偏好写入 chrome.storage，与扩展互通
    },
    get: function (k) { return store.cache[k] !== undefined ? store.cache[k] : safeLocal(k); }
  };
  function safeLocal(k) {
    try { var s = localStorage.getItem(k); return s === null ? undefined : JSON.parse(s); } catch (e) { return undefined; }
  }

  // v0.44.0 跨端实时刷新：对端写入 ws_* 键时更新本地缓存（网页↔扩展偏好互通）
  if (isExtension) {
    try {
      chrome.storage.onChanged.addListener(function (changes) {
        Object.keys(changes).forEach(function (k) {
          if (k.indexOf('ws_') === 0 && changes[k].newValue !== undefined) store.cache[k] = changes[k].newValue;
        });
      });
    } catch (e) {}
  } else {
    window.addEventListener('storage', function (e) {
      if (e.key && e.key.indexOf('ws_') === 0 && e.newValue) {
        try { store.cache[e.key] = JSON.parse(e.newValue); } catch (err) { store.cache[e.key] = e.newValue; }
      }
    });
  }

  // ===== 状态 =====
  var state = {
    base: '', token: '',
    connected: false, mock: false, wxConnected: false,
    contacts: [], receiver: null,   // {wxid, name}
    tasks: [], editingId: null,
    type: 'daily', weekdays: [1, 3, 5]
  };

  // ===== DOM =====
  function $(id) { return document.getElementById(id); }
  var els = {};
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function showToast(msg, type) {
    var t = els.toast;
    t.textContent = msg;
    t.className = 'toast ' + (type || '') + ' show';
    clearTimeout(showToast._tm);
    showToast._tm = setTimeout(function () { t.classList.remove('show'); }, 2600);
  }

  // ===== API 封装 =====
  function api(method, path, body) {
    var headers = { 'Content-Type': 'application/json' };
    if (state.token) headers['X-Api-Token'] = state.token;
    return fetch(state.base.replace(/\/+$/, '') + path, {
      method: method, headers: headers, body: body ? JSON.stringify(body) : undefined
    }).then(function (res) {
      return res.json().catch(function () { throw new Error('HTTP ' + res.status + ' 响应非 JSON'); }).then(function (data) {
        if (!data.ok) throw new Error(data.error || ('HTTP ' + res.status));
        return data;
      });
    });
  }
  function apiFail(err) {
    var msg = String(err && err.message || err);
    if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) msg = '无法连接服务（' + state.base + '），请确认 wechat_scheduler 服务已启动';
    return msg;
  }

  // ===== 刷新状态 / 任务 / 历史 =====
  function refreshStatus() {
    return api('GET', '/api/status').then(function (d) {
      state.connected = true; state.mock = !!d.wechat.mock; state.wxConnected = !!d.wechat.connected;
      var senderTag = d.wechat.sender && d.wechat.sender !== 'mock' ? '（通道 ' + d.wechat.sender + '）' : '';
      var txt, cls = 'ok';
      if (state.mock) txt = '服务在线（MOCK 演示模式，发送不触达微信）';
      else if (state.wxConnected) txt = '服务在线 · 微信已连接' + senderTag;
      else { txt = '服务在线 · 微信未连接' + senderTag + (d.wechat.error ? '：' + d.wechat.error : '，请启动/登录 PC 微信'); cls = 'bad'; }
      setStatus(txt, cls);
      els.offlineTip.style.display = 'none';
      els.versionHint.textContent = 'scheduler v' + (d.version || '?') + ' · 下次触发 ' + fmtTime(d.next_fire);
      return d;
    }).catch(function (e) {
      state.connected = false;
      setStatus('服务未连接', 'bad');
      els.offlineTip.style.display = 'block';
      els.versionHint.textContent = '';
      throw e;
    });
  }
  function setStatus(text, cls) {
    els.statusText.textContent = text;
    els.dot.className = 's-dot ' + (cls || '');
  }
  function refreshContacts(silent) {
    return api('GET', '/api/contacts').then(function (d) {
      state.contacts = d.contacts || [];
      store.set(K_CONTACTS, { t: Date.now(), list: state.contacts }); // 下次打开秒出列表
      if (!silent) showToast('已加载 ' + state.contacts.length + ' 个联系人/群', 'success');
    }).catch(function (e) {
      if (!silent) showToast(apiFail(e), 'error');
    });
  }
  function refreshTasks() {
    return api('GET', '/api/tasks').then(function (d) { state.tasks = d.tasks || []; renderTasks(); })
      .catch(function (e) { showToast('加载任务失败：' + apiFail(e), 'error'); });
  }
  function refreshHistory() {
    return api('GET', '/api/history?limit=50').then(function (d) {
      var n = (d.entries || []).length;
      els.histCount.textContent = n ? '（' + n + ' 条）' : '（最近 50 条）';
      renderHistory(d.entries || []);
    }).catch(function () {});
  }
  function refreshAll() {
    refreshStatus().then(function () {
      refreshContacts(true);
      refreshTasks();
      refreshHistory();
    }).catch(function () { /* 未连接时各列表保持原样 */ });
  }

  // ===== 时间格式化 =====
  function fmtTime(s) {
    if (!s) return '—';
    var d = new Date(s);
    if (isNaN(d)) return s.replace('T', ' ');
    var now = new Date(), diff = (d - now) / 1000;
    var hm = d.getHours() + ':' + ('0' + d.getMinutes()).slice(-2);
    var md = (d.getMonth() + 1) + '/' + d.getDate() + ' ' + hm;
    if (diff > 0 && diff < 3600) return md + '（' + Math.round(diff / 60) + ' 分钟后）';
    if (diff > 0 && diff < 86400 && d.getDate() === now.getDate()) return '今天 ' + hm;
    if (diff < 0 && diff > -3600) return Math.round(-diff / 60) + ' 分钟前';
    return md;
  }

  // ===== 调度类型切换 =====
  function setType(t) {
    state.type = t;
    Array.prototype.forEach.call(els.typeSeg.children, function (b) { b.classList.toggle('on', b.dataset.type === t); });
    els.onceWrap.style.display = t === 'once' ? '' : 'none';
    els.dailyWrap.style.display = t === 'daily' ? '' : 'none';
    els.weeklyWrap.style.display = t === 'weekly' ? '' : 'none';
    els.monthlyWrap.style.display = t === 'monthly' ? '' : 'none';
    els.yearlyWrap.style.display = t === 'yearly' ? '' : 'none';
  }

  function buildWeekdays() {
    els.weekdays.innerHTML = '';
    WEEKDAY_LABELS.forEach(function (label, i) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'ws-wday' + (state.weekdays.indexOf(i + 1) >= 0 ? ' on' : '');
      b.textContent = label; b.dataset.day = i + 1;
      b.addEventListener('click', function () {
        var day = +b.dataset.day, idx = state.weekdays.indexOf(day);
        if (idx >= 0) state.weekdays.splice(idx, 1); else state.weekdays.push(day);
        b.classList.toggle('on');
      });
      els.weekdays.appendChild(b);
    });
  }

  // ===== 接收人联想 =====
  function renderSuggest(q) {
    var box = els.suggest;
    var query = (q || '').trim().toLowerCase();
    var list = state.contacts.filter(function (c) {
      return !query || c.name.toLowerCase().indexOf(query) >= 0 || c.wxid.toLowerCase().indexOf(query) >= 0;
    }).slice(0, 30);
    if (!list.length) {
      box.innerHTML = '<div class="ws-suggest-empty">' + (state.contacts.length ? '无匹配，可直接输入会话名称' : '联系人加载中…（先点「保存并测试」确认服务连接）') + '</div>';
      box.classList.add('open'); return;
    }
    box.innerHTML = list.map(function (c) {
      return '<div class="ws-suggest-item" data-wxid="' + esc(c.wxid) + '" data-name="' + esc(c.name) + '">' +
        '<span>' + esc(c.name) + '</span><span class="tag">' + (c.group ? '群' : '好友') + '</span></div>';
    }).join('');
    box.classList.add('open');
    Array.prototype.forEach.call(box.querySelectorAll('.ws-suggest-item'), function (it) {
      it.addEventListener('mousedown', function (e) {
        e.preventDefault();
        state.receiver = { wxid: it.dataset.wxid, name: it.dataset.name };
        els.receiver.value = it.dataset.name;
        box.classList.remove('open');
      });
    });
  }
  function resolveReceiver() {
    var raw = els.receiver.value.trim();
    if (!raw) return null;
    if (state.receiver && state.receiver.name === raw) return state.receiver;
    var byWxid = null, byName = [];
    state.contacts.forEach(function (c) {
      if (c.wxid.toLowerCase() === raw.toLowerCase()) byWxid = c;
      if (c.name === raw) byName.push(c);
    });
    if (byWxid) return { wxid: byWxid.wxid, name: byWxid.name };
    if (byName.length === 1) return { wxid: byName[0].wxid, name: byName[0].name };
    if (/^(wxid_|filehelper$|\d+@chatroom$)/i.test(raw)) return { wxid: raw, name: raw };
    // psauto 通道按会话名称搜索发送：允许直接填名称（无 wxid）
    return { wxid: "", name: raw.slice(0, 60) };
  }

  // ===== 表单：收集 / 保存 / 编辑 =====
  function collectSchedule() {
    if (state.type === 'once') {
      var v = els.onceAt.value; // datetime-local 值 "YYYY-MM-DDTHH:MM"
      if (!v) { showToast('请选择发送时间', 'error'); return null; }
      return { type: 'once', at: v.length === 16 ? v + ':00' : v };
    }
    if (state.type === 'daily') return { type: 'daily', time: els.dailyTime.value || '08:30' };
    if (state.type === 'monthly') {
      var d = parseInt(els.monthlyDay.value, 10);
      if (!(d >= 1 && d <= 31)) { showToast('每月日期需为 1-31', 'error'); return null; }
      return { type: 'monthly', day: d, time: els.monthlyTime.value || '08:30', clamp: els.monthlyClamp.checked };
    }
    if (state.type === 'yearly') {
      var mm = parseInt(els.yearlyMonth.value, 10), dd = parseInt(els.yearlyDay.value, 10);
      if (!(mm >= 1 && mm <= 12) || !(dd >= 1 && dd <= 31)) { showToast('月/日取值无效', 'error'); return null; }
      return { type: 'yearly', date: ('0' + mm).slice(-2) + '-' + ('0' + dd).slice(-2), time: els.yearlyTime.value || '08:30' };
    }
    if (!state.weekdays.length) { showToast('每周任务至少勾选一天', 'error'); return null; }
    return { type: 'weekly', time: els.weeklyTime.value || '08:30', weekdays: state.weekdays.slice().sort() };
  }

  function saveTask() {
    if (!els.riskAck.checked) { showToast('请先勾选「使用须知」确认风险', 'error'); els.risk.focus(); return; }
    var rec = resolveReceiver();
    if (!rec) { showToast('无法识别接收人，请从下拉选择或填写 wxid', 'error'); els.receiver.focus(); return; }
    var content = els.content.value.trim();
    if (!content) { showToast('消息内容不能为空', 'error'); els.content.focus(); return; }
    var schedule = collectSchedule();
    if (!schedule) return;
    var files = (els.files.value || "").split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean);
    var body = { name: els.name.value.trim(), receiver: rec, content: content, files: files, schedule: schedule, enabled: true };
    var p = state.editingId ? api('PUT', '/api/tasks/' + state.editingId, body) : api('POST', '/api/tasks', body);
    p.then(function () {
      showToast(state.editingId ? '任务已更新' : '任务已创建', 'success');
      resetForm();
      refreshTasks(); refreshStatus();
    }).catch(function (e) { showToast('保存失败：' + apiFail(e), 'error'); });
  }

  function resetForm() {
    state.editingId = null; state.receiver = null;
    els.name.value = ''; els.receiver.value = ''; els.content.value = ''; els.files.value = '';
    els.formTitle.textContent = '新建定时任务';
    els.resetBtn.style.display = 'none';
    els.saveTaskBtn.textContent = '＋ 保存任务';
    setType('daily');
    els.onceAt.value = '';
  }

  function editTask(t) {
    state.editingId = t.id; state.receiver = { wxid: t.receiver.wxid, name: t.receiver.name };
    els.name.value = t.name || ''; els.receiver.value = t.receiver.name || t.receiver.wxid;
    els.content.value = t.content || '';
    els.files.value = (t.files || []).join('\n');
    setType(t.schedule.type);
    var s = t.schedule;
    if (s.type === 'once') els.onceAt.value = s.at.slice(0, 16);
    if (s.type === 'daily') els.dailyTime.value = s.time;
    if (s.type === 'weekly') { els.weeklyTime.value = s.time; state.weekdays = (s.weekdays || []).slice(); buildWeekdays(); }
    if (s.type === 'monthly') { els.monthlyDay.value = s.day; els.monthlyTime.value = s.time; els.monthlyClamp.checked = s.clamp !== false; }
    if (s.type === 'yearly') {
      var md = String(s.date || '').replace(/^\d{4}-/, '').split('-');
      els.yearlyMonth.value = +md[0] || 1; els.yearlyDay.value = +md[1] || 1; els.yearlyTime.value = s.time;
    }
    els.formTitle.textContent = '编辑任务：' + (t.name || t.id);
    els.resetBtn.style.display = '';
    els.saveTaskBtn.textContent = '保存修改';
    els.form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ===== 任务列表渲染 =====
  function renderTasks() {
    if (!state.tasks.length) { els.taskList.innerHTML = '<div class="ws-none">暂无定时任务，在上方创建第一个</div>'; els.taskCount.textContent = ''; return; }
    els.taskCount.textContent = '（' + state.tasks.filter(function (t) { return t.enabled; }).length + ' 启用 / ' + state.tasks.length + '）';
    els.taskList.innerHTML = state.tasks.map(function (t) {
      var nextTxt = t.enabled ? fmtTime(t.next_fire) : '已停用';
      var last = t.last_result || {};
      var lastTxt = last.time ? (last.ok ? '上次成功 ' : '上次失败 ') + fmtTime(last.time) : '尚未发送过';
      return '<div class="ws-task' + (t.enabled ? '' : ' off') + '" data-id="' + esc(t.id) + '">' +
        '<div class="ws-task-main">' +
          '<div class="ws-task-name">' + esc(t.name || t.receiver.wxid) +
            '<span class="ws-badge ' + (t.enabled ? 'on' : 'off') + '">' + (t.enabled ? '启用' : '停用') + '</span></div>' +
          '<div class="ws-task-meta">' +
            '<span>→ ' + esc(t.receiver.name || t.receiver.wxid) + '</span>' +
            '<span>' + esc(scheduleText(t.schedule)) + '</span>' +
            '<span>下次 <b>' + esc(nextTxt) + '</b></span>' +
            '<span>' + esc(lastTxt) + '</span></div>' +
          '<div class="ws-task-content">' + esc((t.content || '').slice(0, 80)) + '</div>' +
        '</div>' +
        '<div class="ws-task-actions">' +
          '<button class="btn-mini act-toggle">' + (t.enabled ? '停用' : '启用') + '</button>' +
          '<button class="btn-mini act-dry" title="打开会话+输入框校验，不实际发送">演练</button>' +
          '<button class="btn-mini act-run" title="立即发送一次">发送</button>' +
          '<button class="btn-mini act-edit">编辑</button>' +
          '<button class="btn-mini danger act-del">删除</button>' +
        '</div></div>';
    }).join('');
    Array.prototype.forEach.call(els.taskList.querySelectorAll('.ws-task'), function (row) {
      var id = row.dataset.id, task = null;
      state.tasks.forEach(function (t) { if (t.id === id) task = t; });
      if (!task) return;
      row.querySelector('.act-toggle').addEventListener('click', function () {
        api('PUT', '/api/tasks/' + id, { enabled: !task.enabled }).then(function () {
          showToast(task.enabled ? '已停用' : '已启用，下次 ' + '由服务计算', 'success'); refreshTasks(); refreshStatus();
        }).catch(function (e) { showToast(apiFail(e), 'error'); });
      });
      row.querySelector('.act-dry').addEventListener('click', function (btn) {
        btn.disabled = true;
        api('POST', '/api/tasks/' + id + '/dryrun').then(function () {
          showToast('演练完成：会话已打开、内容已校验，未实际发送（见历史）', 'success'); refreshHistory();
        }).catch(function (e) { showToast('演练失败：' + apiFail(e), 'error'); })
          .finally(function () { btn.disabled = false; });
      });
      row.querySelector('.act-run').addEventListener('click', function (btn) {
        btn.disabled = true;
        api('POST', '/api/tasks/' + id + '/run').then(function () {
          showToast('已立即发送（见历史）', 'success'); refreshHistory(); refreshTasks();
        }).catch(function (e) { showToast('发送失败：' + apiFail(e), 'error'); })
          .finally(function () { btn.disabled = false; });
      });
      row.querySelector('.act-edit').addEventListener('click', function () { editTask(task); });
      row.querySelector('.act-del').addEventListener('click', function () {
        if (!confirm('删除任务「' + (task.name || task.id) + '」？')) return;
        api('DELETE', '/api/tasks/' + id).then(function () { showToast('已删除', 'success'); refreshTasks(); refreshStatus(); })
          .catch(function (e) { showToast(apiFail(e), 'error'); });
      });
    });
  }

  function scheduleText(s) {
    if (!s) return '—';
    if (s.type === 'once') { try { return new Date(s.at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) + '（一次性）'; } catch (e) { return s.at; } }
    if (s.type === 'daily') return '每天 ' + s.time;
    if (s.type === 'weekly') return '每周 ' + (s.weekdays || []).map(function (w) { return WEEKDAY_LABELS[w - 1]; }).join('/') + ' ' + s.time;
    if (s.type === 'monthly') return '每月 ' + s.day + ' 日 ' + s.time + (s.clamp === false ? '（无此日跳过）' : '（无此日提前月末）');
    if (s.type === 'yearly') return '每年 ' + String(s.date || '').replace(/^\d{4}-/, '') + ' ' + s.time;
    return String(s.type);
  }

  // ===== 历史渲染 =====
  function renderHistory(entries) {
    if (!entries.length) { els.histList.innerHTML = '<div class="ws-none">暂无记录</div>'; return; }
    els.histList.innerHTML = entries.map(function (e) {
      var badges =
        (e.catchup ? '<span class="ws-hist-tag catchup">补发</span>' : '') +
        (e.manual ? '<span class="ws-hist-tag manual">手动</span>' : '') +
        (e.dry_run ? '<span class="ws-hist-tag manual">演练</span>' : '') +
        (e.skipped ? '<span class="ws-hist-tag catchup">放弃</span>' : '');
      var body = (e.content || '').replace(/\n/g, ' ');
      if (e.skipped) body = e.error || body;
      return '<div class="ws-hist-row" data-id="' + esc(e.id || '') + '">' +
        '<span class="ws-hist-time">' + esc(fmtTime(e.time)) + '</span>' +
        '<span class="ws-hist-main">' +
          '<span class="ws-hist-line1"><span class="ws-hist-task">' + esc(e.task_name) + '</span>' + badges +
            (e.receiver_name && !e.skipped ? '<span class="ws-hist-to">→ ' + esc(e.receiver_name) + '</span>' : '') + '</span>' +
          '<span class="ws-hist-body">' + esc(body) + '</span>' +
        '</span>' +
        '<span class="ws-hist-state ' + (e.ok ? 'ok' : 'fail') + '">' + (e.ok ? '✓' : '✗') + '</span>' +
        (e.id ? '<button class="ws-hist-del" title="删除这条记录">✕</button>' : '') +
        (!e.ok && !e.skipped && e.error ? '<span class="ws-hist-err">' + esc(e.error) + '</span>' : '') +
        '</div>';
    }).join('');
  }

  // 历史行内删除（事件委托）+ 清空全部
  function bindHistoryActions() {
    els.histList.addEventListener('click', function (ev) {
      var btn = ev.target.closest ? ev.target.closest('.ws-hist-del') : null;
      if (!btn) return;
      var row = btn.closest('.ws-hist-row');
      var id = row && row.dataset.id;
      if (!id) return;
      api('DELETE', '/api/history/' + id).then(function () {
        showToast('已删除该条记录', 'success');
        refreshHistory();
      }).catch(function (e) { showToast(apiFail(e), 'error'); });
    });
    els.clearHistBtn.addEventListener('click', function () {
      if (!confirm('清空全部发送历史？（不影响定时任务）')) return;
      api('DELETE', '/api/history').then(function () {
        showToast('已清空发送历史', 'success');
        refreshHistory();
      }).catch(function (e) { showToast(apiFail(e), 'error'); });
    });
  }

  // ===== 连接区交互 =====
  function saveConn() {
    state.base = els.base.value.trim() || defaultBase();
    state.token = els.token.value.trim();
    store.set(K_BASE, state.base); store.set(K_TOKEN, state.token);
    refreshStatus().then(function () {
      showToast('连接成功', 'success');
      refreshContacts(true); refreshTasks(); refreshHistory();
    }).catch(function (e) { showToast(apiFail(e), 'error'); });
  }
  function defaultBase() {
    if (location.protocol === 'http:' || location.protocol === 'https:') return location.origin;
    return 'http://127.0.0.1:8765';
  }

  // ===== 环境体检（psauto 通道）=====
  function runDoctor() {
    els.doctorBtn.disabled = true;
    els.doctorText.textContent = '体检中…';
    api('GET', '/api/doctor').then(function (d) {
      var info = d.data || {};
      var parts = [];
      if (info.window_found) parts.push('微信窗口 ✓（' + (info.mode === 'uia' ? 'uia 模式，可校验会话标题' : 'keyboard 模式，务必使用唯一前缀备注名') + '）');
      else parts.push('未找到微信主窗口——请打开微信并登录');
      if (info.locked) parts.push('屏幕已锁定——解锁后才能发送');
      if (info.version) parts.push('微信 ' + info.version);
      els.doctorText.textContent = '体检：' + parts.join('；') + (d.ok ? '' : '｜' + (d.code_text || d.error || ''));
      showToast(d.ok ? '体检通过（' + (info.mode || 'ok') + '）' : '体检未通过：' + (d.code_text || d.error || ''), d.ok ? 'success' : 'error');
    }).catch(function (e) {
      els.doctorText.textContent = '体检失败：' + apiFail(e);
    }).finally(function () { els.doctorBtn.disabled = false; });
  }

  // ===== 聊天记录 AI 总结 =====
  var sum = { messages: [], display: '', window: '', raw: '', rangeKey: '7d', receiver: null };
  var SUM_STATS_HINT = '读取需 PC 微信保持登录；首次读取约 20 秒（本地密钥提取）';
  var SUM_SYS = '你是专业的微信聊天记录分析助手。用户会提供一段微信聊天记录（每行格式：[日期 时间] 发送人: 内容，可能含 [图片]/[语音] 等占位）。请通读后输出 Markdown 总结，严格按以下结构：\n' +
    '## 📌 内容重点\n按话题分条概括讨论了什么事、达成的结论/决定（3-8 条，无实质内容的寒暄忽略）\n' +
    '## ✅ 待执行任务\nMarkdown 表格：| 任务 | 责任人 | 优先级 | 截止时间 |（从 @ 提及与上下文推断责任人；没有明确待办就写"无明确待办"）\n' +
    '## ⏰ 关键时间点\n列出聊天中提到的重要时间约定；没有写"无"\n' +
    '要求：只依据给定记录，不编造；简洁；输出语言以用户消息中「输出语言」指定为准（未指定用中文）。';

  function pad2(n) { return ('0' + n).slice(-2); }
  function isoLocal(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + 'T' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }
  function computeRange() {
    var n = new Date(), k = sum.rangeKey;
    if (k === 'today') return { start: isoLocal(new Date(n.getFullYear(), n.getMonth(), n.getDate())), end: '' };
    if (k === 'yesterday') return { start: isoLocal(new Date(n.getFullYear(), n.getMonth(), n.getDate() - 1)), end: isoLocal(new Date(n.getFullYear(), n.getMonth(), n.getDate())) };
    if (k === '3d' || k === '7d') return { start: isoLocal(new Date(n.getTime() - (k === '3d' ? 72 : 168) * 3600 * 1000)), end: '' };
    if (!els.rangeStart.value) { showToast('请选择开始时间', 'error'); return null; }
    return { start: els.rangeStart.value, end: els.rangeEnd.value || '' };
  }
  function msgLine(m) {
    return '[' + String(m.time || '').slice(5, 16) + '] ' + (m.sender_name || m.sender_wxid || '?') + ': ' + String(m.content || '').replace(/\n/g, ' ');
  }
  function buildCorpus() {
    var text = sum.messages.map(msgLine).join('\n');
    if (text.length > 60000) {
      text = text.slice(0, 20000) + '\n……（中间 ' + (text.length - 60000) + ' 字符已省略）……\n' + text.slice(-40000);
    }
    return text;
  }

  // ---- 输出语言下拉（复用共享 OUTPUT_LANGS，30 种全球常用语言）----
  function buildLangSelect() {
    var langs = (window.AiService && AiService.OUTPUT_LANGS) || [{ code: 'zh', label: '中文' }];
    els.sumLang.innerHTML = langs.map(function (l) {
      return '<option value="' + esc(l.code) + '">' + esc(l.label) + '</option>';
    }).join('');
    var saved = store.get(K_LANG);
    els.sumLang.value = saved && langs.some(function (l) { return l.code === saved; }) ? saved : 'zh';
    els.sumLang.addEventListener('change', function () { store.set(K_LANG, els.sumLang.value); });
  }
  function langName(code) {
    if (window.AiService && typeof AiService.getOutputLang === 'function') {
      var l = AiService.getOutputLang(code);
      if (l) return l.name || l.label;
    }
    return code === 'zh' ? 'Simplified Chinese (中文)' : code;
  }

  // ---- 清除已加载记录与总结结果 ----
  function clearSummary() {
    sum.messages = []; sum.raw = ''; sum.display = ''; sum.window = '';
    sum.receiver = null;
    els.sumReceiver.value = '';
    els.preview.textContent = '';
    els.previewWrap.classList.remove('open');
    els.sumResult.innerHTML = '';
    els.sumResultWrap.style.display = 'none';
    resetWechatSection();
    els.sumStats.textContent = SUM_STATS_HINT;
    els.sumBtn.disabled = true;
    els.sumBtn.style.opacity = '.5';
    els.clearSumBtn.style.display = 'none';
  }

  function readSummary() {
    var raw = els.sumReceiver.value.trim();
    if (!raw) { showToast('请选择或输入会话', 'error'); return; }
    var target = (sum.receiver && sum.receiver.name === raw) ? (sum.receiver.wxid || sum.receiver.name) : raw;
    var r = computeRange();
    if (!r) return;
    els.readBtn.disabled = true;
    els.sumBtn.disabled = true; els.sumBtn.style.opacity = '.5';
    els.sumStats.textContent = '读取中…（首次约 20 秒，需微信保持登录）';
    var q = '?target=' + encodeURIComponent(target) + '&start=' + encodeURIComponent(r.start) + (r.end ? '&end=' + encodeURIComponent(r.end) : '');
    api('GET', '/api/messages' + q).then(function (d) {
      sum.messages = d.messages || [];
      sum.display = d.display || raw;
      sum.window = r.start.replace('T', ' ') + (r.end ? ' ~ ' + r.end.replace('T', ' ') : ' ~ 现在');
      els.sumResultWrap.style.display = 'none';
      resetWechatSection(); sum.raw = '';
      if (!sum.messages.length) {
        els.previewWrap.classList.remove('open');
        els.sumStats.textContent = '时间窗口内没有消息（已扫描最近 ' + d.scanned + ' 条）';
        showToast('该时间段无消息', 'info');
        return;
      }
      var lines = sum.messages.map(msgLine);
    els.preview.textContent = lines.slice(0, 80).join('\n') + (lines.length > 80 ? '\n…（预览截断，AI 总结将使用全部 ' + lines.length + ' 条）' : '');
    els.previewWrap.classList.add('open');
    els.sumStats.textContent = '命中 ' + sum.messages.length + ' 条（扫描 ' + d.scanned + '）· ' + sum.display + ' · ' + sum.window;
    els.sumBtn.disabled = false; els.sumBtn.style.opacity = '';
    els.clearSumBtn.style.display = '';
    }).catch(function (e) {
      els.sumStats.textContent = '';
      showToast('读取失败：' + apiFail(e), 'error');
    }).finally(function () { els.readBtn.disabled = false; });
  }

  function aiSummarize() {
    if (!window.AiService || typeof window.AiService.chat !== 'function') { showToast('AI 服务未加载', 'error'); return; }
    var cfg = typeof AiService.getConfig === 'function' ? AiService.getConfig() : {};
    if (!cfg.baseUrl || !cfg.apiKey || !cfg.model) { openAiCard(true); showToast('请先配置大模型接口', 'error'); return; }
    els.sumBtn.disabled = true; els.sumBtn.textContent = '⏳ 总结中…';
    var langCode = els.sumLang.value || 'zh';
    AiService.chat({
      messages: [
        { role: 'system', content: SUM_SYS },
        { role: 'user', content: '输出语言：' + langName(langCode) + '（除专有名词/型号/wxid 外全部使用该语言）\n\n会话：' + sum.display + '\n时间范围：' + sum.window + '\n聊天记录（共 ' + sum.messages.length + ' 条）：\n\n' + buildCorpus() }
      ],
      temperature: 0.3
    }).then(function (md) {
      md = String(md || '').trim();
      if (!md) throw new Error('AI 返回为空');
      sum.raw = md;
      els.sumResult.innerHTML = window.renderMarkdown ? renderMarkdown(md) : '<pre>' + esc(md) + '</pre>';
      els.sumResultWrap.style.display = '';
      resetWechatSection();
      return api('POST', '/api/summaries', { display: sum.display, window: sum.window, count: sum.messages.length, result: md });
    }).then(function () {
      refreshSummaries();
      els.clearSumBtn.style.display = '';
      showToast('总结完成', 'success');
    }).catch(function (e) {
      showToast('总结失败：' + (e && e.message || e), 'error');
    }).finally(function () {
      els.sumBtn.disabled = false; els.sumBtn.textContent = '✨ AI 总结'; els.sumBtn.style.opacity = '';
    });
  }

  // ---- 总结记录列表 ----
  function refreshSummaries() {
    return api('GET', '/api/summaries?limit=30').then(function (d) {
      var items = d.items || [];
      els.sumCount.textContent = items.length ? '（' + items.length + '）' : '';
      els.sumClearBtn.style.display = items.length ? '' : 'none';
      if (!items.length) { els.sumList.innerHTML = '<div class="ws-none">暂无总结记录</div>'; return; }
      els.sumList.innerHTML = items.map(function (it) {
        return '<div class="ws-sum-item" data-id="' + esc(it.id) + '">' +
          '<div class="ws-sum-head"><span>' + esc(String(it.created_at || '').replace('T', ' ')) + '</span>' +
            '<b>' + esc(it.display) + '</b>' +
            '<span class="ws-sum-meta">' + esc(it.window || '') + ' · ' + (it.count || 0) + ' 条</span>' +
            '<span style="margin-left:auto;display:flex;gap:8px;align-items:center;">' +
              '<span class="ws-sum-meta">展开 ▾</span><button class="btn-mini danger act-sdel">✕</button></span>' +
          '</div>' +
          '<div class="ws-sum-body"><div class="ws-md"></div></div>' +
        '</div>';
      }).join('');
      els.sumList._items = items;
    }).catch(function () {});
  }
  function bindSummaryList() {
    els.sumList.addEventListener('click', function (ev) {
      var item = ev.target.closest('.ws-sum-item');
      if (!item) return;
      var del = ev.target.closest('.act-sdel');
      if (del) {
        ev.stopPropagation();
        api('DELETE', '/api/summaries/' + item.dataset.id).then(refreshSummaries)
          .catch(function (e) { showToast(apiFail(e), 'error'); });
        return;
      }
      var body = item.querySelector('.ws-sum-body');
      var open = item.classList.toggle('open');
      if (open && body && !body.dataset.rendered) {
        var it = (els.sumList._items || []).filter(function (x) { return x.id === item.dataset.id; })[0];
        body.innerHTML = '<div class="ws-md">' + (window.renderMarkdown ? renderMarkdown(it ? it.result : '') : esc(it ? it.result : '')) + '</div>';
        body.dataset.rendered = '1';
      }
      var hintEl = item.querySelector('.ws-sum-head span:last-child .ws-sum-meta');
      if (hintEl) hintEl.textContent = open ? '收起 ▴' : '展开 ▾';
    });
    els.sumClearBtn.addEventListener('click', function () {
      if (!confirm('清空全部总结记录？')) return;
      api('DELETE', '/api/summaries').then(function () { showToast('已清空', 'success'); refreshSummaries(); })
        .catch(function (e) { showToast(apiFail(e), 'error'); });
    });
  }

  // ---- 大模型接口卡（AiService 共享配置，模式同 AI 解析）----
  function openAiCard(force) {
    els.aiContent.classList.toggle('open', force !== false);
    els.aiIcon.classList.toggle('collapsed', !els.aiContent.classList.contains('open'));
  }
  function fillAiConfig(c) {
    if (!c) return;
    if (c.baseUrl) els.aiUrl.value = c.baseUrl;
    if (c.apiKey) els.aiKey.value = c.apiKey;
    if (c.model) els.aiModel.value = c.model;
    var ok = !!(c.baseUrl && c.apiKey && c.model);
    els.aiStatus.className = 'ws-api-status' + (ok ? ' ok' : '');
    els.aiStatusText.textContent = ok ? '已配置 · ' + (c.model || '') : '未配置';
    openAiCard(!ok); // 未配置自动展开引导，已配置收起
  }
  function bindAiCard() {
    if (window.AiService) {
      // 初始值读本地共享配置（与智能翻译等同源共享的 translate_config），
      // initConfigSync 只负责后续实时同步（插件广播/chrome.storage 变更）——两步都要
      if (typeof AiService.getConfig === 'function') {
        var c0 = AiService.getConfig();
        if (c0 && c0.baseUrl) fillAiConfig(c0);
      }
      if (typeof AiService.initConfigSync === 'function') AiService.initConfigSync(fillAiConfig);
    }
    els.aiIcon.addEventListener('click', function () {
      els.aiContent.classList.toggle('open');
      els.aiIcon.classList.toggle('collapsed', !els.aiContent.classList.contains('open'));
    });
    els.aiSave.addEventListener('click', function () {
      if (!window.AiService) { showToast('AI 服务未加载', 'error'); return; }
      var baseUrl = els.aiUrl.value.trim().replace(/\/+$/, '');
      var apiKey = els.aiKey.value.trim();
      var model = els.aiModel.value.trim();
      if (!baseUrl || !apiKey || !model) { showToast('Base URL / API Key / 模型 均必填', 'error'); return; }
      if (!/^https?:\/\//i.test(baseUrl)) { showToast('Base URL 需以 http(s):// 开头', 'error'); return; }
      AiService.saveConfig({ baseUrl: baseUrl, apiKey: apiKey, model: model });
      fillAiConfig({ baseUrl: baseUrl, apiKey: apiKey, model: model });
      showToast('配置已保存（与其他模块互通）', 'success');
    });
  }

  // ---- 会话联想（复用联系人列表，独立实例）----
  function renderSumSuggest(q) {
    var box = els.sumSuggest;
    var query = (q || '').trim().toLowerCase();
    var list = state.contacts.filter(function (c) {
      return !query || c.name.toLowerCase().indexOf(query) >= 0 || c.wxid.toLowerCase().indexOf(query) >= 0;
    }).slice(0, 30);
    if (!list.length) {
      box.innerHTML = '<div class="ws-suggest-empty">' + (state.contacts.length ? '无匹配，可直接输入会话名称' : '联系人加载中…（服务重启后首次约 20 秒，稍后重开本框即有列表）') + '</div>';
      box.classList.add('open'); return;
    }
    box.innerHTML = list.map(function (c) {
      return '<div class="ws-suggest-item" data-wxid="' + esc(c.wxid) + '" data-name="' + esc(c.name) + '">' +
        '<span>' + esc(c.name) + '</span><span class="tag">' + (c.group ? '群' : '好友') + '</span></div>';
    }).join('');
    box.classList.add('open');
    Array.prototype.forEach.call(box.querySelectorAll('.ws-suggest-item'), function (it) {
      it.addEventListener('mousedown', function (e) {
        e.preventDefault();
        sum.receiver = { wxid: it.dataset.wxid, name: it.dataset.name };
        els.sumReceiver.value = it.dataset.name;
        box.classList.remove('open');
      });
    });
  }

  // ---- 复制 / 微信格式（处理方式与工作报告页一致：展开区 + 独立复制按钮 + 新结果自动重置）----
  function fallbackCopy(t) {
    var ta = document.createElement('textarea');
    ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(ta);
  }
  function copyText(text, okMsg) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { showToast(okMsg, 'success'); })
        .catch(function () { fallbackCopy(text); showToast(okMsg, 'success'); });
    } else { fallbackCopy(text); showToast(okMsg, 'success'); }
  }
  function resetWechatSection() {
    els.sumWechat.textContent = '';
    delete els.sumWechat.dataset.rawText;
    els.sumWechatSection.style.display = 'none';
  }
  function convertToWechat() {
    var raw = sum.raw || '';
    if (!raw) { showToast('暂无总结内容可转换', 'error'); return; }
    if (!window.markdownToWechat) { showToast('markdown.js 未加载', 'error'); return; }
    var text = markdownToWechat(raw);
    if (!text) { showToast('暂无总结内容可转换', 'error'); return; }
    els.sumWechat.textContent = text;
    els.sumWechat.dataset.rawText = text;
    els.sumWechatSection.style.display = 'block';
    showToast('已生成微信格式，点击「复制」即可粘贴发送', 'success');
  }
  function copyWechat() {
    var text = els.sumWechat.dataset.rawText || els.sumWechat.textContent || '';
    if (!text) { showToast('请先生成微信格式', 'error'); return; }
    copyText(text, '微信格式已复制到剪贴板');
  }

  // ---- 下载 Markdown / HTML（模式同工作报告/邮件总结，HTML 用共享 renderMarkdown 以支持任务表格）----
  function stampNow() {
    var d = new Date();
    return '' + d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) + '-' + pad2(d.getHours()) + pad2(d.getMinutes());
  }
  function baseFilename() {
    var safe = String(sum.display || 'chat').replace(/[\\/:*?"<>|#@\s]+/g, '_').slice(0, 40);
    return 'wx-summary-' + safe + '-' + stampNow();
  }
  function triggerDownload(content, filename, mime) {
    var blob = new Blob([content], { type: mime });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
  }
  function buildHtmlReport(md) {
    var body = window.renderMarkdown ? renderMarkdown(md) : '<pre>' + esc(md) + '</pre>';
    var meta = esc(sum.display) + ' ｜ ' + esc(sum.window) + ' ｜ ' + sum.messages.length + ' 条消息 ｜ 生成于 ' + fmt_dt_now();
    return '<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n<meta charset="UTF-8"/>\n'
      + '<meta name="viewport" content="width=device-width, initial-scale=1.0"/>\n'
      + '<title>聊天记录总结 · ' + esc(sum.display) + '</title>\n'
      + '<style>\n'
      + '  body{font-family:Inter,"Noto Sans SC",-apple-system,sans-serif;background:#f6f8f7;color:#1f2d27;'
      + '  padding:40px 24px;max-width:900px;margin:0 auto;line-height:1.8;font-size:15px;}\n'
      + '  .meta{font-size:0.82rem;color:#5f7a70;background:#e7f3ec;border:1px solid #cde5d8;border-radius:10px;padding:8px 14px;margin-bottom:24px;}\n'
      + '  h1{font-size:1.5rem;color:#17a34a;border-bottom:2px solid #cde5d8;padding-bottom:10px;margin:26px 0 14px;}\n'
      + '  h2{font-size:1.2rem;color:#178a41;margin:26px 0 12px;}\n'
      + '  h3,h4{color:#2b3d35;margin:18px 0 8px;}\n'
      + '  ul,ol{margin:8px 0 16px 22px;} li{margin:5px 0;}\n'
      + '  strong{color:#111;}\n'
      + '  table{border-collapse:collapse;width:100%;margin:12px 0;font-size:0.88rem;background:#fff;}\n'
      + '  th,td{border:1px solid #d5e3da;padding:8px 12px;text-align:left;}\n'
      + '  th{background:#e7f3ec;color:#17603a;}\n'
      + '  blockquote{border-left:3px solid #17a34a;margin:10px 0;padding:4px 14px;color:#5f7a70;background:#eef6f1;}\n'
      + '  code{background:#e7f3ec;padding:2px 6px;border-radius:5px;font-size:0.88em;}\n'
      + '  hr{border:none;border-top:1px solid #d5e3da;margin:22px 0;}\n'
      + '  a{color:#178a41;}\n'
      + '  @media print{body{background:#fff;padding:0;}}\n'
      + '</style>\n</head>\n<body>\n'
      + '<div class="meta">' + meta + '</div>\n'
      + body
      + '\n</body>\n</html>';
  }
  function fmt_dt_now() {
    var d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }
  function downloadSummary(format) {
    if (!sum.raw) { showToast('暂无总结内容可下载', 'error'); return; }
    if (format === 'md') {
      triggerDownload(sum.raw, baseFilename() + '.md', 'text/markdown;charset=utf-8');
      showToast('已下载 Markdown', 'success');
    } else {
      triggerDownload(buildHtmlReport(sum.raw), baseFilename() + '.html', 'text/html;charset=utf-8');
      showToast('已下载 HTML 报告', 'success');
    }
  }
  function bindResultActions() {
    els.sumCopyBtn.addEventListener('click', function () {
      if (!sum.raw) { showToast('暂无总结内容可复制', 'error'); return; }
      copyText(sum.raw, '已复制总结原文');
    });
    els.sumWxBtn.addEventListener('click', convertToWechat);
    els.sumCopyWechatBtn.addEventListener('click', copyWechat);
    els.sumDlMdBtn.addEventListener('click', function () { downloadSummary('md'); });
    els.sumDlHtmlBtn.addEventListener('click', function () { downloadSummary('html'); });
  }

  // ===== 一键拉起服务（扩展环境专属；云同步设置已统一到 ☁ 抽屉）=====
  function bindWake() {
    if (!isExtension) return;
    els.wakeBtn.style.display = '';
    els.wakeBtn.addEventListener('click', function () {
      els.wakeBtn.disabled = true;
      var startPoll = function () {
        var tries = 0;
        var iv = setInterval(function () {
          tries++;
          api('GET', '/api/status').then(function () {
            clearInterval(iv); els.wakeBtn.disabled = false;
            showToast('服务已拉起 ✓', 'success'); refreshAll();
          }).catch(function () {
            if (tries > 12) { clearInterval(iv); els.wakeBtn.disabled = false; showToast('拉起未成功，请手动运行 start_wx_scheduler.bat', 'error'); }
          });
        }, 1000);
      };
      try {
        chrome.runtime.sendMessage({ action: 'linguaflow:startScheduler' }, function (r) {
          if (chrome.runtime.lastError || (r && r.ok === false)) {
            els.wakeBtn.disabled = false;
            showToast('拉起失败：' + ((r && r.error) || (chrome.runtime.lastError && chrome.runtime.lastError.message) || '未知'), 'error');
            return;
          }
          startPoll();
        });
      } catch (e) { els.wakeBtn.disabled = false; showToast('拉起不可用：' + e.message, 'error'); }
    });
  }


  // ===== 初始化 =====
  function init() {
    els = {
      toast: $('wsToast'), dot: $('wsDot'), statusText: $('wsStatusText'),
      base: $('wsBase'), token: $('wsToken'), saveBtn: $('wsSaveBtn'), guideBtn: $('wsGuideBtn'),
      guide: $('wsGuide'), offlineTip: $('wsOfflineTip'), versionHint: $('wsVersionHint'),
      name: $('wsName'), receiver: $('wsReceiver'), suggest: $('wsSuggest'), content: $('wsContent'), files: $('wsFiles'),
      typeSeg: $('wsTypeSeg'), onceWrap: $('wsOnceWrap'), onceAt: $('wsOnceAt'),
      dailyWrap: $('wsDailyWrap'), dailyTime: $('wsDailyTime'), weeklyWrap: $('wsWeeklyWrap'),
      weeklyTime: $('wsWeeklyTime'), weekdays: $('wsWeekdays'),
      monthlyWrap: $('wsMonthlyWrap'), monthlyDay: $('wsMonthlyDay'), monthlyTime: $('wsMonthlyTime'), monthlyClamp: $('wsMonthlyClamp'),
      yearlyWrap: $('wsYearlyWrap'), yearlyMonth: $('wsYearlyMonth'), yearlyDay: $('wsYearlyDay'), yearlyTime: $('wsYearlyTime'),
      doctorBtn: $('wsDoctorBtn'), doctorText: $('wsDoctorText'),
      form: $('wsFormPanel'), formTitle: $('wsFormTitle'), resetBtn: $('wsResetFormBtn'), saveTaskBtn: $('wsSaveTaskBtn'),
      risk: $('wsRisk'), riskAck: $('wsRiskAck'),
      taskList: $('wsTaskList'), taskCount: $('wsTaskCount'), reloadBtn: $('wsReloadBtn'), histList: $('wsHistList'),
      histCount: $('wsHistCount'), clearHistBtn: $('wsClearHistBtn'),
      sumReceiver: $('wsSumReceiver'), sumSuggest: $('wsSumSuggest'),
      rangeSeg: $('wsRangeSeg'), rangeCustom: $('wsRangeCustom'), rangeStart: $('wsRangeStart'), rangeEnd: $('wsRangeEnd'),
      readBtn: $('wsReadBtn'), sumBtn: $('wsSumBtn'), sumStats: $('wsSumStats'), clearSumBtn: $('wsClearSumBtn'), sumLang: $('wsSumLang'),
      previewWrap: $('wsPreviewWrap'), preview: $('wsPreview'),
      sumResultWrap: $('wsSumResultWrap'), sumResult: $('wsSumResult'), sumWechat: $('wsSumWechat'),
      sumCopyBtn: $('wsSumCopyBtn'), sumWxBtn: $('wsSumWxBtn'),
      sumDlMdBtn: $('wsSumDlMdBtn'), sumDlHtmlBtn: $('wsSumDlHtmlBtn'),
      sumList: $('wsSumList'), sumCount: $('wsSumCount'), sumClearBtn: $('wsSumClearBtn'),
      sumWechatSection: $('wsSumWechatSection'), sumCopyWechatBtn: $('wsSumCopyWechatBtn'),
      aiUrl: $('wsAiUrl'), aiKey: $('wsAiKey'), aiModel: $('wsAiModel'), aiSave: $('wsAiSave'),
      aiStatus: $('wsAiStatus'), aiStatusText: $('wsAiStatusText'), aiIcon: $('wsAiIcon'), aiContent: $('wsAiContent'),
      wakeBtn: $('wsWakeBtn')
    };

    store.init(function () {
      state.base = store.get(K_BASE) || defaultBase();
      state.token = store.get(K_TOKEN) || '';
      els.base.value = state.base; els.token.value = state.token;
      if (store.get(K_ACK)) els.riskAck.checked = true;
      buildWeekdays(); setType('daily');
      buildLangSelect();
      // 联系人缓存预热：10 分钟内的上次结果直接可用，打开输入框即有列表；随后后台刷新
      var cc = store.get(K_CONTACTS);
      if (cc && cc.list && Date.now() - (cc.t || 0) < CONTACTS_TTL) state.contacts = cc.list;

      els.saveBtn.addEventListener('click', saveConn);
      els.doctorBtn.addEventListener('click', runDoctor);
      els.guideBtn.addEventListener('click', function () {
        els.guide.classList.toggle('open');
        els.guideBtn.classList.toggle('collapsed');
      });
      els.reloadBtn.addEventListener('click', refreshAll);
      els.riskAck.addEventListener('change', function () { store.set(K_ACK, els.riskAck.checked); });

      Array.prototype.forEach.call(els.typeSeg.children, function (b) {
        b.addEventListener('click', function () { setType(b.dataset.type); });
      });
      els.receiver.addEventListener('focus', function () {
        state.receiver = null; renderSuggest(els.receiver.value);
        if (!state.contacts.length) refreshContacts(true);
      });
      els.receiver.addEventListener('input', function () { state.receiver = null; renderSuggest(els.receiver.value); });
      els.receiver.addEventListener('blur', function () { setTimeout(function () { els.suggest.classList.remove('open'); }, 150); });
      els.saveTaskBtn.addEventListener('click', saveTask);
      els.resetBtn.addEventListener('click', resetForm);
      bindHistoryActions();

      // 聊天记录总结
      bindAiCard(); bindSummaryList(); bindResultActions(); bindWake(); refreshSummaries();
      els.readBtn.addEventListener('click', readSummary);
      els.sumBtn.addEventListener('click', aiSummarize);
      els.clearSumBtn.addEventListener('click', clearSummary);
      Array.prototype.forEach.call(els.rangeSeg.children, function (b) {
        b.addEventListener('click', function () {
          sum.rangeKey = b.dataset.range;
          Array.prototype.forEach.call(els.rangeSeg.children, function (x) { x.classList.toggle('on', x === b); });
          els.rangeCustom.style.display = sum.rangeKey === 'custom' ? '' : 'none';
        });
      });
      els.sumReceiver.addEventListener('focus', function () {
        sum.receiver = null; renderSumSuggest(els.sumReceiver.value);
        if (!state.contacts.length) refreshContacts(true); // 空列表时聚焦即触发拉取，不等轮询
      });
      els.sumReceiver.addEventListener('input', function () { sum.receiver = null; renderSumSuggest(els.sumReceiver.value); });
      els.sumReceiver.addEventListener('blur', function () { setTimeout(function () { els.sumSuggest.classList.remove('open'); }, 150); });

      refreshAll();
      setInterval(function () { if (!document.hidden) refreshAll(); }, POLL_MS);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
