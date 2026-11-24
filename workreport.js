(function() {
"use strict";

// ===== Generate Stars (skip if already present) =====
  const starsContainer = document.getElementById('stars');
  if (starsContainer && !starsContainer.querySelector('.star')) {
  for (let i = 0; i < 60; i++) {
    const star = document.createElement('div');
    star.className = 'star';
    star.style.left = Math.random() * 100 + '%';
    star.style.top = Math.random() * 100 + '%';
    star.style.animationDelay = Math.random() * 3 + 's';
    star.style.animationDuration = (2 + Math.random() * 3) + 's';
    star.style.width = star.style.height = (1 + Math.random() * 2) + 'px';
    starsContainer.appendChild(star);
  }
  }

  // ===== Language Name Map =====
  const LANG_NAMES = {
    zh: '中文', en: 'English', ja: '日本語', ko: '한국어', fr: 'Français',
    de: 'Deutsch', es: 'Español', pt: 'Português', ru: 'Русский', ar: 'العربية',
    it: 'Italiano', nl: 'Nederlands', th: 'ไทย', vi: 'Tiếng Việt', id: 'Indonesia',
    ms: 'Melayu', tr: 'Türkçe', pl: 'Polski', sv: 'Svenska', da: 'Dansk',
    fi: 'Suomi', el: 'Ελληνικά', cs: 'Čeština', ro: 'Română', hu: 'Magyar',
    uk: 'Українська', hi: 'हिन्दी', bn: 'বাংলা', he: 'עברית', fa: 'فارسی',
  };

  // English names for use in non-Chinese prompts (avoids mixing Chinese chars)
  const LANG_NAMES_EN = {
    zh: 'Chinese', en: 'English', ja: 'Japanese', ko: 'Korean', fr: 'French',
    de: 'German', es: 'Spanish', pt: 'Portuguese', ru: 'Russian', ar: 'Arabic',
    it: 'Italian', nl: 'Dutch', th: 'Thai', vi: 'Vietnamese', id: 'Indonesian',
    ms: 'Malay', tr: 'Turkish', pl: 'Polish', sv: 'Swedish', da: 'Danish',
    fi: 'Finnish', el: 'Greek', cs: 'Czech', ro: 'Romanian', hu: 'Hungarian',
    uk: 'Ukrainian', hi: 'Hindi', bn: 'Bengali', he: 'Hebrew', fa: 'Persian',
  };

  // ===== Storage abstraction (extension uses chrome.storage.local, web uses localStorage) =====
  const isExtension = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id);
  const storage = {
    get(keys) {
      return new Promise((resolve) => {
        if (isExtension) {
          chrome.storage.local.get(keys, resolve);
        } else {
          const result = {};
          for (const k of keys) {
            try { result[k] = JSON.parse(localStorage.getItem('wr_' + k) || 'null'); } catch (e) { result[k] = null; }
          }
          resolve(result);
        }
      });
    },
    set(obj) {
      return new Promise((resolve) => {
        if (isExtension) {
          chrome.storage.local.set(obj, resolve);
        } else {
          for (const [k, v] of Object.entries(obj)) {
            localStorage.setItem('wr_' + k, JSON.stringify(v));
            // 网页 → 扩展反向同步（content.js 中继，映射表见 background.js）
            try { (window.top || window).postMessage({ source: 'linguaflow-page', type: 'save-record', key: k, value: v }, '*'); } catch (e) {}
          }
          resolve();
        }
      });
    },
    remove(keys) {
      return new Promise((resolve) => {
        if (isExtension) {
          chrome.storage.local.remove(keys, resolve);
        } else {
          for (const k of keys) { localStorage.removeItem('wr_' + k); }
          resolve();
        }
      });
    }
  };

  // ===== State =====
  let config = {};
  let records = [];
  let summaries = [];
  var editingRecordId = null;
  var _preEditText = ''; // 进入编辑前的输入内容，取消编辑时原样恢复
  var selectedRecordIds = [];
  var workEditor = null;
  let currentFilter = { dateFrom: '', dateTo: '', timeFrom: '', timeTo: '' };

  // ===== DOM refs (with null guard) =====
  const $ = (id) => {
    // Try wr- prefix first (for embedded mode in index.html), then original
    let el = document.getElementById('wr-' + id);
    if (!el) el = document.getElementById(id);
    if (!el) console.error('[WorkReport] Element not found: #' + id);
    return el;
  };

  // ===== Toast =====
  function showToast(msg, type) {
    const t = $('toast');
    t.textContent = msg;
    t.className = 'toast ' + type + ' show';
    clearTimeout(t._timeout);
    t._timeout = setTimeout(() => { t.classList.remove('show'); }, 2200);
  }

  // ===== Escape HTML =====
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ===== Format date/time =====
  function formatDate(ts) {
    const d = new Date(ts);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  function formatTime(ts) {
    const d = new Date(ts);
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  function formatDateTime(ts) {
    return formatDate(ts) + ' ' + formatTime(ts);
  }

  // ===== Settings =====
  function toggleSettings() {
    const panel = $('settingsPanel');
    if (panel) panel.classList.toggle('open');
  }

  function saveSettings() {
    try {
      config.baseUrl = $('baseUrl').value.trim().replace(/\/+$/, '');
      config.apiKey = $('apiKey').value.trim();
      config.model = $('modelName').value.trim();
      config.inputLang = $('inputLang').value;
      config.outputLang = $('outputLang').value;
      storage.set({ work_config: config }).then(() => {
        showToast('配置已保存', 'success');
        const panel = $('settingsPanel');
        if (panel) setTimeout(() => panel.classList.remove('open'), 600);
      });
    } catch (e) {
      console.error('[WorkReport] saveSettings error:', e);
      showToast('保存配置失败', 'error');
    }
  }

  // ===== Auto-save draft =====
  let draftTimer = null;
  function saveDraft() {
    if (!workEditor) return;
    const text = workEditor.getMarkdown();
    storage.set({ work_draft: text }).then(() => {
      const dot = $('draftDot');
      dot.classList.add('saved');
      setTimeout(() => dot.classList.remove('saved'), 1500);
    });
  }

  // Draft auto-save is handled via MdEditor onInput callback (see init)
  // Keyboard shortcut is bound on workEditor.container (see init)

  // ===== 附件支持（多文件；统一单文件 150MB 上限，AiService 共用助手） =====
  // v0.52.0 交互调整：附件内容不灌入输入框，仅显示附件清单（每项可单独移除），随总结请求发送
  var loadedFiles = [];   // [{ name, content }]
  // pdf.js worker 本地加载（扩展 MV3 CSP 不允许远程脚本，须打包在目录内）
  if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'pdf.worker.min.js';
  }

  // 附件清单渲染（对齐 voice transcription AI 总结页样式）：纵向卡片 = 文件名 + 大小·状态行
  // + 完成勾 / 红色错误行 + 独立移除按钮；失败的附件留在清单中标红、不参与总结
  function renderAttachmentList() {
    var list = $('fileList');
    if (!list) return;
    if (!loadedFiles.length) {
      list.classList.remove('visible');
      list.innerHTML = '';
      return;
    }
    list.classList.add('visible');
    var html = '';
    for (var i = 0; i < loadedFiles.length; i++) {
      var f = loadedFiles[i];
      var metaCls = f.status === 'error' ? 'err' : (f.status === 'done' ? 'ok' : '');
      html += '<div class="file-item">'
        + '<div class="fi-main">'
        + '<span class="fi-name" title="' + escapeHtml(f.name) + '">' + escapeHtml(f.name) + '</span>'
        + '<span class="fi-meta ' + metaCls + '">' + escapeHtml((AiService.formatBytes ? AiService.formatBytes(f.size) : '') + ' · ' + (f.stage || '')) + '</span>'
        + (f.status === 'error' && f.error ? '<span class="fi-meta err">' + escapeHtml(f.error) + '</span>' : '')
        + '</div>'
        + (f.status === 'done' ? '<span class="fi-ok" title="文本已提取">✓</span>' : '')
        + '<button type="button" class="fi-remove" data-idx="' + i + '" title="移除该附件">✕</button>'
        + '</div>';
    }
    list.innerHTML = html;
  }

  function clearAttachment() {
    loadedFiles = [];
    var inp = $('fileInput');
    if (inp) inp.value = '';
    renderAttachmentList();
  }

  // 兜底总结来源：已提取完成的附件内容（带「===== 附件 N：文件名 =====」分界，供 AI 区分来源）+ 输入框正文
  function buildInputSourceText() {
    var parts = [];
    for (var i = 0; i < loadedFiles.length; i++) {
      if (loadedFiles[i].status !== 'done') continue;
      parts.push('===== 附件 ' + (parts.length + 1) + '：' + loadedFiles[i].name + ' =====\n' + loadedFiles[i].content);
    }
    var editorText = workEditor ? workEditor.getMarkdown().trim() : '';
    if (editorText) parts.push(editorText);
    return parts.join('\n\n———\n\n');
  }

  async function handleAttachments(fileList) {
    // 逐个处理：先入清单（解析中状态行实时更新），完成后置绿勾；失败的留在清单中标红、不参与总结
    for (var i = 0; i < fileList.length; i++) {
      var file = fileList[i];
      var entry = { name: file.name, size: file.size, content: '', status: 'extracting', stage: '解析中…', error: '' };
      loadedFiles.push(entry);
      renderAttachmentList();
      // 统一附件上限 150MB（三页共用 AiService.checkAttachment 校验）
      var tooBig = (window.AiService && AiService.checkAttachment) ? AiService.checkAttachment(file) : null;
      if (tooBig) {
        entry.status = 'error';
        entry.stage = '超过大小上限';
        entry.error = tooBig;
        renderAttachmentList();
        continue;
      }
      try {
        if (/\.pdf$/i.test(file.name)) {
          // 大文件（如 150MB）读取/解析耗时较长，进度写入清单状态行（避免误以为卡死）
          var buf = await AiService.readAttachmentBuffer(file, function(ld, total) {
            if (file.size > 20 * 1024 * 1024) {
              entry.stage = '读取中 ' + Math.round(ld / total * 100) + '%';
              renderAttachmentList();
            }
          });
          entry.stage = '解析 PDF 页面…';
          renderAttachmentList();
          var text = await AiService.extractPdfText(buf, function(p, total) {
            entry.stage = '解析第 ' + p + '/' + total + ' 页';
            renderAttachmentList();
          });
          if (!text.trim()) {
            entry.status = 'error';
            entry.stage = '未能提取文本';
            entry.error = '可能是扫描件/图片型 PDF，需先 OCR';
          } else {
            entry.content = text;
            entry.status = 'done';
            entry.stage = '文本已提取';
          }
        } else if (/\.(docx|xlsx|xlsm|pptx)$/i.test(file.name)) {
          // Office 文档（docx/xlsx/pptx）：JSZip 解包 + XML 规则提取，预算内自动截取首尾
          entry.stage = '解压解析中…';
          renderAttachmentList();
          var ro = await AiService.extractOfficeText(file);
          entry.content = ro.text;
          entry.status = 'done';
          entry.stage = '文本已提取' + (ro.truncated ? '（超长已截取首尾）' : '');
        } else {
          // 文本类附件：≤10MB 全文提取；>10MB（≤150MB）自动截取首尾至预算
          var rr = await AiService.readAttachmentText(file);
          entry.content = rr.text;
          entry.status = 'done';
          entry.stage = '文本已提取' + (rr.truncated ? '（超长已截取首尾）' : '');
        }
      } catch (err) {
        entry.status = 'error';
        entry.stage = '提取失败';
        entry.error = String((err && err.message) || err);
      }
      renderAttachmentList();
    }
    var okCount = 0, failed = 0;
    for (var j = 0; j < loadedFiles.length; j++) {
      if (loadedFiles[j].status === 'done') okCount++;
      else if (loadedFiles[j].status === 'error') failed++;
    }
    if (okCount > 0) showToast('已加载 ' + okCount + ' 个附件', 'success');
    if (failed > 0) showToast(failed + ' 个附件提取失败，将不参与总结（详见清单）', 'error');
  }

  function clearWorkInput() {
    clearAttachment();
    if (workEditor) workEditor.clear();
    storage.set({ work_draft: '' });
    const hint = $('draftHint');
    if (hint) hint.textContent = '输入内容自动保存草稿';
    if (_mdPreviewOpen) updateMdPreview();
    showToast('输入已清空', 'info');
  }

  // ===== Save / Update Record =====
  function saveRecord() {
    if (!workEditor) return;
    const text = workEditor.getMarkdown().trim();
    if (!text) {
      showToast('请输入工作内容', 'error');
      return;
    }

    if (editingRecordId) {
      // Update existing record
      var idx = -1;
      for (var i = 0; i < records.length; i++) {
        if (records[i].id === editingRecordId) { idx = i; break; }
      }
      if (idx >= 0) {
        records[idx].content = text;
        records[idx].date = formatDate(Date.now());
        records[idx].time = formatTime(Date.now());
        records[idx].timestamp = Date.now();
        // Move to top
        var updated = records.splice(idx, 1)[0];
        records.unshift(updated);
      }
      storage.set({ work_records: records }).then(() => {
        // 保存后保留输入内容（只有用户主动「清空」才清除）
        editingRecordId = null;
        _preEditText = '';
        updateSaveBtnLabel();
        renderRecords();
        showToast('记录已更新', 'success');
      }).catch(function(e) {
        console.error('[WorkReport] updateRecord failed:', e);
        showToast('更新失败，请重试', 'error');
      });
      return;
    }

    // Create new record
    const now = Date.now();
    const record = {
      id: now.toString(),
      content: text,
      date: formatDate(now),
      time: formatTime(now),
      timestamp: now,
    };

    records.unshift(record);
    if (records.length > 200) records = records.slice(0, 200);

    storage.set({ work_records: records }).then(() => {
      // 保存后保留输入内容（只有用户主动「清空」才清除）
      renderRecords();
      showToast('记录已保存 — ' + formatDateTime(now), 'success');
    }).catch(function(e) {
      console.error('[WorkReport] saveRecord failed:', e);
      var inp = $('workInput');
      if (inp) inp.value = text;
      showToast('保存失败，请重试', 'error');
    });
  }

  // ===== Edit Record (load into input) =====
  function editRecord(id) {
    for (var i = 0; i < records.length; i++) {
      if (records[i].id === id) {
        var cur = workEditor ? workEditor.getMarkdown() : '';
        // 载入记录会替换输入框内容：有未删除的输入时先确认，避免误丢
        if (!editingRecordId && cur.trim() && cur !== records[i].content) {
          if (!confirm('输入框中还有内容，编辑该记录会替换它。确定继续吗？')) return;
        }
        if (!editingRecordId) _preEditText = cur;
        if (workEditor) workEditor.setMarkdown(records[i].content);
        editingRecordId = id;
        updateSaveBtnLabel();
        if (workEditor) workEditor.focus();
        showToast('正在编辑记录 — 修改后点击「更新记录」保存', 'success');
        return;
      }
    }
  }

  // ===== Cancel Edit =====
  function cancelEdit() {
    editingRecordId = null;
    // 取消编辑只退出编辑态，不删除用户输入：恢复进入编辑前的内容
    if (workEditor) workEditor.setMarkdown(_preEditText || '');
    _preEditText = '';
    saveDraft();
    updateSaveBtnLabel();
  }

  // ===== Update Save Button Label =====
  function updateSaveBtnLabel() {
    var btn = $('saveRecordBtn');
    var cancelBtn = $('cancelEditBtn');
    if (editingRecordId) {
      if (btn) btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> 更新记录<span class="kbd" style="background:rgba(255,255,255,0.15);border-color:rgba(255,255,255,0.2);">Ctrl+↵</span>';
      if (cancelBtn) cancelBtn.style.display = 'flex';
    } else {
      if (btn) btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> 保存记录<span class="kbd" style="background:rgba(255,255,255,0.15);border-color:rgba(255,255,255,0.2);">Ctrl+↵</span>';
      if (cancelBtn) cancelBtn.style.display = 'none';
    }
  }

  // ===== Delete Record =====
  function deleteRecord(id) {
    records = records.filter(r => r.id !== id);
    storage.set({ work_records: records }).then(() => {
      renderRecords();
      showToast('记录已删除', 'success');
    });
  }

  // ===== Filter =====
  function getFilteredRecords() {
    let filtered = [...records];

    if (currentFilter.dateFrom) {
      filtered = filtered.filter(r => r.date >= currentFilter.dateFrom);
    }
    if (currentFilter.dateTo) {
      filtered = filtered.filter(r => r.date <= currentFilter.dateTo);
    }
    if (currentFilter.timeFrom) {
      filtered = filtered.filter(r => r.time >= currentFilter.timeFrom);
    }
    if (currentFilter.timeTo) {
      filtered = filtered.filter(r => r.time <= currentFilter.timeTo);
    }

    return filtered;
  }

  function applyFilter() {
    currentFilter.dateFrom = $('filterDateFrom').value;
    currentFilter.dateTo = $('filterDateTo').value;
    currentFilter.timeFrom = $('filterTimeFrom').value;
    currentFilter.timeTo = $('filterTimeTo').value;

    const hasFilter = currentFilter.dateFrom || currentFilter.dateTo ||
                      currentFilter.timeFrom || currentFilter.timeTo;
    $('applyFilterBtn').classList.toggle('active', hasFilter);
    $('clearFilterBtn').style.display = hasFilter ? '' : 'none';

    renderRecords();
  }

  function clearFilter() {
    $('filterDateFrom').value = '';
    $('filterDateTo').value = '';
    $('filterTimeFrom').value = '';
    $('filterTimeTo').value = '';
    currentFilter = { dateFrom: '', dateTo: '', timeFrom: '', timeTo: '' };
    $('applyFilterBtn').classList.remove('active');
    $('clearFilterBtn').style.display = 'none';
    renderRecords();
  }

  // ===== Render Records =====
  function renderRecords() {
    const filtered = getFilteredRecords();
    const list = $('recordsList');
    $('recordsCount').textContent = records.length + ' 条';

    const hasFilter = currentFilter.dateFrom || currentFilter.dateTo ||
                      currentFilter.timeFrom || currentFilter.timeTo;
    $('filteredCount').textContent = hasFilter ? '（筛选结果: ' + filtered.length + ' 条）' : '';

    if (filtered.length === 0) {
      list.innerHTML = '<div class="records-empty">' +
        (records.length === 0 ? '暂无工作记录，在上方输入内容后点击「保存记录」' : '当前筛选条件下无匹配记录') +
        '</div>';
      updateSummaryMeta(0);
      return;
    }

    updateSummaryMeta(filtered.length);
    updateSelectInfo();

    var checkedAttr;
    list.innerHTML = filtered.map(function(r) {
      checkedAttr = selectedRecordIds.indexOf(r.id) >= 0 ? ' checked' : '';
      return '<div class="record-item" data-rid="' + r.id + '">'
        + '<input type="checkbox" class="record-checkbox" data-rid="' + r.id + '"' + checkedAttr + ' title="选择此条">'
        + '<div class="record-time">'
        + '<div class="record-date">' + escapeHtml(r.date) + '</div>'
        + '<div class="record-clock">' + escapeHtml(r.time) + '</div>'
        + '</div>'
        + '<div class="record-content md-rendered">' + renderMarkdown(r.content) + '</div>'
        + '<button class="record-edit" data-rid="' + r.id + '" title="编辑">'
        + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>'
        + '</button>'
        + '<button class="record-delete" data-id="' + r.id + '" title="删除">'
        + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>'
        + '</button>'
        + '</div>';
    }).join('');

    // Checkbox change
    list.querySelectorAll('.record-checkbox').forEach(function(cb) {
      cb.addEventListener('change', function() {
        toggleSelectRecord(cb.dataset.rid);
      });
    });

    // Edit button
    list.querySelectorAll('.record-edit').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        editRecord(btn.dataset.rid);
      });
    });

    // Delete button
    list.querySelectorAll('.record-delete').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        deleteRecord(btn.dataset.id);
      });
    });
  }

  function updateSummaryMeta(count) {
    $('summaryMeta').textContent = count > 0 ? '（共 ' + count + ' 条记录）' : '';
  }

  // ===== Typing effect (now renders Markdown with fade-in) =====
  function typeText(element, text, speed) {
    element.innerHTML = '';
    element.classList.remove('typing-cursor');
    const html = renderMarkdown(text);
    element.innerHTML = html;
    element.classList.add('md-fade-in');
    // Store raw markdown for MD download
    element.dataset.rawText = text;
    // mermaid 源码块渲染成图（思维导图/流程图等；库不可用时保持源码块）
    if (window.AiService && AiService.enhanceMermaid) AiService.enhanceMermaid(element);
    return Promise.resolve();
  }

  // ===== Auto-format result =====
  function autoFormatResult(text) {
    text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    text = text.split('\n').map(line => line.trimEnd()).join('\n');
    text = text.replace(/\n{3,}/g, '\n\n');
    text = text.replace(/^\n+/, '').replace(/\n+$/, '');
    text = text.replace(/^([\s]*[-*+])\s{2,}/gm, '$1 ');
    text = text.replace(/^([\s]*\d+\.)\s{2,}/gm, '$1 ');
    text = text.replace(/([。！？；])([^\n\s])/g, '$1 $2');
    text = text.replace(/\s+([。！？，；：、])/g, '$1');
    return text;
  }

  // ===== Summarize =====
  async function doSummarize() {
    var filtered = getFilteredRecords();

    // If any records are manually selected, use only those
    if (selectedRecordIds.length > 0) {
      filtered = filtered.filter(function(r) { return selectedRecordIds.indexOf(r.id) >= 0; });
    }

    // 无匹配记录时兜底：输入区有内容或载入有附件 → 直接总结（附件内容带文件名分界随请求发送）
    var usingEditor = false;
    if (filtered.length === 0) {
      var draftText = workEditor ? workEditor.getMarkdown().trim() : '';
      if (!draftText && !loadedFiles.some(function(f) { return f.status === 'done'; })) {
        showToast('当前筛选条件下无工作记录，且输入区为空；请调整日期范围、保存记录、粘贴内容或选择附件', 'error');
        return;
      }
      usingEditor = true;
    }

    if (!config.baseUrl || !config.apiKey || !config.model) {
      showToast('请先配置 API 设置', 'error');
      $('settingsPanel').classList.add('open');
      return;
    }

    // 语言以界面选择为准：applySyncedConfig 会重写 config，仅读 config 会导致
    // 下拉框显示 English 而实际按 zh 组 prompt
    const inputLang = ($('inputLang') && $('inputLang').value) || config.inputLang || 'zh';
    const outputLang = ($('outputLang') && $('outputLang').value) || config.outputLang || 'zh';
    // Use English language names in prompts when output is non-Chinese
    // to avoid mixing Chinese chars that trigger LLM code-switching
    const nameMap = (outputLang === 'zh') ? LANG_NAMES : LANG_NAMES_EN;
    const inputLangName = (nameMap[inputLang] || LANG_NAMES_EN[inputLang] || inputLang);
    const outputLangName = (nameMap[outputLang] || LANG_NAMES_EN[outputLang] || outputLang);

    const btn = $('summarizeBtn');
    const resultEl = $('summaryResult');
    const footer = $('summaryFooter');
    const loadingBar = $('loadingBar');

    btn.disabled = true;
    btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v4m0 12v4m-7.07-3.93l2.83-2.83m8.48-8.48l2.83-2.83M2 12h4m12 0h4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83"/></svg> 正在生成总结...';
    resultEl.classList.add('visible');
    resultEl.innerHTML = '';
    resultEl.classList.remove('typing-cursor');
    footer.classList.remove('visible');
    resetWechatSection();
    loadingBar.classList.add('active');

    // Build records text（兜底来源：附件内容 + 输入框正文，附件不占输入框）
    const recordsText = usingEditor ? buildInputSourceText() : filtered.map((r, i) => {
      return `[${i + 1}] ${r.date} ${r.time}\n${r.content}`;
    }).join('\n\n---\n\n');

    // Build language-aware prompt components
    const isOutputChinese = outputLang === 'zh';
    const rangeSep = isOutputChinese ? ' 至 ' : ' to ';

    const dateRange = usingEditor
      ? formatDate(Date.now())
      : (filtered.length > 1
        ? filtered[filtered.length - 1].date + rangeSep + filtered[0].date
        : filtered[0].date);
    const sectionTitle = isOutputChinese ? '工作总结' : 'Work Summary';
    const keyPointsTitle = isOutputChinese ? '要点总结' : 'Key Points';
    const detailTitle = isOutputChinese ? '要点详述' : 'Detailed Breakdown';

    // System prompt — 选中总结模板时走共享模板提示词（scenario-templates 25 套）；否则保持默认要点总结
    var tplId = ($('summaryTemplate') && $('summaryTemplate').value) || 'default';
    var systemPrompt;
    if (tplId !== 'default' && window.AiService && window.AiService.summaryTemplatePrompt) {
      systemPrompt = window.AiService.summaryTemplatePrompt(tplId, outputLangName);
    } else if (isOutputChinese) {
      systemPrompt = '你是工作汇报总结助手。请阅读以下工作记录，提取关键要点并生成结构化的中文总结。\n\n输出格式：\n## 📋 ' + sectionTitle + ' (' + dateRange + ')\n### 🔑 ' + keyPointsTitle + '\n- [要点]\n### 📝 ' + detailTitle + '\n**1. [标题]** 详细阐述';
    } else {
      // For non-Chinese output: split system+user into a translation workflow
      // that DeepSeek reliably follows
      systemPrompt = 'Role: English-only work summarizer.\nRule: You read ' + inputLangName + ' input but write ONLY in ' + outputLangName + '.\nFormat:\n## 📋 ' + sectionTitle + '\n### 🔑 ' + keyPointsTitle + '\n- point\n### 📝 ' + detailTitle + '\n**1. title** elaboration.';
    }

    // 解析要求（可选）：随内容一起发给 AI，与模板结构并行生效（同 AI 解析页 analyzeContent 模式）
    const instruction = (($('summaryInstruction') || {}).value || '').trim();

    // Build user message — 解析要求在前，来源为工作记录或编辑器输入内容；非中文时隔离输入语言块
    var srcLabel = usingEditor ? (isOutputChinese ? '输入内容' : 'input content') : (isOutputChinese ? '工作记录' : 'work records');
    var userMsgContent;
    if (isOutputChinese) {
      userMsgContent = (instruction ? '【解析要求】\n' + instruction + '\n\n———\n\n' : '')
        + '请用' + outputLangName + '总结以下' + srcLabel + '（' + dateRange + '）：\n\n' + recordsText;
    } else {
      userMsgContent = (instruction ? '[Instructions]\n' + instruction + '\n\n———\n\n' : '')
        + 'Produce a ' + outputLangName + ' summary of this ' + srcLabel + ' (' + dateRange + ').\n'
        + 'Respond ENTIRELY in ' + outputLangName + '. Do NOT write any ' + inputLangName + '.\n\n'
        + '=== BEGIN INPUT (read in ' + inputLangName + ', respond in ' + outputLangName + ') ===\n'
        + recordsText
        + '\n=== END INPUT ===\n\n'
        + 'Now write the ' + outputLangName + ' summary:';
    }

    try {
      // URL 归一化 + 推理模型参数自适应：与 AiService.chat()/email_summary 同一模式
      const _as = window.AiService || {};
      const url = _as.buildUrl ? _as.buildUrl(config.baseUrl) : config.baseUrl.replace(/\/+$/, '') + '/chat/completions';
      const reasoning = _as.isReasoningModel ? _as.isReasoningModel(config.model) : false;
      // 经 AiService.proxyFetch：网页直连失败时自动走扩展代理桥（Token Plan 等无 CORS 端点也可用）
      const _pf = _as.proxyFetch || fetch;

      async function summaryReq(includeTemp) {
        const body = {
          model: config.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMsgContent }
          ],
        };
        if (!reasoning && includeTemp) body.temperature = 0.1;
        const response = await _pf(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + config.apiKey,
          },
          body: JSON.stringify(body),
        });
        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          const e = new Error(errData.error?.message || 'HTTP ' + response.status);
          e.status = response.status;
          throw e;
        }
        return response;
      }

      let response;
      try {
        response = await summaryReq(!reasoning);
      } catch (err) {
        // 部分推理模型收到 temperature 仍报 400 → 去 temperature 无参重试一次
        if (!reasoning && /temperature/i.test(String(err && err.message || ''))) {
          response = await summaryReq(false);
        } else { throw err; }
      }

      const data = await response.json();
      let result = data.choices?.[0]?.message?.content?.trim() || '';

      if (!result) throw new Error('总结结果为空，请检查模型配置');

      result = autoFormatResult(result);

      loadingBar.classList.remove('active');
      await typeText(resultEl, result);

      footer.classList.add('visible');

      // Save to summary history
      saveSummaryResult(dateRange, result, inputLang, outputLang, tplId);

      showToast('总结生成完成', 'success');
    } catch (err) {
      loadingBar.classList.remove('active');
      resultEl.innerHTML = '<span style="color:var(--red);">生成失败: ' + escapeHtml(describeApiError(err)) + '</span>';
      resultEl.classList.add('visible');
      showToast('总结生成失败: ' + describeApiError(err), 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> 生成总结';
    }
  }

  // ===== Copy Summary =====
  function copySummary() {
    const text = $('summaryResult').dataset.rawText || $('summaryResult').textContent;
    if (!text || text.includes('选择日期范围')) {
      showToast('暂无总结内容可复制', 'error');
      return;
    }
    navigator.clipboard.writeText(text).then(
      () => showToast('总结已复制到剪贴板', 'success'),
      () => showToast('复制失败', 'error')
    );
  }

  // ===== WeChat Plain-Text Format =====
  // 转换实现已提升到共享的 markdown.js（markdownToWechat），各工具页统一复用
  function resetWechatSection() {
    var sec = $('wechatSection');
    var box = $('wechatResult');
    if (box) { box.textContent = ''; delete box.dataset.rawText; }
    if (sec) sec.style.display = 'none';
  }

  function convertToWechat() {
    var resultEl = $('summaryResult');
    var raw = (resultEl && resultEl.dataset.rawText) || '';
    if (!raw || raw.includes('选择日期范围')) {
      showToast('暂无总结内容可转换', 'error');
      return;
    }
    var text = window.markdownToWechat ? window.markdownToWechat(raw) : '';
    if (!text) { showToast('暂无总结内容可转换', 'error'); return; }
    var box = $('wechatResult');
    var sec = $('wechatSection');
    if (!box || !sec) return;
    box.textContent = text;
    box.dataset.rawText = text;
    sec.style.display = 'block';
    showToast('已生成微信格式，点击「复制」即可粘贴发送', 'success');
  }

  function copyWechat() {
    var box = $('wechatResult');
    var text = (box && (box.dataset.rawText || box.textContent)) || '';
    if (!text) { showToast('请先生成微信格式', 'error'); return; }
    navigator.clipboard.writeText(text).then(
      () => showToast('微信格式已复制到剪贴板', 'success'),
      () => showToast('复制失败', 'error')
    );
  }

  // ===== Download Summary =====
  // ===== Harden：API 错误友好诊断（指明问题 + 给出恢复路径，不透传原始报错） =====
  function describeApiError(err) {
    var msg = String((err && err.message) || err || '');
    var st = err && err.status;
    if (!st) { var m = msg.match(/HTTP\s*(\d{3})/); if (m) st = parseInt(m[1], 10); }
    if (st === 401 || st === 403) return 'API Key 无效或无权限，请在 API 设置中检查 Key';
    if (st === 404) return 'API 地址或模型名不存在，请检查 Base URL 与模型名称';
    if (st === 429) return '请求过于频繁或额度不足，请稍后重试或检查账户余额';
    if (st >= 500) return 'API 服务暂时不可用（' + st + '），请稍后重试';
    if (/Failed to fetch|NetworkError|Load failed|timeout/i.test(msg)) {
      return '无法连接 API：网络异常，或浏览器拦截了跨域请求（CORS）。可改用 Chrome 扩展版（无跨域限制），或换用支持跨域的 API 服务';
    }
    return msg || '未知错误，请稍后重试';
  }

  async function downloadSummary(format) {
    const text = $('summaryResult').textContent;
    if (!text || text.includes('选择日期范围')) {
      showToast('暂无总结内容可下载', 'error');
      return;
    }
    // 必须使用原始 Markdown（dataset.rawText）：textContent 已被 renderMarkdown 渲染剥离了
    // Markdown 语法（##、**、1. 等），直接转换会丢失全部格式，导致导出与界面显示不一致
    var raw = $('summaryResult').dataset.rawText || text;
    var filename, mime, content;
    if (format === 'md') {
      filename = 'work-summary-' + formatDate(Date.now()) + '.md';
      mime = 'text/markdown;charset=utf-8';
      content = raw;
    } else {
      // 单文件 HTML 导出统一走 AiService（scenario-templates R2 交互式版式；
      // mdToHtmlAsync 额外把 mermaid 块（思维导图/流程图）内嵌打包库渲染成图）
      filename = 'work-summary-' + formatDate(Date.now()) + '.html';
      mime = 'text/html;charset=utf-8';
      content = (window.AiService && AiService.mdToHtmlAsync)
        ? await AiService.mdToHtmlAsync(raw, 'Work Summary')
        : (window.AiService && AiService.mdToHtml ? AiService.mdToHtml(raw, 'Work Summary') : raw);
    }
    var blob = new Blob([content], { type: mime });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
    showToast(format.toUpperCase() + ' 下载完成', 'success');
  }

  // ===== Save Summary to History =====
  function saveSummaryResult(dateRange, resultText, inputLang, outputLang, templateId) {
    var now = Date.now();
    summaries.unshift({
      id: now.toString(),
      dateRange: dateRange,
      content: resultText,
      inputLang: inputLang,
      outputLang: outputLang,
      template: templateId || 'default',
      date: formatDate(now),
      time: formatTime(now),
      timestamp: now
    });
    if (summaries.length > 50) summaries = summaries.slice(0, 50);
    storage.set({ work_summaries: summaries }).then(function() {
      renderSummaryHistory();
    });
  }

  // ===== Delete Summary =====
  function deleteSummaryItem(id) {
    summaries = summaries.filter(function(s) { return s.id !== id; });
    storage.set({ work_summaries: summaries }).then(function() {
      renderSummaryHistory();
      showToast('总结已删除', 'success');
    });
  }

  // ===== Clear All Summaries =====
  function clearAllSummaries() {
    if (!confirm('确定要清空所有总结历史吗？此操作不可恢复。')) return;
    summaries = [];
    storage.set({ work_summaries: summaries }).then(function() {
      renderSummaryHistory();
      showToast('所有总结已清空', 'success');
    });
  }

  // ===== Multi-select =====
  function toggleSelectRecord(id) {
    var idx = selectedRecordIds.indexOf(id);
    if (idx >= 0) {
      selectedRecordIds.splice(idx, 1);
    } else {
      selectedRecordIds.push(id);
    }
    updateSelectInfo();
  }

  function toggleSelectAll() {
    var filtered = getFilteredRecords();
    if (selectedRecordIds.length === filtered.length && filtered.length > 0) {
      // All selected → deselect all
      selectedRecordIds = [];
    } else {
      // Select all filtered
      selectedRecordIds = filtered.map(function(r) { return r.id; });
    }
    renderRecords();
  }

  function updateSelectInfo() {
    var el = $('selectInfo');
    if (el) {
      el.textContent = selectedRecordIds.length > 0 ? '（已选 ' + selectedRecordIds.length + ' 条）' : '';
    }
  }

  // ===== Clear All Records =====
  function clearAllRecords() {
    if (!confirm('确定要清空所有工作记录吗？此操作不可恢复。')) return;
    records = [];
    storage.set({ work_records: records }).then(function() {
      renderRecords();
      showToast('所有记录已清空', 'success');
    });
  }

  // ===== Render Summary History =====
  function renderSummaryHistory() {
    var list = $('summaryHistoryList');
    var countEl = $('summaryHistoryCount');
    if (!list) return;
    if (countEl) countEl.textContent = summaries.length + ' 条';
    var selAllBox = $('summarySelectAll');
    if (selAllBox) selAllBox.checked = false;
    if (summaries.length === 0) {
      list.innerHTML = '<div class="records-empty">暂无总结历史，生成总结后自动保存</div>';
      return;
    }
    list.innerHTML = summaries.map(function(s) {
      var tpl = (s.template && s.template !== 'default' && window.AiService) ? AiService.getSummaryTemplate(s.template) : null;
      return '<div class="record-item summary-history-item" data-sid="' + s.id + '">'
        + '<input type="checkbox" class="record-checkbox sum-hist-check" data-sid="' + s.id + '" title="勾选后可导出选中项">'
        + '<div class="record-time">'
        + '<div class="record-date">' + escapeHtml(s.date) + '</div>'
        + '<div class="record-clock">' + escapeHtml(s.time) + '</div>'
        + '</div>'
        + '<div class="record-content">'
        + escapeHtml(s.dateRange) + ' · ' + escapeHtml(LANG_NAMES[s.outputLang] || s.outputLang)
        + (tpl ? ' · ' + escapeHtml(tpl.label) : '')
        + '<br><span style="color:var(--text-secondary);font-size:0.8rem;">'
        + escapeHtml(s.content.substring(0, 100)) + '...</span>'
        + '</div>'
        + '<button class="record-delete" title="删除">'
        + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
        + '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>'
        + '</svg>'
        + '</button>'
        + '</div>';
    }).join('');

    // Click to load
    list.querySelectorAll('.summary-history-item').forEach(function(item) {
      item.addEventListener('click', function(e) {
        if (e.target.closest('.record-delete') || e.target.closest('.sum-hist-check')) return;
        var sid = item.dataset.sid;
        var sm = summaries.find(function(s) { return s.id === sid; });
        if (sm) {
          var resultEl = $('summaryResult');
          var footer = $('summaryFooter');
          if (resultEl) {
            resultEl.innerHTML = renderMarkdown(sm.content);
            resultEl.classList.add('visible', 'md-fade-in');
            resultEl.dataset.rawText = sm.content;
            if (window.AiService && AiService.enhanceMermaid) AiService.enhanceMermaid(resultEl);
          }
          if (footer) footer.classList.add('visible');
          resetWechatSection();
          showToast('已加载 ' + sm.date + ' 的总结', 'success');
        }
      });
    });

    // Delete buttons
    list.querySelectorAll('.record-delete').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        var item = btn.closest('.summary-history-item');
        if (item) deleteSummaryItem(item.dataset.sid);
      });
    });
  }

  // ===== Summary Template Select（scenario-templates 共享模板 25 套，按场景分组，默认要点总结保留） =====
  function initTemplateSelect() {
    var sel = $('summaryTemplate');
    if (!sel) return;
    var tpls = (window.AiService && AiService.SUMMARY_TEMPLATES) || [];
    var scenes = ['会议纪要', '日报周报', '任务提取', '邮件总结', '邮件撰写'];
    var html = '<option value="default">默认要点总结</option>';
    scenes.forEach(function (sc) {
      var group = tpls.filter(function (t) { return t.scene === sc; });
      if (!group.length) return;
      html += '<optgroup label="' + escapeHtml(sc) + '">';
      group.forEach(function (t) {
        html += '<option value="' + escapeHtml(t.id) + '" title="' + escapeHtml(t.hint || '') + '">' + escapeHtml(t.label) + '</option>';
      });
      html += '</optgroup>';
    });
    sel.innerHTML = html;
    sel.value = (config.summaryTemplate && sel.querySelector('option[value="' + config.summaryTemplate + '"]'))
      ? config.summaryTemplate : 'default';
  }

  // ===== 历史总结：勾选后导出为 Markdown / HTML（v0.45.0） =====
  function selectedSummaries() {
    var ids = [];
    document.querySelectorAll('#summaryHistoryList .sum-hist-check:checked').forEach(function(c) {
      ids.push(c.dataset.sid);
    });
    return summaries.filter(function(s) { return ids.indexOf(s.id) !== -1; });
  }

  function summaryItemMarkdown(s) {
    var head = [s.date, s.time, s.dateRange, LANG_NAMES[s.outputLang] || s.outputLang]
      .filter(Boolean).join(' · ');
    return '## ' + head + '\n\n' + (s.content || '');
  }

  async function exportSelectedSummaries(format) {
    var items = selectedSummaries();
    if (!items.length) { showToast('请先勾选要导出的总结', 'error'); return; }
    if (!window.AiService || !AiService.downloadText) { showToast('导出功能不可用', 'error'); return; }
    var md = items.map(summaryItemMarkdown).join('\n\n---\n\n');
    var stamp = new Date().toISOString().slice(0, 10);
    if (format === 'html') {
      var html = AiService.mdToHtmlAsync ? await AiService.mdToHtmlAsync(md, '工作报告总结') : AiService.mdToHtml(md, '工作报告总结');
      AiService.downloadText('ai-toolbox-work-summaries-' + stamp + '.html', html, 'text/html;charset=utf-8');
    } else {
      AiService.downloadText('ai-toolbox-work-summaries-' + stamp + '.md', md, 'text/markdown;charset=utf-8');
    }
    showToast('已导出 ' + items.length + ' 条总结', 'success');
  }

  // ===== Event Bindings (synchronous — bound immediately, before init) =====
  (function bindEventsSync() {
    var btn = $('toggleSettings');
    if (btn) btn.addEventListener('click', toggleSettings);
    btn = $('saveSettingsBtn');
    if (btn) btn.addEventListener('click', saveSettings);
    btn = $('saveRecordBtn');
    if (btn) btn.addEventListener('click', saveRecord);

    // 附件与清空输入（多文件；统一单文件 150MB 上限）
    btn = $('selectFileBtn');
    if (btn) btn.addEventListener('click', function() { var fi = $('fileInput'); if (fi) fi.click(); });
    btn = $('fileInput');
    if (btn) btn.addEventListener('change', function(e) {
      // FileList 是活绑定的，须先拷贝成静态数组再清空 input，否则异步处理中途 length 变 0
      var files = Array.prototype.slice.call(e.target.files || []);
      if (!files.length) return;
      handleAttachments(files);
      e.target.value = '';
    });
    btn = $('fileList');
    if (btn) btn.addEventListener('click', function(e) {
      var t = e.target;
      if (t && t.classList && t.classList.contains('fi-remove')) {
        var idx = parseInt(t.getAttribute('data-idx'), 10);
        if (!isNaN(idx) && loadedFiles[idx]) {
          var removedName = loadedFiles[idx].name;
          loadedFiles.splice(idx, 1);
          renderAttachmentList();
          showToast('已移除附件：' + removedName, 'info');
        }
      }
    });
    btn = $('clearInputBtn');
    if (btn) btn.addEventListener('click', clearWorkInput);
    btn = $('applyFilterBtn');
    if (btn) btn.addEventListener('click', applyFilter);
    btn = $('clearFilterBtn');
    if (btn) btn.addEventListener('click', clearFilter);
    btn = $('summarizeBtn');
    if (btn) btn.addEventListener('click', doSummarize);
    btn = $('copySummaryBtn');
    if (btn) btn.addEventListener('click', copySummary);
    btn = $('wechatFormatBtn');
    if (btn) btn.addEventListener('click', convertToWechat);
    btn = $('copyWechatBtn');
    if (btn) btn.addEventListener('click', copyWechat);

    // Download buttons
    btn = $('downloadHtmlBtn');
    if (btn) btn.addEventListener('click', function() { downloadSummary('html'); });
    btn = $('downloadMdBtn');
    if (btn) btn.addEventListener('click', function() { downloadSummary('md'); });

    // Clear all buttons
    btn = $('clearAllRecordsBtn');
    if (btn) btn.addEventListener('click', clearAllRecords);
    btn = $('summarySelectAll');
    if (btn) btn.addEventListener('change', function () {
      var on = this.checked;
      document.querySelectorAll('#summaryHistoryList .sum-hist-check').forEach(function (c) { c.checked = on; });
    });
    btn = $('exportSummaryMdBtn');
    if (btn) btn.addEventListener('click', function () { exportSelectedSummaries('md'); });
    btn = $('exportSummaryHtmlBtn');
    if (btn) btn.addEventListener('click', function () { exportSelectedSummaries('html'); });

    // 记录跨端实时同步（v0.25.0）：他端写入时刷新列表
    if (window.AiService && window.AiService.onRecordSync) {
      window.AiService.onRecordSync('work_records', function (v) { records = Array.isArray(v) ? v : []; renderRecords(); });
      window.AiService.onRecordSync('work_summaries', function (v) { summaries = Array.isArray(v) ? v : []; renderSummaryHistory(); });
    }
    btn = $('cancelEditBtn');
    if (btn) btn.addEventListener('click', cancelEdit);
    btn = $('toggleSelectAllBtn');
    if (btn) btn.addEventListener('click', toggleSelectAll);
    btn = $('clearAllSummariesBtn');
    if (btn) btn.addEventListener('click', clearAllSummaries);

    // Language selectors — update config on change
    var inputLangSel = $('inputLang');
    if (inputLangSel) {
      inputLangSel.addEventListener('change', function() {
        config.inputLang = this.value;
        storage.set({ work_config: config });
      });
    }
    var outputLangSel = $('outputLang');
    if (outputLangSel) {
      outputLangSel.addEventListener('change', function() {
        config.outputLang = this.value;
        storage.set({ work_config: config });
      });
    }

    // 总结模板选择 — 持久化到 work_config
    var templateSel = $('summaryTemplate');
    if (templateSel) {
      templateSel.addEventListener('change', function() {
        config.summaryTemplate = this.value;
        storage.set({ work_config: config });
      });
    }

    // 解析要求输入框（v0.52.0）— 持久化到 work_config
    var instrInput = $('summaryInstruction');
    if (instrInput) {
      instrInput.addEventListener('change', function() {
        config.summaryInstruction = this.value.trim();
        storage.set({ work_config: config });
      });
    }

    // Keyboard shortcut — bound on workEditor.container after init
    // (see init function below)

    // Preview toggle: 由 HTML inline onclick 调用 window.toggleMdPreview，
    // 此处不再重复绑定，避免一次点击触发两次切换
  })();

  // ===== Preview Functions =====
  var _mdPreviewOpen = false;
  function toggleMdPreview() {
    _mdPreviewOpen = !_mdPreviewOpen;
    var panel = document.getElementById('mdPreviewPanel');
    var btn = document.getElementById('previewToggleBtn');
    if (_mdPreviewOpen) {
      panel.style.display = 'block';
      btn.classList.add('active');
      updateMdPreview();
    } else {
      panel.style.display = 'none';
      btn.classList.remove('active');
    }
  }

  function updateMdPreview() {
    if (!_mdPreviewOpen || !workEditor) return;
    var text = workEditor.getMarkdown();
    var preview = document.getElementById('mdPreviewContent');
    if (text.trim()) {
      preview.innerHTML = renderMarkdown(text);
    } else {
      preview.innerHTML = '<p style="color:var(--text-dim);font-style:italic;">输入 Markdown 内容即可实时预览...</p>';
    }
  }

  // Expose to window for onclick handlers
  window.toggleMdPreview = toggleMdPreview;
  window.updateMdPreview = updateMdPreview;

  // ===== 插件配置同步（LinguaFlow 扩展广播） =====
  function applySyncedConfig(cfg) {
    if (!cfg || !cfg.baseUrl) return;
    // 只同步连接信息，保留用户在本页选定的输入/输出语言、总结模板与解析要求
    config = {
      baseUrl: cfg.baseUrl,
      apiKey: cfg.apiKey,
      model: cfg.model,
      inputLang: config.inputLang || 'zh',
      outputLang: config.outputLang || 'zh',
      summaryTemplate: config.summaryTemplate || 'default',
      summaryInstruction: config.summaryInstruction || '',
    };
    if (cfg.baseUrl) $('baseUrl').value = cfg.baseUrl;
    if (cfg.apiKey) $('apiKey').value = cfg.apiKey;
    if (cfg.model) $('modelName').value = cfg.model;
    if ($('inputLang')) $('inputLang').value = config.inputLang;
    if ($('outputLang')) $('outputLang').value = config.outputLang;
    const panel = $('settingsPanel');
    if (panel) panel.classList.remove('open');
    showToast('已同步插件配置（Base URL / API Key / Model）', 'success');
  }
  // 网页环境：content script 通过 postMessage 广播
  window.addEventListener('message', (e) => {
    const d = e.data;
    if (d && d.source === 'linguaflow-extension' && d.config) applySyncedConfig(d.config);
  });
  // 扩展环境：直接监听 chrome.storage 变化
  if (isExtension) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if ((area === 'local' || (area && area.areaName === 'local')) && changes.config && changes.config.newValue) {
        applySyncedConfig(changes.config.newValue);
      }
    });
  }

  // ===== Init =====
  async function init() {
    const data = await storage.get(['work_config', 'work_records', 'work_draft', 'work_summary_config', 'work_summaries']);

    // Load config — first try work-specific config, then fall back to translate config
    let savedConfig = data.work_config;
    if (!savedConfig || !savedConfig.baseUrl) {
      // Try to load from legacy key or the translate config
      const xlateData = await storage.get(['config']);
      if (xlateData.config && xlateData.config.baseUrl) {
        savedConfig = {
          baseUrl: xlateData.config.baseUrl,
          apiKey: xlateData.config.apiKey,
          model: xlateData.config.model,
          inputLang: 'zh',
          outputLang: 'zh',
        };
      }
      // 网页环境：插件 content script 会把配置同步到 localStorage('translate_config')
      if ((!savedConfig || !savedConfig.baseUrl) && !isExtension) {
        try {
          const tc = JSON.parse(localStorage.getItem('translate_config') || 'null');
          if (tc && tc.baseUrl) {
            savedConfig = { baseUrl: tc.baseUrl, apiKey: tc.apiKey, model: tc.model, inputLang: 'zh', outputLang: 'zh' };
          }
        } catch (e) { /* ignore */ }
      }
    }

    if (savedConfig) {
      config = savedConfig;
      if (config.baseUrl) $('baseUrl').value = config.baseUrl;
      if (config.apiKey) $('apiKey').value = config.apiKey;
      if (config.model) $('modelName').value = config.model;
      if (config.inputLang) $('inputLang').value = config.inputLang;
      if (config.outputLang) $('outputLang').value = config.outputLang;
    }

    // 总结模板下拉（scenario-templates）：填充选项并恢复上次选择（无保存配置时回落 default）
    initTemplateSelect();

    // 解析要求输入框：恢复上次输入
    if ($('summaryInstruction')) $('summaryInstruction').value = config.summaryInstruction || '';

    if (!config.apiKey) {
      const panel = $('settingsPanel');
      if (panel) panel.classList.add('open');
    }

    // Initialize MdEditor
    var container = document.getElementById('workInput');
    if (container) {
      workEditor = MdEditor.create(container, {
        placeholder: '请输入工作内容 (支持 Markdown)...',
        onInput: function(md) {
          clearTimeout(draftTimer);
          draftTimer = setTimeout(saveDraft, 300);
          $('draftHint').textContent = '草稿已修改...';
          // Update preview if open
          if (_mdPreviewOpen) updateMdPreview();
        }
      });
    }

    // Bind blur for draft save
    if (workEditor && workEditor.container) {
      workEditor.container.addEventListener('blur', function() {
        saveDraft();
      });
    }

    // Keyboard shortcut
    if (workEditor && workEditor.container) {
      workEditor.container.addEventListener('keydown', function(e) {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
          e.preventDefault();
          saveRecord();
        }
      });
    }

    // Load records
    records = data.work_records || [];
    renderRecords();

    // Load summaries
    summaries = data.work_summaries || [];
    renderSummaryHistory();

    // Restore draft
    if (data.work_draft && workEditor) {
      workEditor.setMarkdown(data.work_draft);
    }

    // Init filter clear btn visibility
    const clearBtn = $('clearFilterBtn');
    if (clearBtn) clearBtn.style.display = 'none';
  }

  init().catch(function(e) {
    console.error('[WorkReport] init failed:', e);
  });
})();
