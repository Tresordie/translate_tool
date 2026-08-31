/**
 * ai_prompts.js — AI 提示词（AI Prompts）页面逻辑
 *
 * 粗糙需求 → generatePrompt() → 专家级提示词（Markdown，含「### 📋 提示词」代码块 / 假设区 / 使用建议）
 * 「复制提示词正文」用 extractPromptBody() 提取首个围栏代码块；「复制全部」复制整段 AI 输出。
 *
 * 依赖: markdown.js, md-editor.js, ai-service.js
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const Ai = window.AiService;

  let config = Ai.getConfig();
  let currentResultMd = '';     // 最近一次 AI 输出的 Markdown 原文
  let _busy = false;
  let _mdPreviewOpen = false;

  /* ==================== 状态持久化（Web: localStorage / 扩展: chrome.storage.local） ==================== */

  const STATE_KEY = 'ai_prompts_state';
  const HISTORY_LIMIT = 30;
  const state = { draft: '', history: [] };

  let saveTimer = null;
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 500);
  }
  function saveNow() {
    clearTimeout(saveTimer);
    Ai.saveState(STATE_KEY, state);
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
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
    const reqEditor = MdEditor.create($('reqInput'), {
      initialMarkdown: '',
      placeholder: '在这里输入粗糙需求，例如：\n"做一个 Chrome 插件，把选中文本翻译成中文并弹出结果，要求简洁准确，支持 20 种语言。"',
      onInput: () => {
        state.draft = reqEditor.getMarkdown();
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
        $('mdPreviewContent').innerHTML = renderMarkdown(reqEditor.getMarkdown());
      } else {
        panel.style.display = 'none';
        btn.classList.remove('active');
      }
    };
    $('previewCloseBtn').addEventListener('click', () => {
      if (_mdPreviewOpen) window.toggleMdPreview();
    });

    return reqEditor;
  }

  /* ==================== 结果渲染 ==================== */

  function showResult(md) {
    currentResultMd = md;
    hideError();
    const el = $('resultContent');
    el.style.display = 'block';
    el.classList.remove('md-fade-in');
    void el.offsetWidth; // 重启动画
    el.classList.add('md-fade-in');
    el.innerHTML = renderMarkdown(md);
    $('resultMeta').textContent = '已生成';
    $('resultFooter').classList.add('visible');
  }

  /* ==================== 主流程 ==================== */

  async function run() {
    if (_busy) return;
    hideError();
    const requirement = reqEditor.getMarkdown();
    if (!requirement.trim()) {
      showToast('请先输入粗糙需求', 'error');
      return;
    }
    _busy = true;
    setLoading(true);
    $('runBtn').innerHTML = runBtnHtml('生成中...');
    try {
      const md = await Ai.generatePrompt(requirement);
      showResult(md);
      pushHistory({ requirement: requirement, md: md });
      showToast('提示词已生成', 'success');
    } catch (err) {
      showError(err);
    } finally {
      _busy = false;
      setLoading(false);
      $('runBtn').innerHTML = runBtnHtml('生成提示词');
    }
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (err) {
      return false;
    }
  }

  /* ==================== 历史记录 ==================== */

  function formatTime(ts) {
    const d = new Date(ts);
    const p = (n) => String(n).padStart(2, '0');
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function pushHistory(entry) {
    entry.requirement = String(entry.requirement || '').slice(0, 5000);
    const firstLine = entry.requirement.split('\n').map((l) => l.trim()).find((l) => l.length > 0);
    entry.title = (firstLine || '提示词生成').slice(0, 60);
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
      list.innerHTML = '<div class="records-empty">暂无历史记录，生成提示词后自动保存，点击可恢复结果</div>';
      return;
    }
    list.innerHTML = state.history.map((h, i) => {
      const preview = String(h.md || '').replace(/[#|>*`-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 90);
      return '<div class="history-item" data-index="' + i + '">'
        + '<div class="history-item-body">'
        + '<div class="hi-title">' + escapeHtml(h.title) + '</div>'
        + '<div class="hi-preview">' + escapeHtml(preview || '(空)') + '</div>'
        + '<div class="hi-meta">'
        + '<span class="hi-tag">提示词</span>'
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
    showResult(h.md || '');
    $('resultMeta').textContent = '历史记录 · ' + formatTime(h.ts);
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

  /* ==================== 状态加载 ==================== */

  function loadPersistedState() {
    Ai.loadState(STATE_KEY).then((saved) => {
      if (saved && typeof saved === 'object') {
        if (typeof saved.draft === 'string') state.draft = saved.draft;
        if (Array.isArray(saved.history)) state.history = saved.history;
      }
      // 迁移旧版草稿键（ai_prompts_draft），避免升级后内容丢失
      if (!state.draft) {
        let legacy = null;
        try { legacy = localStorage.getItem('ai_prompts_draft'); } catch (e) {}
        if (legacy) state.draft = legacy;
      }
      reqEditor.setMarkdown(state.draft);
      renderHistory();
    });
  }

  /* ==================== 按钮绑定 ==================== */

  function initActions() {
    $('runBtn').addEventListener('click', run);

    $('clearReqBtn').addEventListener('click', () => {
      reqEditor.clear();
      state.draft = '';
      if (_mdPreviewOpen) $('mdPreviewContent').innerHTML = '';
      saveNow();
      showToast('已清空输入', 'success');
    });

    $('copyPromptBtn').addEventListener('click', async () => {
      if (!currentResultMd) return;
      const body = Ai.extractPromptBody(currentResultMd);
      const ok = await copyText(body);
      showToast(ok ? '提示词正文已复制' : '复制失败，请手动选择', ok ? 'success' : 'error');
    });

    $('copyAllBtn').addEventListener('click', async () => {
      if (!currentResultMd) return;
      const ok = await copyText(currentResultMd);
      showToast(ok ? '全部内容已复制' : '复制失败，请手动选择', ok ? 'success' : 'error');
    });

    $('downloadMdBtn').addEventListener('click', () => {
      if (!currentResultMd) return;
      Ai.downloadText('ai-prompt-' + stamp() + '.md', currentResultMd, 'text/markdown;charset=utf-8');
    });
    $('downloadHtmlBtn').addEventListener('click', () => {
      if (!currentResultMd) return;
      Ai.downloadText('ai-prompt-' + stamp() + '.html', Ai.mdToHtml(currentResultMd, 'AI 提示词'), 'text/html;charset=utf-8');
    });

    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        run();
      }
    });
  }

  /* ==================== 启动 ==================== */

  let reqEditor;
  function init() {
    reqEditor = initEditor();
    initSettings();
    initActions();
    initHistory();
    loadPersistedState();
  }

  init();
})();
