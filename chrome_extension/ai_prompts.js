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
      initialMarkdown: localStorage.getItem('ai_prompts_draft') || '',
      placeholder: '在这里输入粗糙需求，例如：\n"做一个 Chrome 插件，把选中文本翻译成中文并弹出结果，要求简洁准确，支持 20 种语言。"',
      onInput: () => {
        if (_mdPreviewOpen) $('mdPreviewContent').innerHTML = renderMarkdown(reqEditor.getMarkdown());
        try { localStorage.setItem('ai_prompts_draft', reqEditor.getMarkdown()); } catch (e) {}
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

  /* ==================== 按钮绑定 ==================== */

  function initActions() {
    $('runBtn').addEventListener('click', run);

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
  }

  init();
})();
