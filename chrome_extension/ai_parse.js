/**
 * ai_parse.js — AI 解析（AI Parse）页面逻辑
 *
 * 双模式（与 TaskFlow AI Parse 一致）:
 *   - 任务抽取（经典）: 无解析要求 + 无附件 → parseNotes() → 结构化任务卡片（勾选 → 创建任务清单）
 *   - 自由分析: 有解析要求 或 有附件 → analyzeContent() → Markdown 总结（可复制 / 下载）
 * 邮件线程自动识别: 附件含 .eml 或文本匹配 looksLikeEmail → 走邮件线程 playbook
 *
 * 依赖: markdown.js, md-editor.js, ai-service.js
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const Ai = window.AiService;

  // pdf.js worker 本地加载（扩展 MV3 CSP 不允许远程脚本，须打包在目录内）
  if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'pdf.worker.min.js';
  }

  let config = Ai.getConfig();
  let loadedFiles = [];          // [{ name, content, isEmail }]
  let currentTasks = [];         // parse 模式当前任务列表
  let currentSummaryMd = '';     // analyze 模式当前 Markdown 原文
  let _busy = false;
  let _mdPreviewOpen = false;

  /* ==================== 状态持久化（Web: localStorage / 扩展: chrome.storage.local） ==================== */

  const STATE_KEY = 'ai_parse_state';
  const HISTORY_LIMIT = 30;
  const state = { draft: '', instructions: '', lang: 'zh', template: 'auto', history: [] };

  let saveTimer = null;
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 500);
  }
  function saveNow() {
    clearTimeout(saveTimer);
    Ai.saveState(STATE_KEY, state);
  }

  /* ==================== 通用工具 ==================== */

  const RUN_ICON =
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>';

  function runBtnHtml(label) {
    return RUN_ICON + ' ' + label;
  }

  function stamp() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' +
      p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  let toastTimer = null;
  function showToast(msg, type) {
    const t = $('toast');
    t.textContent = msg;
    t.className = 'toast show ' + (type || 'info');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.className = 'toast'; }, 2600);
  }

  function setLoading(on) {
    $('loadingBar').classList.toggle('active', on);
    $('runBtn').disabled = on;
  }

  function showError(err) {
    $('errorBox').style.display = 'block';
    $('errorBox').textContent = Ai.describeApiError(err);
  }

  function hideError() {
    $('errorBox').style.display = 'none';
  }

  /* ==================== 模式判断 ==================== */

  function isAnalyzeMode() {
    return !!(String($('instructionsInput').value || '').trim() || loadedFiles.some((f) => f.status === 'done'));
  }

  function updateMode() {
    const analyze = isAnalyzeMode();
    $('modeHint').innerHTML = analyze
      ? '当前模式：<strong>分析</strong>（有解析要求或附件，输出自由格式 Markdown 总结）'
      : '当前模式：<strong>任务抽取</strong>（从笔记中提取结构化任务列表）';
    // 总结模板仅分析模式可用（任务抽取输出结构化任务卡，与模板无关）
    const tplWrap = $('templateWrap');
    if (tplWrap) tplWrap.style.display = analyze ? '' : 'none';
    if (!_busy) $('runBtn').innerHTML = runBtnHtml(analyze ? 'AI 分析' : 'AI 解析');
  }

  /* ==================== 配置 ==================== */

  function applySyncedConfig(cfg) {
    if (!cfg || !cfg.baseUrl) return;
    config = { baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, model: cfg.model };
    if (cfg.baseUrl) $('baseUrl').value = cfg.baseUrl;
    if (cfg.apiKey) $('apiKey').value = cfg.apiKey;
    if (cfg.model) $('modelName').value = cfg.model;
    $('settingsPanel').classList.remove('open');
    showToast('已同步插件配置（Base URL / API Key / Model）', 'success');
  }

  function initSettings() {
    if (config.baseUrl) {
      $('baseUrl').value = config.baseUrl;
      if (config.apiKey) $('apiKey').value = config.apiKey;
      if (config.model) $('modelName').value = config.model;
    }
    Ai.initConfigSync(applySyncedConfig);

    $('toggleSettings').addEventListener('click', () => {
      $('settingsPanel').classList.toggle('open');
    });
    $('saveSettingsBtn').addEventListener('click', () => {
      const cfg = {
        baseUrl: String($('baseUrl').value || '').trim(),
        apiKey: String($('apiKey').value || '').trim(),
        model: String($('modelName').value || '').trim(),
      };
      if (!cfg.baseUrl || !cfg.apiKey || !cfg.model) {
        showToast('请填写完整的 API 配置（Base URL / API Key / Model）', 'error');
        return;
      }
      Ai.saveConfig(cfg);
      config = cfg;
      showToast('配置已保存', 'success');
      $('settingsPanel').classList.remove('open');
    });
  }

  /* ==================== 编辑器与预览 ==================== */

  function initEditor() {
    const notesEditor = MdEditor.create($('notesInput'), {
      initialMarkdown: '',
      placeholder: '在这里粘贴原始工作笔记 / 测试日志 / 会议纪要 / 邮件线程...',
      onInput: () => {
        state.draft = notesEditor.getMarkdown();
        if (_mdPreviewOpen) $('mdPreviewContent').innerHTML = renderMarkdown(state.draft);
        scheduleSave();
      },
    });

    window.toggleMdPreview = function () {
      _mdPreviewOpen = !_mdPreviewOpen;
      const panel = $('mdPreviewPanel');
      const btn = $('previewToggleBtn');
      if (_mdPreviewOpen) {
        panel.style.display = 'block';
        btn.classList.add('active');
        $('mdPreviewContent').innerHTML = renderMarkdown(notesEditor.getMarkdown());
      } else {
        panel.style.display = 'none';
        btn.classList.remove('active');
      }
    };
    $('previewCloseBtn').addEventListener('click', () => {
      if (_mdPreviewOpen) window.toggleMdPreview();
    });

    return notesEditor;
  }

  /* ==================== 附件 ==================== */

  // 附件清单渲染（对齐 voice transcription AI 总结页样式）：纵向卡片 = 文件名 + 大小·状态行
  // + 完成勾 / 红色错误行 + 独立移除按钮；失败的附件留在清单中标红、不参与总结
  function renderAttachmentList() {
    const list = $('fileList');
    if (!list) return;
    if (!loadedFiles.length) {
      list.classList.remove('visible');
      list.innerHTML = '';
      return;
    }
    list.classList.add('visible');
    list.innerHTML = loadedFiles.map((f, i) => {
      const metaCls = f.status === 'error' ? 'err' : (f.status === 'done' ? 'ok' : '');
      return '<div class="file-item">'
        + '<div class="fi-main">'
        + '<span class="fi-name" title="' + escapeHtml(f.name) + '">' + escapeHtml(f.name) + '</span>'
        + '<span class="fi-meta ' + metaCls + '">' + escapeHtml((Ai.formatBytes ? Ai.formatBytes(f.size) : '') + ' · ' + (f.stage || '')) + '</span>'
        + (f.status === 'error' && f.error ? '<span class="fi-meta err">' + escapeHtml(f.error) + '</span>' : '')
        + '</div>'
        + (f.status === 'done' ? '<span class="fi-ok" title="文本已提取">✓</span>' : '')
        + '<button type="button" class="fi-remove" data-idx="' + i + '" title="移除该附件">✕</button>'
        + '</div>';
    }).join('');
  }

  function initFiles(notesEditor) {
    $('selectFileBtn').addEventListener('click', () => $('fileInput').click());
    $('fileInput').addEventListener('change', async (e) => {
      const files = Array.from(e.target.files || []);
      if (!files.length) return;
      setLoading(true);
      // 逐个处理：先入清单（解析中状态行实时更新），完成后置绿勾；失败的留在清单中标红、不参与总结
      try {
        for (const f of files) {
          const entry = { name: f.name, size: f.size, content: '', isEmail: String(f.name).toLowerCase().endsWith('.eml'), status: 'extracting', stage: '解析中…', error: '' };
          loadedFiles.push(entry);
          renderAttachmentList();
          // 统一附件上限 150MB（三页共用 AiService.checkAttachment 校验）
          const tooBig = Ai.checkAttachment ? Ai.checkAttachment(f) : null;
          if (tooBig) {
            entry.status = 'error';
            entry.stage = '超过大小上限';
            entry.error = tooBig;
            renderAttachmentList();
            continue;
          }
          try {
            if (/\.pdf$/i.test(f.name)) {
              // PDF 经 pdf.js 提取文本（readAsText 会得到二进制乱码），预算内自动提前终止；
              // 大文件读取/解析进度写入清单状态行
              const buffer = await Ai.readAttachmentBuffer(f, (ld, total) => {
                if (f.size > 20 * 1024 * 1024) {
                  entry.stage = '读取中 ' + Math.round(ld / total * 100) + '%';
                  renderAttachmentList();
                }
              });
              entry.stage = '解析 PDF 页面…';
              renderAttachmentList();
              const content = await Ai.extractPdfText(buffer, (p, total) => {
                entry.stage = '解析第 ' + p + '/' + total + ' 页';
                renderAttachmentList();
              });
              if (!content.trim()) {
                entry.status = 'error';
                entry.stage = '未能提取文本';
                entry.error = '可能是扫描件/图片型 PDF，需先 OCR';
              } else {
                entry.content = content;
                entry.status = 'done';
                entry.stage = '文本已提取';
              }
            } else if (/\.(docx|xlsx|xlsm|pptx)$/i.test(f.name)) {
              // Office 文档（docx/xlsx/pptx）：JSZip 解包 + XML 规则提取，预算内自动截取首尾
              entry.stage = '解压解析中…';
              renderAttachmentList();
              const r = await Ai.extractOfficeText(f);
              entry.content = r.text;
              entry.status = 'done';
              entry.stage = '文本已提取' + (r.truncated ? '（超长已截取首尾）' : '');
            } else {
              // 文本类附件：≤10MB 全文提取；>10MB（≤150MB）自动截取首尾至预算
              const r = await Ai.readAttachmentText(f);
              entry.content = r.text;
              entry.status = 'done';
              entry.stage = '文本已提取' + (r.truncated ? '（超长已截取首尾）' : '');
            }
          } catch (err) {
            entry.status = 'error';
            entry.stage = '提取失败';
            entry.error = String((err && err.message) || err);
          }
          renderAttachmentList();
        }
        updateMode();
        const okCount = loadedFiles.filter((f) => f.status === 'done').length;
        const failed = loadedFiles.filter((f) => f.status === 'error').length;
        if (okCount > 0) showToast('已加载 ' + okCount + ' 个附件', 'success');
        if (failed > 0) showToast(failed + ' 个附件提取失败，将不参与总结（详见清单）', 'error');
      } catch (err) {
        showToast(Ai.describeApiError(err), 'error');
      } finally {
        setLoading(false);
        e.target.value = '';
      }
    });
    // 附件清单：单文件移除（事件委托）
    $('fileList').addEventListener('click', (e) => {
      const t = e.target;
      if (t && t.classList.contains('fi-remove')) {
        const idx = parseInt(t.getAttribute('data-idx'), 10);
        if (!isNaN(idx) && loadedFiles[idx]) {
          const removedName = loadedFiles[idx].name;
          loadedFiles.splice(idx, 1);
          renderAttachmentList();
          updateMode();
          showToast('已移除附件：' + removedName, 'info');
        }
      }
    });
    $('clearInputBtn').addEventListener('click', () => {
      notesEditor.clear();
      $('instructionsInput').value = '';
      state.draft = '';
      state.instructions = '';
      loadedFiles = [];
      $('fileInput').value = '';
      renderAttachmentList();
      updateMode();
      hideResults();
      saveNow();
      showToast('已清空', 'success');
    });
  }

  /* ==================== 结果渲染 ==================== */

  function hideResults() {
    $('taskListSection').style.display = 'none';
    $('summaryResult').style.display = 'none';
    $('summaryFooter').classList.remove('visible');
    resetWechatSection();
    hideError();
  }

  function renderTaskList(tasks) {
    const list = $('taskList');
    list.innerHTML = '';
    tasks.forEach((t, i) => {
      const pri = (t.priority || 'P2').toUpperCase();
      const card = document.createElement('div');
      card.className = 'task-card selected';
      const subSteps = (t.subSteps || []).map((s) =>
        '<div class="task-substep">' + escapeHtml(s) + '</div>').join('');
      const tags = (t.tags || []).map((tag) =>
        '<span class="task-tag">' + escapeHtml(tag) + '</span>').join('');
      card.innerHTML =
        '<input type="checkbox" class="task-check" data-i="' + i + '" checked>' +
        '<div class="task-card-body">' +
          '<div class="task-title">' + escapeHtml(t.title) + '</div>' +
          (t.description ? '<div class="task-desc">' + escapeHtml(t.description) + '</div>' : '') +
          '<div class="task-meta">' +
            '<span class="pri-chip ' + pri.toLowerCase() + '">' + pri + '</span>' +
            (tags ? '<div class="task-tags">' + tags + '</div>' : '') +
          '</div>' +
          (subSteps
            ? '<div class="task-substeps"><div class="task-substeps-title">子步骤</div>' + subSteps + '</div>'
            : '') +
        '</div>';
      card.querySelector('.task-check').addEventListener('change', () => {
        card.classList.toggle('selected', card.querySelector('.task-check').checked);
        updateCreateBtn();
      });
      list.appendChild(card);
    });
    updateCreateBtn();
  }

  function updateCreateBtn() {
    const selected = $('taskList').querySelectorAll('.task-check:checked').length;
    $('createTodosBtn').textContent = '创建任务 (' + selected + ')';
    $('createTodosBtn').disabled = selected === 0;
  }

  function showSummary(md, title) {
    $('taskListSection').style.display = 'none';
    $('summaryFooter').classList.add('visible');
    hideError();
    $('resultTitle').textContent = title;
    $('resultMeta').textContent = '';
    const el = $('summaryResult');
    el.style.display = 'block';
    el.classList.remove('md-fade-in');
    void el.offsetWidth; // 重启动画
    el.classList.add('md-fade-in');
    el.innerHTML = renderMarkdown(md);
    // mermaid 源码块渲染成图（思维导图/流程图等；库不可用时保持源码块）
    if (window.AiService && AiService.enhanceMermaid) AiService.enhanceMermaid(el);
    resetWechatSection();
  }

  /* ==================== 微信格式（纯文本，可直接粘贴发送） ==================== */

  function resetWechatSection() {
    const sec = $('wechatSection');
    const box = $('wechatResult');
    if (box) { box.textContent = ''; }
    if (sec) sec.style.display = 'none';
  }

  function convertToWechat() {
    if (!currentSummaryMd) { showToast('暂无分析结果可转换', 'error'); return; }
    const text = window.markdownToWechat ? window.markdownToWechat(currentSummaryMd) : '';
    if (!text) { showToast('暂无分析结果可转换', 'error'); return; }
    $('wechatResult').textContent = text;
    $('wechatSection').style.display = 'block';
    showToast('已生成微信格式，点击「复制」即可粘贴发送', 'success');
  }

  function copyWechat() {
    const box = $('wechatResult');
    const text = (box && box.textContent) || '';
    if (!text) { showToast('请先生成微信格式', 'error'); return; }
    navigator.clipboard.writeText(text).then(
      () => showToast('微信格式已复制到剪贴板', 'success'),
      () => showToast('复制失败', 'error')
    );
  }

  /* ==================== 主流程 ==================== */

  async function runParse(notes) {
    _busy = true;
    setLoading(true);
    $('runBtn').innerHTML = runBtnHtml('解析中...');
    try {
      const tasks = await Ai.parseNotes(notes, state.lang);
      currentTasks = tasks;
      if (!tasks.length) {
        hideResults();
        $('resultTitle').textContent = '解析结果';
        $('resultMeta').textContent = '';
        showToast('未从笔记中提取到任务', 'info');
        return;
      }
      $('summaryResult').style.display = 'none';
      $('summaryFooter').classList.remove('visible');
      $('resultTitle').textContent = '任务列表';
      $('resultMeta').textContent = '共提取 ' + tasks.length + ' 个任务';
      $('taskListSection').style.display = 'block';
      renderTaskList(tasks);
      pushHistory({ mode: 'parse', lang: state.lang, input: notes, tasks: tasks });
      showToast('已提取 ' + tasks.length + ' 个任务，可勾选后创建', 'success');
    } catch (err) {
      showError(err);
    } finally {
      _busy = false;
      setLoading(false);
      updateMode();
    }
  }

  async function runAnalyze(instructions, notes) {
    const parts = [];
    if (notes.trim()) parts.push('【笔记】\n' + notes);
    loadedFiles.filter((f) => f.status === 'done').forEach((f) => { parts.push('【附件：' + f.name + '】\n' + f.content); });
    const content = parts.join('\n\n———\n\n');
    const email = loadedFiles.some((f) => f.status === 'done' && f.isEmail) || Ai.looksLikeEmail(instructions + '\n' + notes);

    _busy = true;
    setLoading(true);
    $('runBtn').innerHTML = runBtnHtml('分析中...');
    try {
      const md = await Ai.analyzeContent({
        instructions, content, email, lang: state.lang,
        // 显式选择总结模板时传给 analyzeContent（auto = 默认结构 / 邮件 playbook）
        template: state.template !== 'auto' ? state.template : '',
      });
      currentSummaryMd = md;
      showSummary(md, email ? '邮件线程分析' : '分析结果');
      pushHistory({
        mode: 'analyze', lang: state.lang, email: email, tpl: state.template,
        input: (instructions ? instructions + '\n' : '') + notes, md: md,
      });
      showToast(email ? '邮件线程总结已生成' : '分析完成', 'success');
    } catch (err) {
      showError(err);
    } finally {
      _busy = false;
      setLoading(false);
      updateMode();
    }
  }

  function run() {
    if (_busy) return;
    hideError();
    if (isAnalyzeMode()) {
      const instructions = String($('instructionsInput').value || '').trim();
      const notes = notesEditor.getMarkdown();
      if (!instructions && !notes.trim() && !loadedFiles.some((f) => f.status === 'done')) {
        showToast('请先粘贴内容或填写解析要求', 'error');
        return;
      }
      runAnalyze(instructions, notes);
    } else {
      const notes = notesEditor.getMarkdown();
      if (!notes.trim()) {
        showToast('请先粘贴需要解析的笔记', 'error');
        return;
      }
      runParse(notes);
    }
  }

  /* ==================== 历史记录 ==================== */

  function formatTime(ts) {
    const d = new Date(ts);
    const p = (n) => String(n).padStart(2, '0');
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function pushHistory(entry) {
    entry.input = String(entry.input || '').slice(0, 5000);
    const firstLine = entry.input.split('\n').map((l) => l.trim()).find((l) => l.length > 0);
    entry.title = (firstLine || (entry.mode === 'parse' ? '任务抽取' : '分析总结')).slice(0, 60);
    entry.ts = Date.now();
    state.history.unshift(entry);
    if (state.history.length > HISTORY_LIMIT) state.history.length = HISTORY_LIMIT;
    saveNow();
    renderHistory();
  }

  function renderHistory() {
    const list = $('historyList');
    $('historyCount').textContent = state.history.length + ' 条';
    const selAllBox = $('historySelectAll');
    if (selAllBox) selAllBox.checked = false;
    if (!state.history.length) {
      list.innerHTML = '<div class="records-empty">暂无历史记录，解析 / 分析完成后自动保存，点击可恢复结果</div>';
      return;
    }
    list.innerHTML = state.history.map((h, i) => {
      const preview = h.mode === 'parse'
        ? (h.tasks || []).map((t) => t.title).join('；').slice(0, 90)
        : String(h.md || '').replace(/[#|>*`-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 90);
      const modeTag = h.mode === 'parse' ? '任务抽取' : (h.email ? '邮件分析' : '分析');
      const lang = Ai.getOutputLang(h.lang);
      const tpl = (h.tpl && h.tpl !== 'auto') ? Ai.getSummaryTemplate(h.tpl) : null;
      return '<div class="history-item" data-index="' + i + '">'
        + '<input type="checkbox" class="history-check" data-index="' + i + '" title="勾选后可导出选中项">'
        + '<div class="history-item-body">'
        + '<div class="hi-title">' + escapeHtml(h.title) + '</div>'
        + '<div class="hi-preview">' + escapeHtml(preview || '(空)') + '</div>'
        + '<div class="hi-meta">'
        + '<span class="hi-tag">' + modeTag + '</span>'
        + (tpl ? '<span class="hi-tag">' + escapeHtml(tpl.label) + '</span>' : '')
        + '<span class="hi-tag">' + escapeHtml(lang.label) + '</span>'
        + '<span>' + formatTime(h.ts) + '</span>'
        + '</div></div>'
        + '<div class="hi-actions">'
        + '<button class="hi-btn hi-delete" data-index="' + i + '" title="删除">'
        + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>'
        + '</button></div></div>';
    }).join('');
  }

  function restoreHistory(index) {
    const h = state.history[index];
    if (!h) return;
    hideError();
    if (h.mode === 'parse') {
      currentTasks = h.tasks || [];
      $('summaryResult').style.display = 'none';
      $('summaryFooter').classList.remove('visible');
      $('resultTitle').textContent = '任务列表';
      $('resultMeta').textContent = '历史记录 · ' + formatTime(h.ts);
      $('taskListSection').style.display = 'block';
      renderTaskList(currentTasks);
    } else {
      currentSummaryMd = h.md || '';
      showSummary(currentSummaryMd, h.email ? '邮件线程分析' : '分析结果');
      $('resultMeta').textContent = '历史记录 · ' + formatTime(h.ts);
    }
    showToast('已恢复历史记录', 'info');
  }

  function initHistory() {
    $('historyList').addEventListener('click', (e) => {
      if (e.target.closest('.history-check')) return; // 勾选不触发恢复
      const delBtn = e.target.closest('.hi-delete');
      if (delBtn) {
        e.stopPropagation();
        const idx = parseInt(delBtn.getAttribute('data-index'), 10);
        state.history.splice(idx, 1);
        saveNow();
        renderHistory();
        showToast('已删除该条记录', 'info');
        return;
      }
      const item = e.target.closest('.history-item');
      if (item) restoreHistory(parseInt(item.getAttribute('data-index'), 10));
    });
    $('clearHistoryBtn').addEventListener('click', () => {
      if (!state.history.length) return;
      if (!confirm('确定清空全部 ' + state.history.length + ' 条历史记录？此操作不可恢复。')) return;
      state.history = [];
      saveNow();
      renderHistory();
      showToast('已清空全部历史记录', 'info');
    });
    $('historySelectAll').addEventListener('change', function () {
      document.querySelectorAll('#historyList .history-check').forEach((c) => { c.checked = this.checked; });
    });
    $('exportHistoryMdBtn').addEventListener('click', () => exportSelectedHistory('md'));
    $('exportHistoryHtmlBtn').addEventListener('click', () => exportSelectedHistory('html'));
  }

  // ===== 历史记录：勾选后导出为 Markdown / HTML（v0.45.0） =====
  function taskListMarkdown(tasks) {
    let md = '| 优先级 | 任务 | 说明 | 标签 | 子步骤 |\n|---|---|---|---|---|\n';
    (tasks || []).forEach((t) => {
      const cell = (v) => String(v == null ? '' : v).replace(/\|/g, '\\|').replace(/\n+/g, ' ').trim();
      md += '| ' + cell((t.priority || 'P2').toUpperCase()) + ' | ' + cell(t.title) + ' | '
        + cell(t.description) + ' | ' + cell((t.tags || []).join('、')) + ' | '
        + cell((t.subSteps || []).join('；')) + ' |\n';
    });
    return md;
  }

  function historyItemMarkdown(h) {
    const lang = Ai.getOutputLang(h.lang);
    const head = [(h.mode === 'parse' ? '任务抽取' : (h.email ? '邮件分析' : '分析')), lang.label, formatTime(h.ts)]
      .filter(Boolean).join(' · ');
    let md = '## ' + head + '\n\n';
    if (h.input) md += '**输入**\n\n' + h.input + '\n\n';
    if (h.mode === 'parse') {
      md += '**任务列表**\n\n' + taskListMarkdown(h.tasks) + '\n';
    } else {
      md += (h.md || '') + '\n';
    }
    return md.trim();
  }

  async function exportSelectedHistory(format) {
    const indexes = Array.prototype.slice.call(document.querySelectorAll('#historyList .history-check:checked'))
      .map((c) => parseInt(c.getAttribute('data-index'), 10));
    const items = indexes.map((i) => state.history[i]).filter(Boolean);
    if (!items.length) { showToast('请先勾选要导出的历史记录', 'error'); return; }
    const md = items.map(historyItemMarkdown).join('\n\n---\n\n');
    const stamp = new Date().toISOString().slice(0, 10);
    if (format === 'html') {
      const html = Ai.mdToHtmlAsync ? await Ai.mdToHtmlAsync(md, 'AI 解析历史') : Ai.mdToHtml(md, 'AI 解析历史');
      Ai.downloadText('ai-toolbox-ai-parse-history-' + stamp + '.html', html, 'text/html;charset=utf-8');
    } else {
      Ai.downloadText('ai-toolbox-ai-parse-history-' + stamp + '.md', md, 'text/markdown;charset=utf-8');
    }
    showToast('已导出 ' + items.length + ' 条历史记录', 'success');
  }

  /* ==================== 语种选择 ==================== */

  function initLangSelect() {
    const sel = $('langSelect');
    sel.innerHTML = Ai.OUTPUT_LANGS.map((l) =>
      '<option value="' + l.code + '">' + escapeHtml(l.label) + '</option>').join('');
    sel.value = state.lang;
    sel.addEventListener('change', () => {
      state.lang = sel.value;
      saveNow();
    });
  }

  /* ==================== 总结模板选择（scenario-templates 25 套按场景分组，仅分析模式生效） ==================== */

  function initTemplateSelect() {
    const sel = $('templateSelect');
    if (!sel) return;
    const tpls = Ai.SUMMARY_TEMPLATES || [];
    const scenes = ['会议纪要', '日报周报', '任务提取', '邮件总结', '邮件撰写'];
    let html = '<option value="auto" title="默认结构（邮件附件自动走邮件线程 playbook）">默认（自动）</option>';
    scenes.forEach((sc) => {
      const group = tpls.filter((t) => t.scene === sc);
      if (!group.length) return;
      html += '<optgroup label="' + escapeHtml(sc) + '">'
        + group.map((t) =>
          '<option value="' + escapeHtml(t.id) + '" title="' + escapeHtml(t.hint || '') + '">' + escapeHtml(t.label) + '</option>').join('')
        + '</optgroup>';
    });
    sel.innerHTML = html;
    sel.value = state.template;
    sel.addEventListener('change', () => {
      state.template = sel.value;
      saveNow();
    });
  }

  /* ==================== 状态加载 ==================== */

  function loadPersistedState() {
    // 记录跨端实时同步（v0.25.0）：他端更新历史时刷新列表（不覆盖编辑中的草稿）
    if (typeof Ai.onRecordSync === 'function') {
      Ai.onRecordSync(STATE_KEY, function (saved) {
        if (saved && Array.isArray(saved.history) && JSON.stringify(saved.history) !== JSON.stringify(state.history)) {
          state.history = saved.history;
          renderHistory();
        }
      });
    }
    Ai.loadState(STATE_KEY).then((saved) => {
      if (saved && typeof saved === 'object') {
        if (typeof saved.draft === 'string') state.draft = saved.draft;
        if (typeof saved.instructions === 'string') state.instructions = saved.instructions;
        if (typeof saved.lang === 'string') state.lang = saved.lang;
        if (typeof saved.template === 'string') state.template = saved.template;
        if (Array.isArray(saved.history)) state.history = saved.history;
      }
      // 迁移旧版草稿键（ai_parse_draft），避免升级后内容丢失
      if (!state.draft) {
        let legacy = null;
        try { legacy = localStorage.getItem('ai_parse_draft'); } catch (e) {}
        if (legacy) state.draft = legacy;
      }
      if (!Ai.OUTPUT_LANGS.some((l) => l.code === state.lang)) state.lang = 'zh';
      if (state.template !== 'auto' && !Ai.getSummaryTemplate(state.template)) state.template = 'auto';
      notesEditor.setMarkdown(state.draft);
      $('instructionsInput').value = state.instructions;
      $('langSelect').value = state.lang;
      if ($('templateSelect')) $('templateSelect').value = state.template;
      updateMode();
      renderHistory();
    });
  }

  /* ==================== 按钮绑定 ==================== */

  function initActions() {
    $('runBtn').addEventListener('click', run);

    $('selectAllBtn').addEventListener('click', () => {
      document.querySelectorAll('.task-check').forEach((cb) => {
        cb.checked = true;
        if (cb.closest('.task-card')) cb.closest('.task-card').classList.add('selected');
      });
      updateCreateBtn();
    });
    $('deselectAllBtn').addEventListener('click', () => {
      document.querySelectorAll('.task-check').forEach((cb) => {
        cb.checked = false;
        if (cb.closest('.task-card')) cb.closest('.task-card').classList.remove('selected');
      });
      updateCreateBtn();
    });

    $('createTodosBtn').addEventListener('click', async () => {
      const selected = [];
      document.querySelectorAll('.task-check:checked').forEach((cb) => {
        const idx = Number(cb.getAttribute('data-i'));
        if (currentTasks[idx]) selected.push(currentTasks[idx]);
      });
      if (!selected.length) return;
      $('createTodosBtn').disabled = true;
      try {
        const added = await Ai.createTodos(selected);
        showToast('已创建 ' + added + ' 个任务到任务清单', 'success');
      } catch (err) {
        showToast(Ai.describeApiError(err), 'error');
      } finally {
        $('createTodosBtn').disabled = false;
      }
    });

    $('copySummaryBtn').addEventListener('click', async () => {
      if (!currentSummaryMd) return;
      try {
        await navigator.clipboard.writeText(currentSummaryMd);
        showToast('已复制到剪贴板', 'success');
      } catch (err) {
        const range = document.createRange();
        range.selectNodeContents($('summaryResult'));
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        document.execCommand('copy');
        sel.removeAllRanges();
        showToast('已复制到剪贴板', 'success');
      }
    });
    $('downloadMdBtn').addEventListener('click', () => {
      if (!currentSummaryMd) return;
      Ai.downloadText('ai-parse-' + stamp() + '.md', currentSummaryMd, 'text/markdown;charset=utf-8');
    });
    $('downloadHtmlBtn').addEventListener('click', async () => {
      if (!currentSummaryMd) return;
      // mdToHtmlAsync 额外把 mermaid 块（思维导图/流程图）内嵌打包库渲染成图
      const html = Ai.mdToHtmlAsync ? await Ai.mdToHtmlAsync(currentSummaryMd, 'AI 解析总结') : Ai.mdToHtml(currentSummaryMd, 'AI 解析总结');
      Ai.downloadText('ai-parse-' + stamp() + '.html', html, 'text/html;charset=utf-8');
    });
    $('wechatFormatBtn').addEventListener('click', convertToWechat);
    $('copyWechatBtn').addEventListener('click', copyWechat);

    $('instructionsInput').addEventListener('input', () => {
      state.instructions = String($('instructionsInput').value || '');
      scheduleSave();
      updateMode();
    });

    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        run();
      }
    });
  }

  /* ==================== 启动 ==================== */

  let notesEditor;
  function init() {
    notesEditor = initEditor();
    initSettings();
    initFiles(notesEditor);
    initActions();
    initLangSelect();
    initTemplateSelect();
    initHistory();
    loadPersistedState();
    updateMode();
    updateCreateBtn();
  }

  init();
})();
