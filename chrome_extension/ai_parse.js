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

  let config = Ai.getConfig();
  let loadedFiles = [];          // [{ name, content, isEmail }]
  let currentTasks = [];         // parse 模式当前任务列表
  let currentSummaryMd = '';     // analyze 模式当前 Markdown 原文
  let _busy = false;
  let _mdPreviewOpen = false;

  /* ==================== 状态持久化（Web: localStorage / 扩展: chrome.storage.local） ==================== */

  const STATE_KEY = 'ai_parse_state';
  const HISTORY_LIMIT = 30;
  const state = { draft: '', instructions: '', lang: 'zh', history: [] };

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
    return !!(String($('instructionsInput').value || '').trim() || loadedFiles.length);
  }

  function updateMode() {
    const analyze = isAnalyzeMode();
    $('modeHint').innerHTML = analyze
      ? '当前模式：<strong>分析</strong>（有解析要求或附件，输出自由格式 Markdown 总结）'
      : '当前模式：<strong>任务抽取</strong>（从笔记中提取结构化任务列表）';
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

  function updateFileNameTag() {
    const tag = $('fileNameTag');
    const text = $('fileNameText');
    if (!loadedFiles.length) {
      tag.classList.remove('visible');
      text.textContent = '';
      return;
    }
    tag.classList.add('visible');
    text.textContent = loadedFiles.map((f) => f.name).join('，');
  }

  function initFiles(notesEditor) {
    $('selectFileBtn').addEventListener('click', () => $('fileInput').click());
    $('fileInput').addEventListener('change', async (e) => {
      const files = Array.from(e.target.files || []);
      if (!files.length) return;
      setLoading(true);
      try {
        for (const f of files) {
          const content = await Ai.readTextFile(f);
          loadedFiles.push({
            name: f.name,
            content: content,
            isEmail: String(f.name).toLowerCase().endsWith('.eml'),
          });
        }
        updateFileNameTag();
        updateMode();
        showToast('已加载 ' + files.length + ' 个附件', 'success');
      } catch (err) {
        showToast(Ai.describeApiError(err), 'error');
      } finally {
        setLoading(false);
        e.target.value = '';
      }
    });
    $('fileClearBtn').addEventListener('click', () => {
      loadedFiles = [];
      $('fileInput').value = '';
      updateFileNameTag();
      updateMode();
    });
    $('clearInputBtn').addEventListener('click', () => {
      notesEditor.clear();
      $('instructionsInput').value = '';
      state.draft = '';
      state.instructions = '';
      loadedFiles = [];
      $('fileInput').value = '';
      updateFileNameTag();
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
    loadedFiles.forEach((f) => { parts.push('【附件：' + f.name + '】\n' + f.content); });
    const content = parts.join('\n\n———\n\n');
    const email = loadedFiles.some((f) => f.isEmail) || Ai.looksLikeEmail(instructions + '\n' + notes);

    _busy = true;
    setLoading(true);
    $('runBtn').innerHTML = runBtnHtml('分析中...');
    try {
      const md = await Ai.analyzeContent({ instructions, content, email, lang: state.lang });
      currentSummaryMd = md;
      showSummary(md, email ? '邮件线程分析' : '分析结果');
      pushHistory({
        mode: 'analyze', lang: state.lang, email: email,
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
      if (!instructions && !notes.trim() && !loadedFiles.length) {
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
      return '<div class="history-item" data-index="' + i + '">'
        + '<div class="history-item-body">'
        + '<div class="hi-title">' + escapeHtml(h.title) + '</div>'
        + '<div class="hi-preview">' + escapeHtml(preview || '(空)') + '</div>'
        + '<div class="hi-meta">'
        + '<span class="hi-tag">' + modeTag + '</span>'
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
        if (Array.isArray(saved.history)) state.history = saved.history;
      }
      // 迁移旧版草稿键（ai_parse_draft），避免升级后内容丢失
      if (!state.draft) {
        let legacy = null;
        try { legacy = localStorage.getItem('ai_parse_draft'); } catch (e) {}
        if (legacy) state.draft = legacy;
      }
      if (!Ai.OUTPUT_LANGS.some((l) => l.code === state.lang)) state.lang = 'zh';
      notesEditor.setMarkdown(state.draft);
      $('instructionsInput').value = state.instructions;
      $('langSelect').value = state.lang;
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
    $('downloadHtmlBtn').addEventListener('click', () => {
      if (!currentSummaryMd) return;
      Ai.downloadText('ai-parse-' + stamp() + '.html', Ai.mdToHtml(currentSummaryMd, 'AI 解析总结'), 'text/html;charset=utf-8');
    });

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
    initHistory();
    loadPersistedState();
    updateMode();
    updateCreateBtn();
  }

  init();
})();
