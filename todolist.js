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
      else {
        for (var k in obj) {
          localStorage.setItem('td_' + k, JSON.stringify(obj[k]));
          // 网页 → 扩展反向同步（content.js 中继，映射表见 background.js）
          try { (window.top || window).postMessage({ source: 'linguaflow-page', type: 'save-record', key: k, value: obj[k] }, '*'); } catch (e) {}
        }
        resolve();
      }
    });
  }
};

// ===== Constants =====
var STATUSES = ['todo', 'inprogress', 'done', 'paused'];
var PRI_NAME = { high: '高优先级', mid: '中优先级', low: '低优先级' };
var EMOJI_PRESETS = ['📌', '🚀', '📝', '🎯', '💡', '🔧', '🧪', '📅', '⭐', '🔥', '🧠', '✅', '🎨', '📦'];
var DEFAULT_ICON = '📌';

// ===== State =====
var todos = [];
var calConfig = {};
var currentFilter = 'all';
var editingTodoId = null;
var todoEditor = null;
var modalIcon = '';
var dragId = null;

// ===== Helpers =====
function $(id) { var el = document.getElementById('td-' + id); if (!el) el = document.getElementById(id); if (!el) console.error('[TodoList] #'+id+' not found'); return el; }
function escapeHtml(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
function today() { return new Date().toISOString().split('T')[0]; }
function uid() { return Date.now().toString() + '_' + Math.random().toString(36).substr(2, 4); }
function findTodo(id) { for (var i = 0; i < todos.length; i++) { if (todos[i].id === id) return todos[i]; } return null; }

function showToast(msg, type) {
  var t = $('toast'); t.textContent = msg; t.className = 'toast ' + (type||'success') + ' show';
  clearTimeout(t._t); t._t = setTimeout(function() { t.classList.remove('show'); }, 2800);
}

function formatDateCN(iso) {
  var p = (iso || '').split('-');
  if (p.length < 3) return iso || '';
  return parseInt(p[1], 10) + '月' + parseInt(p[2], 10) + '日';
}

// ===== 数据模型：旧数据迁移 & completed ↔ status 同步 =====
function normalizeTodo(t) {
  var changed = false;
  if (STATUSES.indexOf(t.status) < 0) { t.status = t.completed ? 'done' : 'todo'; changed = true; }
  if (t.desc == null) { t.desc = ''; changed = true; }
  if (t.icon == null) { t.icon = ''; changed = true; }
  if (!t.date) { t.date = today(); changed = true; }
  if (t.priority !== 'high' && t.priority !== 'mid' && t.priority !== 'low') { t.priority = 'mid'; changed = true; }
  var doneSync = (t.status === 'done');
  if (t.completed !== doneSync) { t.completed = doneSync; changed = true; }
  return changed;
}

// ===== Filter =====
function getFilteredTodos() {
  var list = todos.slice();
  if (currentFilter === 'today') { list = list.filter(function(t) { return t.date === today(); }); }
  else if (currentFilter === 'high') { list = list.filter(function(t) { return t.priority === 'high'; }); }
  list.sort(function(a, b) { return a.date.localeCompare(b.date) || (a.time || '').localeCompare(b.time || '') || a.timestamp - b.timestamp; });
  return list;
}

// ===== Stats（Bento KPI 指标卡） =====
function updateStats() {
  var td = today();
  var tTotal = 0, tDone = 0, todoN = 0, doingN = 0, doneN = 0, overdueN = 0, highN = 0;
  for (var i = 0; i < todos.length; i++) {
    var t = todos[i];
    if (t.date === td) { tTotal++; if (t.status === 'done') tDone++; }
    if (t.status === 'todo') { todoN++; if (t.date < td) overdueN++; }
    else if (t.status === 'inprogress') { doingN++; if (t.priority === 'high') highN++; }
    else if (t.status === 'done') doneN++;
  }
  var pct = tTotal > 0 ? Math.round(tDone / tTotal * 100) : 0;
  var allPct = todos.length > 0 ? Math.round(doneN / todos.length * 100) : 0;

  var set = function(id, v) { var el = $(id); if (el) el.textContent = v; };
  set('kpiTodayPct', pct + '%');
  set('kpiTodaySub', '今日 ' + tDone + '/' + tTotal);
  set('kpiTodo', todoN);
  set('kpiTodoSub', '逾期 ' + overdueN);
  set('kpiDoing', doingN);
  set('kpiDoingSub', '高优先级 ' + highN);
  set('kpiDone', doneN);
  set('kpiDoneSub', '完成率 ' + allPct + '%');

  // 进度条缓动填充（宽度变化触发 1s cubic-bezier 过渡）
  var bar = $('kpiTodayBar');
  if (bar) bar.style.width = pct + '%';
}

// ===== Render =====
var SVG_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
var SVG_UNDO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>';
var SVG_EDIT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>';
var SVG_TRASH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>';
var SVG_FLAG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
var SVG_CAL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>';
var SVG_CLOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/></svg>';
var SVG_INBOX = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>';

function renderCard(t, enterIndex) {
  var priCls = t.priority === 'high' ? 'pri-high' : t.priority === 'low' ? 'pri-low' : 'pri-mid';
  var tagCls = t.priority === 'high' ? 'tag-high' : t.priority === 'low' ? 'tag-low' : 'tag-mid';
  var td = today();
  var overdue = t.date < td && t.status !== 'done';
  var isToday = t.date === td && t.status !== 'done';
  var inDone = t.status === 'done';
  var enterCls = '';
  var enterAttr = '';
  if (typeof enterIndex === 'number' && enterIndex >= 0) {
    enterCls = ' kb-enter';
    enterAttr = ' style="animation-delay:' + (enterIndex * 40) + 'ms"';
  }

  var h = '<div class="kb-card ' + priCls + (inDone ? ' is-done' : '') + enterCls + '"' + enterAttr + ' draggable="true" data-tid="' + t.id + '">';
  h += '<div class="kb-head">';
  h += '<span class="kb-emoji">' + (t.icon || DEFAULT_ICON) + '</span>';
  h += '<div class="kb-title md-rendered">' + renderMarkdown(t.title) + '</div>';
  h += '<span class="kb-flag">' + SVG_FLAG + '</span>';
  h += '</div>';
  if (t.desc) h += '<div class="kb-desc">' + escapeHtml(t.desc) + '</div>';
  h += '<div class="kb-meta">';
  h += '<span class="kb-chip' + (overdue ? ' overdue' : isToday ? ' today-chip' : '') + '">' + SVG_CAL + formatDateCN(t.date) + (overdue ? ' · 逾期' : '') + '</span>';
  if (t.time) h += '<span class="kb-chip">' + SVG_CLOCK + escapeHtml(t.time) + '</span>';
  h += '<span class="tag ' + tagCls + '">' + PRI_NAME[t.priority] + '</span>';
  if (t.syncedGoogle) h += '<span class="kb-chip sync-g">✓ Google</span>';
  if (t.syncedIcs) h += '<span class="kb-chip sync-i">✓ ICS</span>';
  h += '</div>';
  h += '<div class="kb-actions">';
  h += '<button class="kb-act act-done" data-act="toggle" data-tid="' + t.id + '" title="' + (inDone ? '移回待办' : '标记完成') + '">' + (inDone ? SVG_UNDO : SVG_CHECK) + '</button>';
  h += '<button class="kb-act" data-act="edit" data-tid="' + t.id + '" title="编辑">' + SVG_EDIT + '</button>';
  h += '<button class="kb-act act-del" data-act="del" data-tid="' + t.id + '" title="删除">' + SVG_TRASH + '</button>';
  h += '</div></div>';
  return h;
}

function renderBoard(opts) {
  var animate = !!(opts && opts.animate);
  updateStats();
  var list = getFilteredTodos();
  STATUSES.forEach(function(status) {
    var body = document.querySelector('.kb-col-body[data-status="' + status + '"]');
    var count = $('count-' + status);
    var items = list.filter(function(t) { return t.status === status; });
    if (count) count.textContent = items.length;
    if (!body) return;
    if (items.length === 0) {
      body.innerHTML = '<div class="kb-empty">' + SVG_INBOX + '<p>拖拽任务到此处</p></div>';
      return;
    }
    var html = '';
    for (var i = 0; i < items.length; i++) html += renderCard(items[i], animate ? i : -1);
    body.innerHTML = html;
  });
  bindCardEvents();
}

// ===== 卡片事件 & 拖拽 =====
function bindCardEvents() {
  document.querySelectorAll('.kb-card').forEach(function(card) {
    card.addEventListener('dragstart', function(e) {
      dragId = card.dataset.tid;
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', dragId); } catch (err) {}
      card.classList.add('dragging');
    });
    card.addEventListener('dragend', function() {
      card.classList.remove('dragging');
      document.querySelectorAll('.kb-col').forEach(function(c) { c.classList.remove('drag-over'); });
    });
  });
  document.querySelectorAll('.kb-act').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      var id = btn.dataset.tid;
      if (btn.dataset.act === 'edit') openEditModal(id);
      else if (btn.dataset.act === 'del') deleteTodo(id);
      else if (btn.dataset.act === 'toggle') quickToggle(id);
    });
  });
}

function bindColumnDnd() {
  document.querySelectorAll('.kb-col').forEach(function(col) {
    col.addEventListener('dragover', function(e) {
      e.preventDefault(); e.dataTransfer.dropEffect = 'move';
      col.classList.add('drag-over');
    });
    col.addEventListener('dragleave', function(e) {
      if (!col.contains(e.relatedTarget)) col.classList.remove('drag-over');
    });
    col.addEventListener('drop', function(e) {
      e.preventDefault();
      col.classList.remove('drag-over');
      var id = dragId;
      try { if (!id) id = e.dataTransfer.getData('text/plain'); } catch (err) {}
      if (id) setStatus(id, col.dataset.status);
      dragId = null;
    });
  });
}

// ===== 跨页面同步（AI Parse 创建任务后自动刷新） =====
function refreshTodos() {
  if (editingTodoId || $('taskModalOverlay').classList.contains('open')) return; // 编辑中不打断
  storage.get(['todo_items']).then(function(data) {
    todos = data.todo_items || [];
    todos.forEach(function(t) { normalizeTodo(t); });
    renderBoard();
  });
}

// ===== CRUD =====
function saveTodos() { storage.set({ todo_items: todos }); }

function setStatus(id, status) {
  var t = findTodo(id);
  if (!t || t.status === status) return;
  t.status = status;
  t.completed = (status === 'done');
  t.timestamp = Date.now();
  saveTodos();
  renderBoard();
}

function quickToggle(id) {
  var t = findTodo(id);
  if (!t) return;
  setStatus(id, t.status === 'done' ? 'todo' : 'done');
}

function deleteTodo(id) {
  todos = todos.filter(function(t) { return t.id !== id; });
  saveTodos();
  renderBoard();
  showToast('任务已删除', 'success');
}

// ===== 任务弹层 =====
function openOverlay(el) { if (el) el.classList.add('open'); }
function closeOverlay(el) { if (el) el.classList.remove('open'); }
function closeAllOverlays() {
  document.querySelectorAll('.modal-overlay.open').forEach(function(el) { el.classList.remove('open'); });
}

function buildEmojiRow() {
  var row = $('emojiRow');
  if (!row) return;
  EMOJI_PRESETS.forEach(function(em) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'emoji-opt';
    b.textContent = em;
    b.dataset.emoji = em;
    b.addEventListener('click', function() {
      var cur = row.querySelector('.emoji-opt.selected');
      if (cur === b) { // 再次点击取消选择
        b.classList.remove('selected');
        modalIcon = '';
      } else {
        if (cur) cur.classList.remove('selected');
        b.classList.add('selected');
        modalIcon = em;
      }
    });
    row.appendChild(b);
  });
}

function setModalIcon(em) {
  modalIcon = em || '';
  var row = $('emojiRow');
  if (!row) return;
  row.querySelectorAll('.emoji-opt').forEach(function(b) {
    b.classList.toggle('selected', b.dataset.emoji === modalIcon);
  });
}

function openTaskModal(status) {
  editingTodoId = null;
  $('taskModalTitle').textContent = '新建任务';
  $('taskTitle').value = '';
  $('taskDesc').value = '';
  $('taskDate').value = today();
  $('taskTime').value = '09:00';
  $('taskPriority').value = 'mid';
  $('taskStatus').value = status || 'todo';
  setModalIcon('');
  openOverlay($('taskModalOverlay'));
  setTimeout(function() { var el = $('taskTitle'); if (el) el.focus(); }, 60);
}

function openEditModal(id) {
  var t = findTodo(id);
  if (!t) return;
  editingTodoId = id;
  $('taskModalTitle').textContent = '编辑任务';
  $('taskTitle').value = t.title;
  $('taskDesc').value = t.desc || '';
  $('taskDate').value = t.date;
  $('taskTime').value = t.time || '';
  $('taskPriority').value = t.priority;
  $('taskStatus').value = t.status;
  setModalIcon(t.icon || '');
  openOverlay($('taskModalOverlay'));
}

function saveTaskFromModal() {
  var title = $('taskTitle').value.trim();
  if (!title) { showToast('请输入任务标题', 'error'); return; }
  var status = $('taskStatus').value;
  var date = $('taskDate').value || today();
  var time = $('taskTime').value || '';

  if (editingTodoId) {
    var t = findTodo(editingTodoId);
    if (t) {
      t.title = title;
      t.desc = $('taskDesc').value.trim();
      t.icon = modalIcon;
      t.date = date;
      t.time = time;
      t.priority = $('taskPriority').value;
      t.status = status;
      t.completed = (status === 'done');
      t.timestamp = Date.now();
    }
    showToast('任务已更新', 'success');
  } else {
    todos.unshift({
      id: uid(),
      title: title,
      desc: $('taskDesc').value.trim(),
      icon: modalIcon,
      date: date,
      time: time,
      priority: $('taskPriority').value,
      status: status,
      completed: (status === 'done'),
      syncedGoogle: false,
      syncedIcs: false,
      timestamp: Date.now()
    });
    if (todos.length > 500) todos = todos.slice(0, 500);
    showToast('任务已添加', 'success');
  }
  saveTodos();
  closeOverlay($('taskModalOverlay'));
  renderBoard();
}

// ===== Markdown Import / Export =====
function openMdModal() {
  openOverlay($('mdModalOverlay'));
  if (todoEditor) setTimeout(function() { todoEditor.focus(); }, 60);
}

var _mdPreviewOpen = false;
function toggleMdPreview() {
  _mdPreviewOpen = !_mdPreviewOpen;
  var panel = $('mdPreviewPanel');
  var btn = $('previewToggleBtn');
  if (!panel) return;
  if (_mdPreviewOpen) {
    panel.style.display = 'block';
    if (btn) btn.classList.add('active');
    updateMdPreview();
  } else {
    panel.style.display = 'none';
    if (btn) btn.classList.remove('active');
  }
}
function closeMdPreview() {
  _mdPreviewOpen = false;
  var panel = $('mdPreviewPanel');
  var btn = $('previewToggleBtn');
  if (panel) panel.style.display = 'none';
  if (btn) btn.classList.remove('active');
}
function updateMdPreview() {
  if (!_mdPreviewOpen || !todoEditor) return;
  var text = todoEditor.getMarkdown();
  var preview = $('mdPreviewContent');
  if (preview) {
    if (text.trim()) {
      preview.innerHTML = renderMarkdown(text);
    } else {
      preview.innerHTML = '<p style="color:var(--text-dim);font-style:italic;">输入 Markdown 任务列表即可实时预览...</p>';
    }
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
    var titleRaw2 = match[2].trim();
    if (titleRaw2) {
      items.push(extractTaskMeta(titleRaw2, defaultDate, defaultTime, defaultPriority, isCompleted));
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
    id: uid(),
    title: title,
    desc: '',
    icon: '',
    date: date,
    time: time,
    priority: priority,
    status: isCompleted ? 'done' : 'todo',
    completed: isCompleted,
    syncedGoogle: false,
    syncedIcs: false,
    timestamp: Date.now()
  };
}

function importMarkdown() {
  var text = todoEditor ? todoEditor.getMarkdown().trim() : '';
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
    if (todoEditor) todoEditor.clear();
    closeOverlay($('mdModalOverlay'));
    closeMdPreview();
    renderBoard();
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
function openSettingsModal() { openOverlay($('settingsModalOverlay')); }

function saveSettings() {
  calConfig.googleClientId = $('googleClientId').value.trim();
  calConfig.googleToken = $('googleToken').value.trim();
  storage.set({ todo_cal_config: calConfig }).then(function() {
    showToast('配置已保存', 'success');
    closeOverlay($('settingsModalOverlay'));
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
  saveTodos(); renderBoard();
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
  saveTodos(); renderBoard();

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
    // No config — open settings modal
    openSettingsModal();
    showToast('请先配置 Access Token 或 Client ID', 'info');
    return;
  }
  // OAuth flow
  startOAuth();
}

function doGoogleSync(token) {
  var list = getFilteredTodos().filter(function(t) { return !t.completed; });
  if (list.length === 0) { showToast('没有可同步的未完成任务', 'error'); return; }

  var success = 0, fail = 0;
  var remaining = list.length;

  function done() {
    saveTodos(); renderBoard();
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
    // Popup blocked — show manual link inside settings modal
    showToast('弹窗被拦截，请点击设置中的授权链接', 'info');
    var row = $('oauthLinkRow');
    var link = $('oauthLink');
    if (row && link) {
      link.href = authUrl;
      row.classList.add('show');
      openSettingsModal();
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

// ===== Init =====
function init() {
  return storage.get(['todo_items', 'todo_cal_config']).then(function(data) {
    todos = data.todo_items || [];
    if (data.todo_cal_config) {
      calConfig = data.todo_cal_config;
      if (calConfig.googleClientId) $('googleClientId').value = calConfig.googleClientId;
      if (calConfig.googleToken) $('googleToken').value = calConfig.googleToken;
    }
    // 旧数据迁移（无 status/desc/icon 字段 → 补全后回写）
    var migrated = false;
    todos.forEach(function(t) { if (normalizeTodo(t)) migrated = true; });
    if (migrated) saveTodos();

    // Update guide redirect URI
    var guide = $('guideRedirectUri');
    if (guide) guide.textContent = window.location.href.split('#')[0].split('?')[0];

    buildEmojiRow();
    renderBoard({ animate: true });
    handleOAuthRedirect();

    // Initialize MdEditor
    if ($('mdInput')) {
      todoEditor = MdEditor.create($('mdInput'), {
        placeholder: '输入任务 (支持 Markdown)...',
        onInput: function() { updateMdPreview(); }
      });
    }
  });
}

// ===== Event Bindings =====
(function bindEvents() {
  function bind(id, evt, fn) { var el = $(id); if (el) el.addEventListener(evt, fn); }

  // 顶栏
  bind('newTaskBtn', 'click', function() { openTaskModal('todo'); });
  bind('openMdImportBtn', 'click', openMdModal);
  bind('exportMdBtn', 'click', exportMarkdown);
  bind('downloadIcsBtn', 'click', downloadIcs);
  bind('syncGoogleBtn', 'click', syncGoogleCalendar);
  bind('syncAppleBtn', 'click', handleAppleSync);
  bind('openSettingsBtn', 'click', openSettingsModal);

  // 筛选
  document.querySelectorAll('#filterGroup .pill').forEach(function(b) {
    b.addEventListener('click', function() {
      currentFilter = b.dataset.filter;
      document.querySelectorAll('#filterGroup .pill').forEach(function(x) { x.classList.remove('active'); });
      b.classList.add('active');
      renderBoard();
    });
  });

  // 看板列拖拽（列是静态 DOM，绑定一次）
  bindColumnDnd();

  // 任务弹层
  bind('taskSaveBtn', 'click', saveTaskFromModal);
  bind('taskCancelBtn', 'click', function() { closeOverlay($('taskModalOverlay')); });
  bind('taskModalClose', 'click', function() { closeOverlay($('taskModalOverlay')); });
  bind('taskTitle', 'keydown', function(e) { if (e.key === 'Enter') saveTaskFromModal(); });
  document.querySelectorAll('.kb-col-add').forEach(function(btn) {
    btn.addEventListener('click', function() { openTaskModal(btn.dataset.status); });
  });

  // 设置弹层
  bind('settingsModalClose', 'click', function() { closeOverlay($('settingsModalOverlay')); });
  bind('saveSettingsBtn', 'click', saveSettings);
  bind('guideToggleGoogle', 'click', function() { toggleGuide('guideToggleGoogle', 'guideContentGoogle'); });
  bind('guideToggleApple', 'click', function() { toggleGuide('guideToggleApple', 'guideContentApple'); });
  bind('guideToggleIcs', 'click', function() { toggleGuide('guideToggleIcs', 'guideContentIcs'); });

  // MD 导入弹层
  bind('mdModalClose', 'click', function() { closeOverlay($('mdModalOverlay')); });
  bind('btnMdImport', 'click', importMarkdown);
  bind('btnMdCancel', 'click', function() { closeOverlay($('mdModalOverlay')); if (todoEditor) todoEditor.clear(); closeMdPreview(); });
  bind('previewToggleBtn', 'click', toggleMdPreview);
  bind('mdPreviewClose', 'click', closeMdPreview);

  // 点击遮罩关闭 + ESC 关闭
  document.querySelectorAll('.modal-overlay').forEach(function(ov) {
    ov.addEventListener('mousedown', function(e) {
      if (e.target === ov) closeOverlay(ov);
    });
  });
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') closeAllOverlays();
  });

  // 跨页面同步：AI Parse 等页面创建任务后自动刷新看板
  if (isExtension) {
    chrome.storage.onChanged.addListener(function(changes, area) {
      if ((area === 'local' || (area && area.areaName === 'local')) && changes.todo_items) refreshTodos();
    });
  } else {
    window.addEventListener('storage', function(e) {
      if (e.key === 'td_todo_items') refreshTodos();
    });
  }
})();

init().catch(function(e) {
  console.error('[TodoList] init failed:', e);
});

})();
