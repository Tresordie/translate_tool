/**
 * LinguaFlow · 邮件总结
 * v0.53.0 对齐 voice_transcription：默认自由总结 + G-SPEC 输出契约（AiService.summarizeContent），
 * 选中模板走 scenario-templates 共享模板；超长输入自动 map-reduce 分块通读，不再首尾截断。
 * 功能：粘贴邮件 / 选择本地文件 → AI 总结 → 显示 + HTML/MD 下载 + 历史保存（可查阅/编辑）
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  // Google Fonts 异步启用：MV3 CSP 禁止 inline onload，改由 JS 在字体样式表加载完成后切换 media
  const gfAsyncLink = document.getElementById('gfAsync');
  if (gfAsyncLink) gfAsyncLink.addEventListener('load', function () { gfAsyncLink.media = 'all'; });

  /* ==================== 系统提示词 ==================== */
  // v0.53.0 对齐 voice_transcription：旧邮件 SKILL 四段式 / DOC 文档规范已移除——
  // 默认与模板路径统一走 AiService.summarizeContent（freeSummaryPrompt / summaryTemplatePrompt
  // + G-SPEC 输出契约 + 通读优先 + 语言指令置末尾），超长输入自动 map-reduce 分块通读。

  // v0.53.0：仅历史记录展示用；下拉选项与提示词语言名统一走 AiService.OUTPUT_LANGS
  const LANG_NAMES = {
    auto: '跟随原文',
    zh: '中文', en: 'English', ja: '日本語', ko: '한국어',
    fr: 'Français', de: 'Deutsch', es: 'Español', pt: 'Português',
    ru: 'Русский', ar: 'العربية', it: 'Italiano', nl: 'Nederlands',
    th: 'ไทย', vi: 'Tiếng Việt', id: 'Indonesia', ms: 'Melayu',
    tr: 'Türkçe', pl: 'Polski', sv: 'Svenska', da: 'Dansk',
    fi: 'Suomi', el: 'Ελληνικά', cs: 'Čeština', ro: 'Română',
    hu: 'Magyar', uk: 'Українська', hi: 'हिन्दी', bn: 'বাংলা',
    he: 'עברית', fa: 'فارسی',
  };

  /* ==================== State ==================== */
  // 容错解析：localStorage 历史脏数据（如曾被写成 "[object Object]"）不再炸掉整个模块
  function safeParse(raw, fallback) {
    if (raw === null || raw === undefined) return fallback;
    try { const v = JSON.parse(raw); return v; } catch (e) { return fallback; }
  }
  let config = safeParse(localStorage.getItem('email_summary_config'), null) || {};
  let history = safeParse(localStorage.getItem('email_summary_history'), []);
  if (!Array.isArray(history)) history = [];

  // 记录反向同步（v0.25.0）：localStorage 写入 → chrome.storage（扩展侧同步，映射表见 background.js）
  function relayRecord(key, value) {
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) {
        chrome.runtime.sendMessage({ action: 'linguaflow:saveRecord', key: key, value: value }, function () {});
      } else {
        (window.top || window).postMessage({ source: 'linguaflow-page', type: 'save-record', key: key, value: value }, '*');
      }
    } catch (e) {}
  }
  let editingIndex = -1;
  let loadedFiles = [];      // [{ name, content }] 附件清单：内容不进输入框（v0.52.0 交互调整），仅列表展示，随总结请求发送
  function loadedFileNames() { return loadedFiles.filter((f) => f.status === 'done').map((f) => f.name).join('，'); }

  /* ==================== Markdown Editor ==================== */
  const emailEditor = MdEditor.create($('emailInput'), {
    placeholder: '在此粘贴邮件线程内容（支持 Markdown）...\n\n例如：From: xxx@company.com\nSubject: ...\n...\n或点击「选择本地文件」读取邮件文件',
    onInput: () => saveDraft(),
  });

  /* ==================== Toast ==================== */
  let toastTimer = null;
  function showToast(msg, type) {
    const t = $('toast');
    t.textContent = msg;
    t.className = 'toast show ' + (type || 'info');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.className = 'toast'; }, 2600);
  }

  /* ==================== Settings ==================== */
  // 兼容：无专属配置时回退读取智能翻译的配置
  if (!config.baseUrl) {
    try {
      const tc = JSON.parse(localStorage.getItem('translate_config') || 'null');
      if (tc && tc.baseUrl) config = { baseUrl: tc.baseUrl, apiKey: tc.apiKey, model: tc.model, template: config.template, instruction: config.instruction, lang: config.lang };
    } catch (e) { /* ignore */ }
  }
  if (config.baseUrl) $('baseUrl').value = config.baseUrl;
  if (config.apiKey) $('apiKey').value = config.apiKey;
  if (config.model) $('modelName').value = config.model;
  if (!config.apiKey) $('settingsPanel').classList.add('open');

  /* ==================== 插件配置同步（LinguaFlow 扩展广播） ==================== */
  function applySyncedConfig(cfg) {
    if (!cfg || !cfg.baseUrl) return;
    // 只同步连接信息，保留用户在本页选定的总结模板与解析要求
    config = { baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, model: cfg.model, template: config.template, instruction: config.instruction, lang: config.lang };
    if (cfg.baseUrl) $('baseUrl').value = cfg.baseUrl;
    if (cfg.apiKey) $('apiKey').value = cfg.apiKey;
    if (cfg.model) $('modelName').value = cfg.model;
    $('settingsPanel').classList.remove('open');
    showToast('已同步插件配置（Base URL / API Key / Model）', 'success');
  }
  // 网页环境：content script 通过 postMessage 广播
  window.addEventListener('message', (e) => {
    const d = e.data;
    if (d && d.source === 'linguaflow-extension' && d.config) applySyncedConfig(d.config);
  });
  // 扩展环境：直接监听 chrome.storage，并读取已有配置兑底
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if ((area === 'local' || (area && area.areaName === 'local')) && changes.config && changes.config.newValue) {
        applySyncedConfig(changes.config.newValue);
      }
    });
    chrome.storage.local.get(['config'], ({ config: xcfg }) => {
      if (xcfg && xcfg.baseUrl) applySyncedConfig(xcfg);
    });
  }

  $('toggleSettings').addEventListener('click', () => $('settingsPanel').classList.toggle('open'));

  $('saveSettingsBtn').addEventListener('click', () => {
    config.baseUrl = $('baseUrl').value.trim().replace(/\/+$/, '');
    config.apiKey = $('apiKey').value.trim();
    config.model = $('modelName').value.trim();
    localStorage.setItem('email_summary_config', JSON.stringify(config));
    relayRecord('email_summary_config', config);
    showToast('配置已保存', 'success');
    $('settingsPanel').classList.remove('open');
  });

  // ===== 解析要求字段升级（v0.52.1）：单行 input → 自动增高 textarea + ⤢ 大编辑器弹窗 =====
  // 长要求可整体查看/修改：输入时按内容自动增高（上限 220px 后内部滚动）；点 ⤢ 打开大编辑器弹窗，
  // 保存写回原字段并派发 change 复用既有持久化；Esc / 取消 / 点遮罩关闭不保存；Ctrl+Enter 快捷保存。
  function autoGrowInstruction() {
    var el = document.getElementById('summaryInstruction');
    if (!el) return;
    var cs = window.getComputedStyle(el);
    var border = (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0);
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight + border, 220) + 'px';
  }
  function initInstructionModal() {
    var el = document.getElementById('summaryInstruction');
    var overlay = document.getElementById('instrModalOverlay');
    var modalText = document.getElementById('instrModalText');
    var expandBtn = document.getElementById('instrExpandBtn');
    var cancelBtn = document.getElementById('instrModalCancel');
    var saveBtn = document.getElementById('instrModalSave');
    if (!el || !overlay || !modalText || !expandBtn || !cancelBtn || !saveBtn) return;
    el.addEventListener('input', autoGrowInstruction);
    autoGrowInstruction();
    function openModal() {
      modalText.value = el.value;
      overlay.classList.add('open');
      modalText.focus();
      modalText.setSelectionRange(modalText.value.length, modalText.value.length);
    }
    function closeModal() { overlay.classList.remove('open'); }
    function saveModal() {
      el.value = modalText.value;
      closeModal();
      autoGrowInstruction();
      el.dispatchEvent(new Event('change')); // 复用既有 change 持久化（work_config.summaryInstruction / email_summary_config.instruction）
    }
    // 输入框邻侧按钮防抢焦点（项目约定：mousedown preventDefault，保住输入法未上屏内容）
    expandBtn.addEventListener('mousedown', function(e) { e.preventDefault(); });
    expandBtn.addEventListener('click', openModal);
    cancelBtn.addEventListener('click', closeModal);
    saveBtn.addEventListener('click', saveModal);
    overlay.addEventListener('mousedown', function(e) { if (e.target === overlay) closeModal(); });
    modalText.addEventListener('keydown', function(e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); saveModal(); }
    });
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && overlay.classList.contains('open')) closeModal();
    });
  }
  // ===== 解析要求字段升级（结束） =====

  /* ==================== 总结模板选择（scenario-templates 25 套按场景分组；默认=自由总结 + G-SPEC 契约） ==================== */
  function initTemplateSelect() {
    const sel = $('emailTemplate');
    if (!sel) return;
    const tpls = (window.AiService && AiService.SUMMARY_TEMPLATES) || [];
    const scenes = ['会议纪要', '日报周报', '任务提取', '邮件总结', '邮件撰写'];
    let html = '<option value="default" title="自由总结 + G-SPEC 输出契约（对齐 voice_transcription）">默认（自由总结）</option>';
    scenes.forEach((sc) => {
      const group = tpls.filter((t) => t.scene === sc);
      if (!group.length) return;
      html += '<optgroup label="' + escapeHtml(sc) + '">';
      group.forEach((t) => {
        html += '<option value="' + escapeHtml(t.id) + '" title="' + escapeHtml(t.hint || '') + '">' + escapeHtml(t.label) + '</option>';
      });
      html += '</optgroup>';
    });
    sel.innerHTML = html;
    // 旧选择（已下线的模板 id）找不到对应 option 时回落 default
    sel.value = (config.template && sel.querySelector('option[value="' + config.template + '"]')) ? config.template : 'default';
    sel.addEventListener('change', () => {
      config.template = sel.value;
      localStorage.setItem('email_summary_config', JSON.stringify(config));
      relayRecord('email_summary_config', config);
    });

    // 解析要求输入框（v0.52.0）：随内容发给 AI，与模板结构并行生效；持久化到 email_summary_config.instruction
    const instrInput = $('summaryInstruction');
    if (instrInput) {
      instrInput.value = config.instruction || '';
      instrInput.addEventListener('change', () => {
        config.instruction = instrInput.value.trim();
        localStorage.setItem('email_summary_config', JSON.stringify(config));
        relayRecord('email_summary_config', config);
      });
      // 解析要求字段升级（v0.52.1）：自动增高 + ⤢ 大编辑器弹窗
      initInstructionModal();
    }
  }

  /* ==================== 输出语言下拉（v0.53.0：AiService.OUTPUT_LANGS 统一渲染 + 持久化） ==================== */
  // 旧版保存的表外语种码（nl/tr 等）回退 auto（跟随原文）
  function normOutputLang(v) {
    var langs = (window.AiService && AiService.OUTPUT_LANGS) || [];
    return langs.some(function (l) { return l.code === v; }) ? v : 'auto';
  }
  function initLangSelect() {
    var sel = $('outputLang');
    if (!sel || !window.AiService || !AiService.OUTPUT_LANGS) return;
    sel.innerHTML = AiService.OUTPUT_LANGS.map(function (l) {
      return '<option value="' + l.code + '">' + escapeHtml(l.label) + '</option>';
    }).join('');
    sel.value = normOutputLang(config.lang);
    sel.addEventListener('change', function () {
      config.lang = sel.value;
      localStorage.setItem('email_summary_config', JSON.stringify(config));
      relayRecord('email_summary_config', config);
    });
  }

  /* ==================== Draft ==================== */
  let draftTimer = null;
  function saveDraft() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => {
      const __draft = emailEditor.getMarkdown();
      localStorage.setItem('email_summary_draft', __draft);
      relayRecord('email_summary_draft', __draft); // v0.44.0 草稿纳入双向同步
    }, 500);
  }
  const draft = localStorage.getItem('email_summary_draft');
  if (draft) emailEditor.setMarkdown(draft);

  /* ==================== Markdown 预览（theme.js 通过 window.toggleMdPreview 绑定按钮） ==================== */
  let _mdPreviewOpen = false;
  window.toggleMdPreview = function () {
    _mdPreviewOpen = !_mdPreviewOpen;
    const panel = $('mdPreviewPanel');
    const btn = $('previewToggleBtn');
    if (_mdPreviewOpen) {
      panel.style.display = 'block';
      btn.classList.add('active');
      $('mdPreviewContent').innerHTML = renderMarkdown(emailEditor.getMarkdown());
    } else {
      panel.style.display = 'none';
      btn.classList.remove('active');
    }
  };
  emailEditor.container.addEventListener('input', () => {
    if (_mdPreviewOpen) $('mdPreviewContent').innerHTML = renderMarkdown(emailEditor.getMarkdown());
  });

  /* ==================== 文件选择 ==================== */
  // pdf.js worker 本地加载（扩展 MV3 CSP 不允许远程脚本，须打包在目录内）
  if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'pdf.worker.min.js';
  }

  $('selectFileBtn').addEventListener('click', () => $('fileInput').click());

  $('fileInput').addEventListener('change', async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    // 逐个处理：先入清单（解析中状态行实时更新），完成后置绿勾；失败的留在清单中标红、不参与总结
    for (const file of files) {
      const entry = { name: file.name, size: file.size, content: '', status: 'extracting', stage: '解析中…', error: '' };
      loadedFiles.push(entry);
      renderAttachmentList();
      // 统一附件上限 150MB（三页共用 AiService.checkAttachment 校验）
      const tooBig = AiService.checkAttachment ? AiService.checkAttachment(file) : null;
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
          const buf = await AiService.readAttachmentBuffer(file, (ld, total) => {
            if (file.size > 20 * 1024 * 1024) {
              entry.stage = '读取中 ' + Math.round(ld / total * 100) + '%';
              renderAttachmentList();
            }
          });
          entry.stage = '解析 PDF 页面…';
          renderAttachmentList();
          const text = await AiService.extractPdfText(buf, (p, total) => {
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
          const r = await AiService.extractOfficeText(file);
          entry.content = r.text;
          entry.status = 'done';
          entry.stage = '文本已提取' + (r.truncated ? '（超长已截取首尾）' : '');
        } else {
          // 文本类附件：≤10MB 全文提取；>10MB（≤150MB）自动截取首尾至预算
          const r = await AiService.readAttachmentText(file);
          entry.content = r.text;
          // .eml 简易处理：保留头部元信息与正文
          if (/\.eml$/i.test(file.name)) entry.content = normalizeEml(entry.content);
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
    e.target.value = '';
    const okCount = loadedFiles.filter((f) => f.status === 'done').length;
    const failed = loadedFiles.filter((f) => f.status === 'error').length;
    if (okCount > 0) showToast('已加载 ' + okCount + ' 个附件', 'success');
    if (failed > 0) showToast(failed + ' 个附件提取失败，将不参与总结（详见清单）', 'error');
  });

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
        + '<span class="fi-meta ' + metaCls + '">' + escapeHtml((AiService.formatBytes ? AiService.formatBytes(f.size) : '') + ' · ' + (f.stage || '')) + '</span>'
        + (f.status === 'error' && f.error ? '<span class="fi-meta err">' + escapeHtml(f.error) + '</span>' : '')
        + '</div>'
        + (f.status === 'done' ? '<span class="fi-ok" title="文本已提取">✓</span>' : '')
        + '<button type="button" class="fi-remove" data-idx="' + i + '" title="移除该附件">✕</button>'
        + '</div>';
    }).join('');
  }

  // 全文 = 已提取完成的附件内容（带「===== 附件 N：文件名 =====」分界，供 AI 区分来源）+ 输入框正文
  function buildFullText() {
    const parts = [];
    loadedFiles.filter((f) => f.status === 'done').forEach((f, i) => {
      parts.push('===== 附件 ' + (i + 1) + '：' + f.name + ' =====\n' + f.content);
    });
    const editorText = emailEditor.getMarkdown().trim();
    if (editorText) parts.push(editorText);
    return parts.join('\n\n———\n\n');
  }

  // PDF 文本提取走 AiService.extractPdfText（三页共用：逐页分行、500 页/12 万字符预算自动提前终止）；
  // 超长输入由 AiService.summarizeContent 自动 map-reduce 分块通读（v0.53.0，不再首尾截断）。

  // 附件清单：单文件移除（事件委托）
  $('fileList').addEventListener('click', (e) => {
    const t = e.target;
    if (t && t.classList.contains('fi-remove')) {
      const idx = parseInt(t.getAttribute('data-idx'), 10);
      if (!isNaN(idx) && loadedFiles[idx]) {
        const removedName = loadedFiles[idx].name;
        loadedFiles.splice(idx, 1);
        renderAttachmentList();
        showToast('已移除附件：' + removedName, 'info');
      }
    }
  });

  $('clearInputBtn').addEventListener('click', () => {
    emailEditor.clear();
    localStorage.removeItem('email_summary_draft');
    loadedFiles = [];
    renderAttachmentList();
    showToast('输入已清空', 'info');
  });

  // .eml 轻量归一化：去掉 base64/编码噪音，保留 From/To/Subject/Date 与正文
  function normalizeEml(raw) {
    const lines = raw.split(/\r?\n/);
    const keepHeaders = [];
    let i = 0;
    for (; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim() === '') break;
      if (/^(From|To|Cc|Subject|Date):/i.test(line)) keepHeaders.push(line.trim());
    }
    // 跳过 MIME 边界/编码头，找到第一处空行后的正文段
    let body = lines.slice(i).join('\n');
    body = body
      .replace(/^--[-A-Za-z0-9_=/.]+\s*$/gm, '')
      .replace(/^Content-[A-Za-z-]+:.*$/gim, '')
      .replace(/^[A-Za-z0-9+/=]{60,}\s*$/gm, '');
    return (keepHeaders.length ? keepHeaders.join('\n') + '\n\n' : '') + body.trim();
  }

  /* ==================== 超长内容处理 ==================== */
  // v0.53.0 对齐 voice_transcription：不再首尾截断（旧 60000 字符 autoTruncate 已移除）——
  // AiService.summarizeContent 对 >12000 字符自动 map-reduce（8000/块、并发 2、上限 120 块），
  // 逐块提取要点后整体总结，全文通读不丢中间内容。

  /* ==================== AI 总结 ==================== */
  $('summarizeBtn').addEventListener('click', summarize);
  // 流式生成取消（v0.25.5）
  let currentAbortCtrl = null;
  $('cancelSummaryBtn').addEventListener('click', () => {
    if (currentAbortCtrl) { try { currentAbortCtrl.abort(); } catch (e) { /* ignore */ } }
  });

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && editingIndex < 0) summarize();
  });

  async function summarize() {
    const fullText = buildFullText();
    if (!fullText) {
      showToast('请先粘贴邮件内容或选择本地文件', 'error');
      return;
    }
    if (!config.baseUrl || !config.apiKey || !config.model) {
      showToast('请先配置 API 设置', 'error');
      $('settingsPanel').classList.add('open');
      return;
    }

    const lang = normOutputLang($('outputLang').value);
    // 总结模板：默认=自由总结 + G-SPEC 契约；其余取 scenario-templates 共享模板
    const tplId = ($('emailTemplate') && $('emailTemplate').value) || 'default';
    // 解析要求（可选）：注入 system【用户额外要求】，与模板结构并行生效
    const instruction = (($('summaryInstruction') || {}).value || '').trim();

    const _as = window.AiService || {};
    if (!_as.summarizeContent) {
      showToast('AI 服务未加载，请刷新页面后重试', 'error');
      return;
    }
    setLoading(true);
    const startedAt = Date.now();

    // 一次性输出（v0.25.6）：非流式请求，等待完整结果后整体上屏；等待期间显示阶段进度与耗时。
    let metaTimer = setInterval(function () {
      $('summaryMeta').textContent = '生成中… 已用时 ' + Math.round((Date.now() - startedAt) / 1000) + 's';
    }, 1000);

    // 取消：AbortController 透传 summarizeContent → chat/proxyFetch（直连通道可取消；桥接通道不响应 signal）
    const ctrl = new AbortController();
    currentAbortCtrl = ctrl;

    try {
      // v0.53.0 对齐 voice_transcription：默认 freeSummaryPrompt（G-SPEC），模板路径 summaryTemplatePrompt；
      // 超长输入自动 map-reduce；通读优先/语言指令/temperature 自适应与去参重试由 AiService 统一处理
      const result = await _as.summarizeContent({
        content: fullText,
        template: tplId !== 'default' ? tplId : '',
        userPrompt: instruction,
        lang: lang,
        config: { baseUrl: config.baseUrl, apiKey: config.apiKey, model: config.model },
        signal: ctrl.signal,
        onProgress: function (stage, done, total) {
          var elapsed = Math.round((Date.now() - startedAt) / 1000);
          $('summaryMeta').textContent = total > 0
            ? '理解全文 ' + done + '/' + total + ' … 已用时 ' + elapsed + 's'
            : '生成总结中… 已用时 ' + elapsed + 's';
        },
      });
      clearInterval(metaTimer);
      const content = String(result || '').trim();
      if (!content) throw new Error('AI 返回内容为空');

      showResult(content);
      // 自动保存到历史（可后续查阅/编辑）
      addHistory(fullText, content, lang);
      const secs = ((Date.now() - startedAt) / 1000).toFixed(1);
      $('summaryMeta').textContent = '生成于 ' + formatTime(Date.now()) + ' · 耗时 ' + secs + 's' + (loadedFiles.length ? ' · 来源 ' + loadedFileNames() : '');
      showToast('总结生成完成，已保存到历史', 'success');
    } catch (err) {
      clearInterval(metaTimer);
      if (ctrl.signal.aborted) {
        $('summaryMeta').textContent = '';
        showToast('已取消生成', 'info');
        return;
      }
      $('summaryMeta').textContent = '';
      showToast(describeApiError(err), 'error');
    } finally {
      clearInterval(metaTimer);
      currentAbortCtrl = null;
      setLoading(false);
    }
  }

  // ===== Harden：API 错误友好诊断（指明问题 + 给出恢复路径，不透传原始报错） =====
  function describeApiError(err) {
    const msg = String((err && err.message) || err || '');
    let st = err && err.status;
    if (!st) { const m = msg.match(/HTTP\s*(\d{3})/); if (m) st = parseInt(m[1], 10); }
    if (st === 401 || st === 403) return 'API Key 无效或无权限，请在 API 设置中检查 Key';
    if (st === 404) return 'API 地址或模型名不存在，请检查 Base URL 与模型名称';
    if (st === 429) return '请求过于频繁或额度不足，请稍后重试或检查账户余额';
    if (st >= 500) return 'API 服务暂时不可用（' + st + '），请稍后重试';
    // 扩展被重载/更新后，旧页面的桥接上下文失效——刷新页面即恢复
    if (/Extension context invalidated/i.test(msg)) {
      return '扩展已更新或重新加载，本页面的桥接已失效：请刷新本页面（F5）后重试';
    }
    if (/Failed to fetch|NetworkError|Load failed|timeout/i.test(msg)) {
      return '无法连接 API：网络异常，或浏览器拦截了跨域请求（CORS）。可改用 Chrome 扩展版（无跨域限制），或换用支持跨域的 API 服务';
    }
    // status===0 / 「HTTP 0」/ 桥接代理失败 → 请求根本没到达目标服务器
    //（不是 Token Plan 的参数/模型名问题，而是 Base URL 域名连不上、未装扩展、或桥未注入本页）
    if ((st === 0) || /HTTP\s*0\b|代理请求失败|桥接/.test(msg)) {
      const m = msg.match(/(?:代理请求失败|桥接[^：:]*)[:：]\s*(.+)$/);
      const detail = (m && m[1]) ? ('（底层原因：' + m[1].slice(0, 120) + '）') : '';
      // 附扩展版本：这是判断「页面新代码 + 旧扩展」错配的最直接证据
      const ver = (window.AiService && window.AiService.getExtensionVersion && window.AiService.getExtensionVersion()) || '';
      const verNote = ver
        ? '。当前扩展版本 ' + ver + '：若低于 0.25.5，请在 chrome://extensions 点击本扩展的「重新加载」并刷新本页面'
        : '';
      return 'API 服务无法访问：请确认 Base URL 域名正确且网络可达' + detail + '；若为无 CORS 端点（如 Token Plan），需在 Chrome 安装并启用本扩展后重试（网页版必须经扩展代理桥）' + verNote;
    }
    return msg || '未知错误，请稍后重试';
  }

  function setLoading(on) {
    $('loadingBar').classList.toggle('active', on);
    $('summarizeBtn').disabled = on;
    $('cancelSummaryBtn').classList.toggle('visible', on);
    if (on) $('summaryMeta').textContent = '连接中…';
    $('summarizeBtn').innerHTML = on
      ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="animation:spin 1s linear infinite;"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> 总结中...'
      : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> 生成总结';
  }

  function showResult(md) {
    const el = $('summaryResult');
    el.innerHTML = renderMarkdown(md);
    el.dataset.rawText = md;
    el.classList.add('md-fade-in');
    // mermaid 源码块渲染成图（思维导图/流程图等；库不可用时保持源码块）
    if (window.AiService && AiService.enhanceMermaid) AiService.enhanceMermaid(el);
    $('summaryFooter').classList.add('visible');
    resetWechatSection();
  }

  /* ==================== 微信格式（纯文本，可直接粘贴发送） ==================== */
  function resetWechatSection() {
    const sec = $('wechatSection');
    const box = $('wechatResult');
    if (box) { box.textContent = ''; delete box.dataset.rawText; }
    if (sec) sec.style.display = 'none';
  }

  function convertToWechat() {
    const raw = $('summaryResult').dataset.rawText;
    if (!raw || raw.includes('粘贴邮件内容')) { showToast('暂无总结内容可转换', 'error'); return; }
    const text = window.markdownToWechat ? window.markdownToWechat(raw) : '';
    if (!text) { showToast('暂无总结内容可转换', 'error'); return; }
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

  /* ==================== 复制 / 下载 ==================== */
  $('copySummaryBtn').addEventListener('click', () => {
    const raw = $('summaryResult').dataset.rawText;
    if (!raw) { showToast('暂无总结内容', 'error'); return; }
    navigator.clipboard.writeText(raw).then(
      () => showToast('已复制到剪贴板', 'success'),
      () => showToast('复制失败', 'error')
    );
  });

  $('downloadMdBtn').addEventListener('click', () => downloadSummary('md'));
  $('downloadHtmlBtn').addEventListener('click', () => downloadSummary('html'));
  $('wechatFormatBtn').addEventListener('click', convertToWechat);
  $('copyWechatBtn').addEventListener('click', copyWechat);

  async function downloadSummary(format) {
    // 必须使用原始 Markdown（dataset.rawText）：textContent 已被 renderMarkdown 剥离语法
    const raw = $('summaryResult').dataset.rawText;
    if (!raw) { showToast('暂无总结内容可下载', 'error'); return; }
    // v0.53.0: 文件名 = 总结名称（首个一级标题）+ 时间戳，对齐参考项目 timestampName
    const nameBase = (window.AiService && AiService.summaryFileTitle) ? AiService.summaryFileTitle(raw) : 'email-summary';
    const nameFor = (ext) => (window.AiService && AiService.timestampName) ? AiService.timestampName(nameBase, ext) : 'email-summary-' + formatDate(Date.now()) + '.' + ext;
    let filename, mime, content;
    if (format === 'md') {
      filename = nameFor('md');
      mime = 'text/markdown;charset=utf-8';
      content = raw;
    } else {
      // 单文件 HTML 导出统一走 AiService（scenario-templates R2 交互式版式；
      // mdToHtmlAsync 额外把 mermaid 块（思维导图/流程图）内嵌打包库渲染成图）
      filename = nameFor('html');
      mime = 'text/html;charset=utf-8';
      content = (window.AiService && AiService.mdToHtmlAsync)
        ? await AiService.mdToHtmlAsync(raw, nameBase)
        : (window.AiService && AiService.mdToHtml ? AiService.mdToHtml(raw, nameBase) : raw);
    }
// v0.52.3: md 导出统一升级时间轴（与 AiService.downloadText 闸门同款）
    if (/^text\/markdown\b/i.test(String(mime || '')) && window.upgradeMarkdownTimeline) content = window.upgradeMarkdownTimeline(content);
    const blob = new Blob([content], { type: mime });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
    showToast('已下载 ' + filename, 'success');
  }

  /* ==================== 历史管理（保存 / 查阅 / 编辑 / 删除） ==================== */
  function addHistory(sourceText, result, lang) {
    history.unshift({
      title: deriveTitle(result, sourceText),
      source: sourceText.slice(0, 300),
      result: result,
      lang: lang,
      file: loadedFileNames(),
      time: Date.now(),
    });
    if (history.length > 30) history = history.slice(0, 30);
    persistHistory();
  }

  function deriveTitle(result, source) {
    // 优先取总结中的邮件主题，其次取输入内容首行
    const m = result.match(/邮件主题[*\s：:]*`?([^`\n|]+)`?/);
    if (m && m[1].trim() && !m[1].includes('<')) return m[1].trim().slice(0, 60);
    const first = source.split('\n').find((l) => l.trim());
    return (first || '邮件总结').trim().slice(0, 60);
  }

  function persistHistory() {
    localStorage.setItem('email_summary_history', JSON.stringify(history));
    relayRecord('email_summary_history', history);
    renderHistory();
  }

  function renderHistory() {
    const list = $('historyList');
    $('historyCount').textContent = history.length + ' 条';
    const selAllBox = $('historySelectAll');
    if (selAllBox) selAllBox.checked = false;
    if (history.length === 0) {
      list.innerHTML = '<div class="records-empty">暂无总结历史，生成总结后自动保存，可点击查看 / 编辑 / 下载</div>';
      return;
    }
    list.innerHTML = history.map((h, i) => {
      const preview = h.result.replace(/[#|>*`-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 90);
      return '<div class="history-item" data-index="' + i + '">'
        + '<input type="checkbox" class="history-check" data-index="' + i + '" title="勾选后可导出选中项">'
        + '<div class="history-item-body">'
        + '<div class="hi-title">' + escapeHtml(h.title) + '</div>'
        + '<div class="hi-preview">' + escapeHtml(preview) + '</div>'
        + '<div class="hi-meta">'
        + '<span class="hi-tag">' + (LANG_NAMES[h.lang] || '中文') + '</span>'
        + (h.file ? '<span>📎 ' + escapeHtml(h.file) + '</span>' : '')
        + '<span>' + formatTime(h.time) + '</span>'
        + '</div></div>'
        + '<div class="hi-actions">'
        + '<button class="hi-btn hi-edit" data-index="' + i + '" title="编辑"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>'
        + '<button class="hi-btn hi-delete" data-index="' + i + '" title="删除"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg></button>'
        + '</div></div>';
    }).join('');
  }

  $('historyList').addEventListener('click', (e) => {
    if (e.target.closest('.history-check')) return; // 勾选不触发查看
    const editBtn = e.target.closest('.hi-edit');
    const delBtn = e.target.closest('.hi-delete');
    if (editBtn) {
      e.stopPropagation();
      openEdit(parseInt(editBtn.dataset.index, 10));
      return;
    }
    if (delBtn) {
      e.stopPropagation();
      const idx = parseInt(delBtn.dataset.index, 10);
      history.splice(idx, 1);
      persistHistory();
      showToast('已删除该条总结', 'info');
      return;
    }
    const item = e.target.closest('.history-item');
    if (item) viewHistory(parseInt(item.dataset.index, 10));
  });

  function viewHistory(index) {
    const h = history[index];
    if (!h) return;
    showResult(h.result);
    $('summaryMeta').textContent = '历史记录 · ' + formatTime(h.time) + (h.file ? ' · 来源 ' + h.file : '');
    $('summaryResult').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ---------- 编辑 ---------- */
  function openEdit(index) {
    const h = history[index];
    if (!h) return;
    editingIndex = index;
    $('editTextarea').value = h.result;
    $('editMeta').textContent = '正在编辑：' + h.title;
    $('editPanel').classList.add('visible');
    $('editPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  $('editSaveBtn').addEventListener('click', () => {
    if (editingIndex < 0) return;
    const val = $('editTextarea').value.trim();
    if (!val) { showToast('内容不能为空', 'error'); return; }
    history[editingIndex].result = val;
    history[editingIndex].title = deriveTitle(val, history[editingIndex].source);
    persistHistory();
    closeEdit();
    showResult(val);
    showToast('修改已保存', 'success');
  });

  $('editCancelBtn').addEventListener('click', closeEdit);

  function closeEdit() {
    editingIndex = -1;
    $('editPanel').classList.remove('visible');
  }

  $('clearAllBtn').addEventListener('click', () => {
    if (history.length === 0) return;
    if (!confirm('确定清空全部 ' + history.length + ' 条总结历史？此操作不可恢复。')) return;
    history = [];
    persistHistory();
    showToast('已清空全部总结历史', 'info');
  });

  // ===== 总结历史：勾选后导出为 Markdown / HTML（v0.45.0） =====
  function selectedHistorySummaries() {
    const indexes = Array.prototype.slice.call(document.querySelectorAll('#historyList .history-check:checked'))
      .map(c => parseInt(c.dataset.index, 10));
    return indexes.map(i => history[i]).filter(Boolean);
  }

  function historyItemMarkdown(h) {
    const head = [h.title, formatTime(h.time), LANG_NAMES[h.lang] || '中文', h.file ? '来源 ' + h.file : '']
      .filter(Boolean).join(' · ');
    return '## ' + head + '\n\n' + (h.result || '');
  }

  async function exportSelectedHistory(format) {
    const items = selectedHistorySummaries();
    if (!items.length) { showToast('请先勾选要导出的总结', 'error'); return; }
    if (!window.AiService || !AiService.downloadText) { showToast('导出功能不可用', 'error'); return; }
    const md = items.map(historyItemMarkdown).join('\n\n---\n\n');
    const stamp = new Date().toISOString().slice(0, 10);
    if (format === 'html') {
      const html = AiService.mdToHtmlAsync ? await AiService.mdToHtmlAsync(md, '邮件总结历史') : AiService.mdToHtml(md, '邮件总结历史');
      AiService.downloadText('ai-toolbox-email-summaries-' + stamp + '.html', html, 'text/html;charset=utf-8');
    } else {
      AiService.downloadText('ai-toolbox-email-summaries-' + stamp + '.md', md, 'text/markdown;charset=utf-8');
    }
    showToast('已导出 ' + items.length + ' 条总结', 'success');
  }

  $('historySelectAll').addEventListener('change', function () {
    document.querySelectorAll('#historyList .history-check').forEach(c => { c.checked = this.checked; });
  });
  $('exportHistoryMdBtn').addEventListener('click', () => exportSelectedHistory('md'));
  $('exportHistoryHtmlBtn').addEventListener('click', () => exportSelectedHistory('html'));

  // 记录跨端实时同步（v0.25.0）：他端写入时刷新列表
  if (window.AiService && window.AiService.onRecordSync) {
    window.AiService.onRecordSync('email_summary_history', (v) => {
      history = Array.isArray(v) ? v : [];
      renderHistory();
    });
  }

  /* ==================== Utils ==================== */
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = String(str == null ? '' : str);
    return div.innerHTML;
  }
  function formatDate(ts) {
    const d = new Date(ts);
    return d.getFullYear()
      + String(d.getMonth() + 1).padStart(2, '0')
      + String(d.getDate()).padStart(2, '0');
  }
  function formatTime(ts) {
    const d = new Date(ts);
    return (d.getMonth() + 1) + '/' + d.getDate() + ' '
      + String(d.getHours()).padStart(2, '0') + ':'
      + String(d.getMinutes()).padStart(2, '0');
  }

  /* ==================== Init ==================== */
  initTemplateSelect();
  initLangSelect();
  renderHistory();
})();
