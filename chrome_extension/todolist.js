(function() {
"use strict";

// ===== Storage =====
var isExtension = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id);
var storage = {
  get: function(keys) {
    return new Promise(function(resolve) {
      if (isExtension) { chrome.storage.local.get(keys, resolve); }
      else {
        var r = {};
        for (var i = 0; i < keys.length; i++) {
          try { r[keys[i]] = JSON.parse(localStorage.getItem('td_' + keys[i]) || 'null'); } catch(e) { r[keys[i]] = null; }
        }
        resolve(r);
      }
    });
  },
  set: function(obj) {
    return new Promise(function(resolve) {
      if (isExtension) { chrome.storage.local.set(obj, resolve); }
      else { for (var k in obj) { localStorage.setItem('td_' + k, JSON.stringify(obj[k])); } resolve(); }
    });
  }
};

// ===== State =====
var todos = [];
var calConfig = {};
var currentFilter = 'all';
var editingTodoId = null;

// ===== Helpers =====
function $(id) { var el = document.getElementById('td-' + id); if (!el) el = document.getElementById(id); if (!el) console.error('[TodoList] #'+id+' not found'); return el; }
function escapeHtml(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
function today() { return new Date().toISOString().split('T')[0]; }

function showToast(msg, type) {
  var t = $('toast'); t.textContent = msg; t.className = 'toast ' + (type||'success') + ' show';
  clearTimeout(t._t); t._t = setTimeout(function() { t.classList.remove('show'); }, 2800);
}

// ===== Filter =====
function getFilteredTodos() {
  var list = todos.slice();
  if (currentFilter === 'today') { list = list.filter(function(t) { return t.date === today(); }); }
  else if (currentFilter === 'completed') { list = list.filter(function(t) { return t.completed; }); }
  else { list = list.filter(function(t) { return !t.completed; }); }
  list.sort(function(a, b) { return a.date.localeCompare(b.date) || a.time.localeCompare(b.time); });
  return list;
}

// ===== Stats =====
function updateStats() {
  var td = today();
  var todayTotal = 0, todayDone = 0;
  var allDone = 0;
  for (var i = 0; i < todos.length; i++) {
    if (todos[i].date === td) { todayTotal++; if (todos[i].completed) todayDone++; }
    if (todos[i].completed) allDone++;
  }
  var pct = todayTotal > 0 ? Math.round(todayDone / todayTotal * 100) : 0;
  $('statToday').textContent = todayTotal;
  $('statDone').textContent = todayDone;
  $('statAll').textContent = todos.length;
  $('progressPct').textContent = pct + '%';
  var circle = $('progressCircle');
  if (circle) {
    var circumference = 263.89;
    var offset = circumference - (pct / 100) * circumference;
    circle.setAttribute('stroke-dashoffset', offset);
  }
}

// ===== Render =====
function renderTodos() {
  var list = getFilteredTodos();
  var el = $('todoList');
  updateStats();

  if (list.length === 0) {
    var msgs = { today: ['📅', '今天还没有计划', '享受轻松的一天 ☀️'], completed: ['🎉', '还没有完成的任务', '开始完成第一个任务吧'], all: ['📝', '还没有任务', '点击上方「＋ 添加」创建第一个任务'] };
    var m = msgs[currentFilter] || msgs.all;
    el.innerHTML = '<div class="todo-empty"><span class="emoji">' + m[0] + '</span><p class="empty-title" id="emptyMsg">' + m[1] + '</p><p class="empty-hint">' + m[2] + '</p></div>';
    return;
  }

  var html = '';
  for (var i = 0; i < list.length; i++) {
    var t = list[i];
    var priClass = t.priority === 'high' ? ' pri-high' : t.priority === 'low' ? ' pri-low' : '';
    var completedClass = t.completed ? ' completed' : '';
    var checked = t.completed ? ' checked' : '';
    html += '<div class="todo-item' + priClass + completedClass + '" data-tid="' + t.id + '">';
    html += '<input type="checkbox" class="todo-check" data-tid="' + t.id + '"' + checked + '>';
    html += '<div class="todo-body">';
    html += '<div class="todo-title">' + escapeHtml(t.title) + '</div>';
    html += '<div class="todo-meta">';
    html += '<span>📅 ' + escapeHtml(t.date) + '</span>';
    if (t.time) html += '<span>🕐 ' + escapeHtml(t.time) + '</span>';
    if (t.syncedGoogle) html += '<span class="meta-sync google">✓ Google</span>';
    if (t.syncedIcs) html += '<span class="meta-sync ics">✓ ICS</span>';
    html += '</div></div>';
    html += '<div class="todo-actions">';
    html += '<button class="btn-edit" data-tid="' + t.id + '" title="编辑"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>';
    html += '<button class="btn-del" data-tid="' + t.id + '" title="删除"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg></button>';
    html += '</div></div>';
  }
  el.innerHTML = html;

  el.querySelectorAll('.todo-check').forEach(function(cb) {
    cb.addEventListener('change', function() { toggleComplete(cb.dataset.tid); });
  });
  el.querySelectorAll('.btn-edit').forEach(function(btn) {
    btn.addEventListener('click', function(e) { e.stopPropagation(); editTodo(btn.dataset.tid); });
  });
  el.querySelectorAll('.btn-del').forEach(function(btn) {
    btn.addEventListener('click', function(e) { e.stopPropagation(); deleteTodo(btn.dataset.tid); });
  });
}

// ===== CRUD =====
function addTodo() {
  var titleEl = $('todoTitle');
  var title = titleEl.value.trim();
  if (!title) { showToast('请输入任务标题', 'error'); return; }

  var todo = {
    id: Date.now().toString(),
    title: title,
    date: $('todoDate').value || today(),
    time: $('todoTime').value || '',
    priority: $('todoPriority').value,
    completed: false,
    syncedGoogle: false,
    syncedIcs: false,
    timestamp: Date.now()
  };

  if (editingTodoId) {
    for (var i = 0; i < todos.length; i++) {
      if (todos[i].id === editingTodoId) {
        todo.id = editingTodoId;
        todo.syncedGoogle = todos[i].syncedGoogle;
        todo.syncedIcs = todos[i].syncedIcs;
        todos[i] = todo;
        break;
      }
    }
    editingTodoId = null;
    $('addTodoBtn').textContent = '＋ 添加';
    $('addTodoBtn').classList.remove('editing');
  } else {
    todos.unshift(todo);
  }
  if (todos.length > 500) todos = todos.slice(0, 500);
  saveTodos();
  resetForm();
  renderTodos();
  showToast(editingTodoId ? '任务已更新' : '任务已添加', 'success');
}

function editTodo(id) {
  for (var i = 0; i < todos.length; i++) {
    if (todos[i].id === id) {
      editingTodoId = id;
      $('todoTitle').value = todos[i].title;
      $('todoDate').value = todos[i].date;
      $('todoTime').value = todos[i].time;
      $('todoPriority').value = todos[i].priority;
      $('addTodoBtn').textContent = '✓ 更新';
      $('addTodoBtn').classList.add('editing');
      $('todoTitle').focus();
      return;
    }
  }
}

function deleteTodo(id) {
  todos = todos.filter(function(t) { return t.id !== id; });
  saveTodos();
  renderTodos();
  showToast('任务已删除', 'success');
}

function toggleComplete(id) {
  for (var i = 0; i < todos.length; i++) {
    if (todos[i].id === id) { todos[i].completed = !todos[i].completed; todos[i].timestamp = Date.now(); break; }
  }
  saveTodos();
  renderTodos();
}

function resetForm() {
  $('todoTitle').value = '';
  $('todoDate').value = '';
  $('todoTime').value = '09:00';
  $('todoPriority').value = 'mid';
  editingTodoId = null;
  $('addTodoBtn').textContent = '＋ 添加';
  $('addTodoBtn').classList.remove('editing');
}

function saveTodos() { storage.set({ todo_items: todos }); }

// ===== Markdown Import / Export =====
function toggleMdPanel() {
  var panel = $('mdPanel');
  var btn = $('toggleMdPanel');
  if (!panel || !btn) return;
  var isOpen = panel.classList.contains('open');
  if (isOpen) {
    panel.classList.remove('open');
    btn.classList.remove('active');
  } else {
    panel.classList.add('open');
    btn.classList.add('active');
    $('mdInput').focus();
  }
}

function parseMarkdown(text) {
  var lines = text.split(/\r?\n/);
  var items = [];
  var defaultDate = today();
  var defaultTime = '09:00';
  var defaultPriority = 'mid';

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    // Match Markdown task: - [ ] or - [x] or * [ ] or * [x]
    var match = line.match(/^[\s]*[-*+]\s*\[([ xX])\]\s*(.+)/);
    if (!match) {
      // Also try loose match: lines starting with a task-like pattern without checkbox
      var loose = line.match(/^[\s]*[-*+]\s+(.+)/);
      if (loose) {
        var titleRaw = loose[1].trim();
        if (titleRaw) {
          items.push(extractTaskMeta(titleRaw, defaultDate, defaultTime, defaultPriority, false));
        }
      }
      continue;
    }
    var isCompleted = match[1].toLowerCase() === 'x';
    var titleRaw = match[2].trim();
    if (titleRaw) {
      items.push(extractTaskMeta(titleRaw, defaultDate, defaultTime, defaultPriority, isCompleted));
    }
  }
  return items;
}

function extractTaskMeta(titleRaw, defaultDate, defaultTime, defaultPriority, isCompleted) {
  var title = titleRaw;
  var date = defaultDate;
  var time = defaultTime;
  var priority = defaultPriority;

  // Extract date: @YYYY-MM-DD or @MM-DD
  var dateMatch = title.match(/@(\d{4}-\d{2}-\d{2}|\d{2}-\d{2})\b/);
  if (dateMatch) {
    var d = dateMatch[1];
    if (d.length === 5) {
      // @MM-DD => current year
      d = new Date().getFullYear() + '-' + d;
    }
    date = d;
    title = title.replace(dateMatch[0], '').trim();
  }

  // Extract time: @HH:MM
  var timeMatch = title.match(/@(\d{1,2}:\d{2})\b/);
  if (timeMatch) {
    time = timeMatch[1];
    title = title.replace(timeMatch[0], '').trim();
  }

  // Extract priority: #high / #mid / #low
  var priMatch = title.match(/#(high|mid|low)\b/i);
  if (priMatch) {
    priority = priMatch[1].toLowerCase();
    title = title.replace(priMatch[0], '').trim();
  }

  // Clean up double spaces
  title = title.replace(/\s+/g, ' ').trim();

  return {
    id: Date.now().toString() + '_' + Math.random().toString(36).substr(2, 4),
    title: title,
    date: date,
    time: time,
    priority: priority,
    completed: isCompleted,
    syncedGoogle: false,
    syncedIcs: false,
    timestamp: Date.now()
  };
}

function importMarkdown() {
  var text = $('mdInput').value.trim();
  if (!text) { showToast('请粘贴 Markdown 任务列表', 'error'); return; }

  var items = parseMarkdown(text);
  if (items.length === 0) { showToast('未识别到有效的任务格式，请检查 Markdown 语法', 'error'); return; }

  // Prepend imported items, deduplicate by title+date
  var added = 0;
  for (var i = items.length - 1; i >= 0; i--) {
    var item = items[i];
    var dup = false;
    for (var j = 0; j < todos.length; j++) {
      if (todos[j].title === item.title && todos[j].date === item.date) { dup = true; break; }
    }
    if (!dup) {
      todos.unshift(item);
      added++;
    }
  }

  if (added === 0) { showToast('所有任务已存在，未重复添加', 'info'); }
  else {
    if (todos.length > 500) todos = todos.slice(0, 500);
    saveTodos();
    $('mdInput').value = '';
    toggleMdPanel();
    renderTodos();
    showToast('已导入 ' + added + ' 条任务', 'success');
  }
}

function exportMarkdown() {
  var list = getFilteredTodos();
  if (list.length === 0) { showToast('没有可导出的任务', 'error'); return; }

  var md = '';
  for (var i = 0; i < list.length; i++) {
    var t = list[i];
    var check = t.completed ? '[x]' : '[ ]';
    md += '- ' + check + ' ' + t.title;
    md += ' @' + t.date;
    if (t.time) md += ' @' + t.time;
    md += ' #' + t.priority;
    md += '\n';
  }

  // Copy to clipboard
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(md).then(function() {
      showToast('已复制 ' + list.length + ' 条任务为 Markdown', 'success');
    }).catch(function() {
      fallbackCopy(md, list.length);
    });
  } else {
    fallbackCopy(md, list.length);
  }
}

function fallbackCopy(text, count) {
  var ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed'; ta.style.left = '-9999px';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); showToast('已复制 ' + count + ' 条任务为 Markdown', 'success'); }
  catch(e) { showToast('复制失败，请手动复制', 'error'); }
  document.body.removeChild(ta);
}

// ===== Settings =====
function toggleSettings() {
  var p = $('settingsPanel');
  if (!p) return;
  p.classList.toggle('open');
}

function saveSettings() {
  calConfig.googleClientId = $('googleClientId').value.trim();
  calConfig.googleToken = $('googleToken').value.trim();
  storage.set({ todo_cal_config: calConfig }).then(function() {
    showToast('配置已保存', 'success');
    toggleSettings();
  });
}

// ===== .ics Download (Apple Calendar) =====
function downloadIcs() {
  var list = getFilteredTodos().filter(function(t) { return !t.completed; });
  if (list.length === 0) { showToast('没有可导出的未完成任务', 'error'); return; }

  var now = new Date();
  var dtstamp = now.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  var ics = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//LinguaFlow//TodoList//EN\r\n'
    + 'CALSCALE:GREGORIAN\r\nMETHOD:PUBLISH\r\n';
  for (var i = 0; i < list.length; i++) {
    var t = list[i];
    var time = t.time || '09:00';
    var dt = t.date.replace(/-/g, '') + 'T' + time.replace(/:/g,'') + '00';
    var endDt = addMinutesStr(t.date, time, 30);
    var safeTitle = t.title.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
    ics += 'BEGIN:VEVENT\r\n';
    ics += 'UID:' + t.id + '@linguflow\r\n';
    ics += 'DTSTAMP:' + dtstamp + '\r\n';
    ics += 'DTSTART:' + dt + '\r\n';
    ics += 'DTEND:' + endDt + '\r\n';
    ics += 'SUMMARY:' + safeTitle + '\r\n';
    ics += 'END:VEVENT\r\n';
  }
  ics += 'END:VCALENDAR\r\n';

  var blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'linguaflow-todos-' + today() + '.ics';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(a.href);

  for (var j = 0; j < list.length; j++) { list[j].syncedIcs = true; }
  saveTodos(); renderTodos();
  showToast('已下载 ' + list.length + ' 条任务为 .ics 文件。双击即可导入日历', 'success');
}

function addMinutesStr(date, time, min) {
  var parts = time.split(':'), h = parseInt(parts[0]), m = parseInt(parts[1]) + min;
  return date.replace(/-/g, '') + 'T' + String(h).padStart(2,'0') + String(m).padStart(2,'0') + '00';
}

// ===== Apple Reminders: Download AppleScript =====
function handleAppleSync() {
  var list = getFilteredTodos().filter(function(t) { return !t.completed; });
  if (list.length === 0) { showToast('没有可导出的未完成任务', 'error'); return; }

  var script = generateAppleScript(list);

  // Try URL scheme for one-click import (requires one-time install of bridge app)
  var b64 = btoa(unescape(encodeURIComponent(script)));
  var url = 'linguaflow-reminders://run?script=' + encodeURIComponent(b64);

  // Open URL scheme — if bridge is installed, reminders are created instantly
  var w = window.open(url, '_blank');
  if (w) { setTimeout(function() { w.close(); }, 100); }

  // Also download .applescript file as backup
  downloadAppleScriptFileContent(script, list);

  for (var j = 0; j < list.length; j++) { list[j].syncedIcs = true; }
  saveTodos(); renderTodos();

  showToast('✅ 已导入 ' + list.length + ' 条提醒（如未自动导入，请双击下载的 .applescript 文件）', 'success');
}

function downloadAppleScriptFileContent(script, list) {
  var blob = new Blob([script], { type: 'text/plain;charset=utf-8' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'linguaflow-reminders-' + today() + '.applescript';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
}

function generateAppleScript(list) {
  var lines = [];
  var safe = function(s) { return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"'); };
  lines.push('tell application "Reminders"');
  for (var i = 0; i < list.length; i++) {
    var t = list[i];
    var dueDate = t.date;
    lines.push('  set newReminder to make new reminder with properties {name:"' + safe(t.title) + '"}');
    lines.push('  set due date of newReminder to date "' + dueDate + ' ' + (t.time || '09:00') + ':00"');
    if (t.priority === 'high') {
      lines.push('  set priority of newReminder to 1');
    } else if (t.priority === 'low') {
      lines.push('  set priority of newReminder to 9');
    }
  }
  lines.push('end tell');
  return lines.join('\n');
}

// ===== Google Calendar Sync =====
function syncGoogleCalendar() {
  var token = calConfig.googleToken;
  if (token) {
    // Manual token mode
    doGoogleSync(token);
    return;
  }
  if (!calConfig.googleClientId) {
    // No config — show manual token input
    var ts = $('tokenSection');
    if (ts) ts.classList.add('show');
    showToast('请粘贴 Google Access Token，或配置 Client ID', 'info');
    return;
  }
  // OAuth flow
  startOAuth();
}

function applyManualToken() {
  var token = $('manualToken').value.trim();
  if (!token) { showToast('请粘贴 Access Token', 'error'); return; }
  $('tokenSection').classList.remove('show');
  doGoogleSync(token);
}

function cancelToken() {
  $('tokenSection').classList.remove('show');
  $('manualToken').value = '';
}

function doGoogleSync(token) {
  var list = getFilteredTodos().filter(function(t) { return !t.completed; });
  if (list.length === 0) { showToast('没有可同步的未完成任务', 'error'); return; }

  var success = 0, fail = 0;
  var remaining = list.length;

  function done() {
    saveTodos(); renderTodos();
    showToast('Google 同步完成: ' + success + ' 成功, ' + fail + ' 失败', success > 0 ? 'success' : 'error');
  }

  for (var i = 0; i < list.length; i++) {
    (function(t) {
      var dt = new Date(t.date + 'T' + (t.time || '09:00') + ':00');
      var end = new Date(dt.getTime() + 30*60*1000);
      var tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          summary: t.title,
          start: { dateTime: dt.toISOString(), timeZone: tz },
          end: { dateTime: end.toISOString(), timeZone: tz }
        })
      }).then(function(resp) {
        if (resp.ok) { t.syncedGoogle = true; success++; }
        else { fail++; }
      }).catch(function() { fail++; }).finally(function() {
        remaining--;
        if (remaining === 0) done();
      });
    })(list[i]);
  }
}

function startOAuth() {
  var redirectUri = window.location.href.split('#')[0].split('?')[0];
  var scope = 'https://www.googleapis.com/auth/calendar.events';
  var authUrl = 'https://accounts.google.com/o/oauth2/v2/auth'
    + '?client_id=' + encodeURIComponent(calConfig.googleClientId)
    + '&redirect_uri=' + encodeURIComponent(redirectUri)
    + '&response_type=token&scope=' + encodeURIComponent(scope);

  var w = 600, h = 650;
  var popup = window.open(authUrl, 'googleOAuth', 'width='+w+',height='+h+',left='+(screen.width-w)/2+',top='+(screen.height-h)/2);

  if (!popup) {
    // Popup blocked — offer manual link
    showToast('弹窗被拦截。请点击此链接授权：', 'info');
    var ts = $('tokenSection');
    if (ts) {
      ts.classList.add('show');
      ts.querySelector('.token-row').innerHTML = '<a href="' + authUrl + '" target="_blank" style="color:var(--neon-cyan);font-size:0.85rem">→ 点击此处打开 Google 授权页面 ←</a>'
        + '<span style="font-size:0.75rem;color:var(--text-dim)">授权后复制地址栏中的 access_token 粘贴到上方输入框</span>';
    }
    return;
  }

  window._todoOauthCallback = function(tk) { doGoogleSync(tk); };
  showToast('请在弹窗中登录 Google 账号并授权', 'info');
}

function handleOAuthRedirect() {
  var hash = window.location.hash;
  if (hash && hash.indexOf('access_token') >= 0) {
    var params = new URLSearchParams(hash.substring(1));
    var token = params.get('access_token');
    if (token && window.opener && window.opener._todoOauthCallback) {
      window.opener._todoOauthCallback(token);
      window.close();
    } else if (token) {
      // Same window — store and show
      calConfig.googleToken = token;
      storage.set({ todo_cal_config: calConfig }).then(function() {
        showToast('授权成功！Token 已保存，点击「Google」按钮同步', 'success');
        window.location.hash = '';
      });
    }
  }
}

// ===== Filter =====
function setFilter(filter) {
  currentFilter = filter;
  document.querySelectorAll('.pill').forEach(function(b) { b.classList.remove('active'); });
  var btn = document.querySelector('[data-filter="' + filter + '"]');
  if (btn) btn.classList.add('active');
  renderTodos();
}

// ===== Init =====
function init() {
  return storage.get(['todo_items', 'todo_cal_config']).then(function(data) {
    todos = data.todo_items || [];
    if (data.todo_cal_config) {
      calConfig = data.todo_cal_config;
      if (calConfig.googleClientId) $('googleClientId').value = calConfig.googleClientId;
      if (calConfig.googleToken) $('googleToken').value = calConfig.googleToken;
    }
    $('todoDate').value = today();
    // Update guide redirect URI
    var guide = $('guideRedirectUri');
    if (guide) guide.textContent = window.location.href.split('#')[0].split('?')[0];
    renderTodos();
    handleOAuthRedirect();
  });
}

// ===== Guide Toggle =====
function toggleGuide(collapseId, contentId) {
  var collapse = $(collapseId);
  var content = $(contentId);
  if (!collapse || !content) return;
  var isOpen = content.classList.contains('open');
  if (isOpen) {
    content.classList.remove('open');
    collapse.classList.remove('open');
  } else {
    content.classList.add('open');
    collapse.classList.add('open');
  }
}

// ===== Event Bindings =====
(function bindEvents() {
  function bind(id, evt, fn) { var el = $(id); if (el) el.addEventListener(evt, fn); }
  bind('toggleSettingsBtn', 'click', toggleSettings);
  bind('saveSettingsBtn', 'click', saveSettings);
  bind('addTodoBtn', 'click', addTodo);
  bind('downloadIcsBtn', 'click', downloadIcs);
  bind('syncGoogleBtn', 'click', syncGoogleCalendar);
  bind('applyTokenBtn', 'click', applyManualToken);
  bind('cancelTokenBtn', 'click', cancelToken);
  bind('todoTitle', 'keydown', function(e) { if (e.key === 'Enter') addTodo(); });
  bind('guideToggleGoogle', 'click', function() { toggleGuide('guideToggleGoogle', 'guideContentGoogle'); });
  bind('toggleMdPanel', 'click', toggleMdPanel);
  bind('btnMdImport', 'click', importMarkdown);
  bind('btnMdCancel', 'click', function() { toggleMdPanel(); $('mdInput').value = ''; });
  bind('exportMdBtn', 'click', exportMarkdown);
  bind('syncAppleBtn', 'click', handleAppleSync);
  bind('guideToggleApple', 'click', function() { toggleGuide('guideToggleApple', 'guideContentApple'); });
  bind('guideToggleIcs', 'click', function() { toggleGuide('guideToggleIcs', 'guideContentIcs'); });
  document.querySelectorAll('.pill').forEach(function(b) {
    b.addEventListener('click', function() { setFilter(b.dataset.filter); });
  });
})();

init().catch(function(e) {
  console.error('[TodoList] init failed:', e);
});

})();
