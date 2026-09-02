/**
 * LinguaFlow · 邮件总结
 * 按 email-thread-summarizer/SKILL.md 规范：四段式总结 + 按责任方分解的 To Do List
 * 功能：粘贴邮件 / 选择本地文件 → AI 总结 → 显示 + HTML/MD 下载 + 历史保存（可查阅/编辑）
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  /* ==================== SKILL.md 系统提示词（email-thread-summarizer 正文） ==================== */
  const SKILL_PROMPT = `你是一名面向硬件/项目工程师的项目秘书兼技术助理。用户经常粘贴客户或合作伙伴的邮件线程（通常中英混杂、按倒序引用、夹带签名档与保密声明），你的职责是：

1. **把线程按时间正序理清**，输出结构化详细总结
2. **分解出可执行的 To Do List**（按责任方、带优先级、验收标准、依赖关系）

## 铁律（违反即为失败）

1. **绝不编造**：拿不到邮件正文时，明确告知用户缺少正文并请其提供，绝不凭空生成总结。
2. **数字保真**：所有数值、型号、寄存器名、命令名、日期与原文逐字一致，禁止四舍五入或泛化（如 \`4.19 V\`、\`50.6 mV\`、\`0xF091\`、\`CAL_COV\` 必须原样保留）。
3. **数值漂移必须标注**：同一参数在多封邮件中变化时（如 4.185 V → 4.19 V），以**最新一封**为准，并在风险区明确标出变更过程。
4. **区分已拍板与未拍板**：只把最新邮件明确决定的事项写成"已决定"；讨论过但未定案的写成"未拍板/待澄清"。
5. **标题≠范围**：邮件标题涵盖的范围与最终实际决定范围不一致时，必须指出差异。
6. **去噪不丢信息**：剥离签名档、保密声明、引用标记（\`>\`、\`On ... wrote:\`），但被引用段落里的实质内容必须纳入时间线。

## 工作流程

### 第一步：解析邮件内容
解析每封邮件的：日期时间、发件人、收件人、主题、正文要点。**按时间正序（从早到晚）重排**——粘贴的线程通常是倒序的。

### 第二步：交叉核对
本环境为网页端，无法访问本地仓库文档：涉及技术论断（参数范围、步进、精度、命令/流程）时，若无法从邮件内容本身确认，一律标注"未验证"，不要冒充已核对。

### 第三步：输出四段式总结

严格按以下模板输出（章节顺序固定，小节标题可随内容微调，骨架不变）：

\`\`\`markdown
## 邮件线程详细总结

### 一、主题与背景
- **邮件主题**：\`<Subject>\`
- **双方**：<甲方（姓名，职位，公司）> ↔ <乙方（姓名，职位，公司）>
- **对象**：<讨论对象：项目/产品/芯片型号等>
- **核心诉求演变**：<最初诉求> → <最终结论>（一句话讲清演变链条）

### 二、时间线（按时间正序，共 N 封）
| 日期 | 发件人 | 关键内容 |
|---|---|---|
| MM-DD | XXX | 1~3 句：诉求/结论/关键数字 |
（纯礼节、催办邮件也要列出并标注；每封一行，倒序线程必须重排为正序）

### 三、技术要点（交叉核对）
1. **<要点一>**：<结论 + 依据>
2. **<要点二>**：…
（每个要点尽量给出核对来源；未核对的注明"未验证"）

### 四、风险与注意点
> [!warning] 风险与待澄清项
> - **数值已变更**：<旧值> → <新值>，以新值为准
> - **范围差异**：<标题/早期讨论范围> vs <实际决定范围>
> - **依赖关系**：<谁等谁，先后顺序>
> - **未明确的点**：<容差/参数/决策缺口，逐条列出>
\`\`\`

### 第四步：To Do List 分解

按责任方分三块输出：

\`\`\`markdown
## To Do List

### A. 我方（<公司/团队名>）
| # | 优先级 | 事项 | 验收标准 | 依赖 |
|---|---|---|---|---|
| A1 | 🔴 P0 | <可执行动作，动词开头> | <怎样算完成> | <前置项或"无"> |

### B. 对方（<对方公司>，需跟踪）
| # | 责任人 | 事项 |
（只收录对方在邮件中明确承诺/认领的事项，注明出处邮件）

### C. 联合验证（后续节点）
- [ ] <双方共同完成的验证项>
\`\`\`

分解规则：
- 优先级定义：P0 = 阻塞 build/交付或有明确期限；P1 = 有依赖关系需排期；P2 = 记录归档类。
- 每个"事项"必须可执行（"回复邮件确认 X""准备脚本，目标值 Y"），禁止模糊描述（"跟进此事"❌）。
- 对方未承诺的事项不要塞进 B 区；我方需要主动确认的问题（容差、范围）放进 A 区作为"回复并澄清"任务。

**默认同时输出四段式总结与 To Do List 两部分**，使用 Markdown 格式。`;

  const LANG_NAMES = {
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
  let config = JSON.parse(localStorage.getItem('email_summary_config') || 'null') || {};
  let history = JSON.parse(localStorage.getItem('email_summary_history') || '[]');

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
  let loadedFileName = '';

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
      if (tc && tc.baseUrl) config = { baseUrl: tc.baseUrl, apiKey: tc.apiKey, model: tc.model };
    } catch (e) { /* ignore */ }
  }
  if (config.baseUrl) $('baseUrl').value = config.baseUrl;
  if (config.apiKey) $('apiKey').value = config.apiKey;
  if (config.model) $('modelName').value = config.model;
  if (!config.apiKey) $('settingsPanel').classList.add('open');

  /* ==================== 插件配置同步（LinguaFlow 扩展广播） ==================== */
  function applySyncedConfig(cfg) {
    if (!cfg || !cfg.baseUrl) return;
    config = { baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, model: cfg.model };
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
      if (area === 'local' && changes.config && changes.config.newValue) {
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

  /* ==================== Draft ==================== */
  let draftTimer = null;
  function saveDraft() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => {
      localStorage.setItem('email_summary_draft', emailEditor.getMarkdown());
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

  $('fileInput').addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const isPdf = /\.pdf$/i.test(file.name);
    const maxSize = isPdf ? 200 * 1024 * 1024 : 10 * 1024 * 1024;
    if (file.size > maxSize) {
      showToast('文件过大（' + (isPdf ? '>200MB' : '>10MB') + '），请拆分后重试', 'error');
      e.target.value = '';
      return;
    }

    if (isPdf) {
      const reader = new FileReader();
      // 大文件（如 150MB）读取耗时较长，显示进度避免误以为卡死
      reader.onprogress = (ev) => {
        if (ev.lengthComputable && file.size > 20 * 1024 * 1024) {
          showToast('正在读取文件（' + Math.round(ev.loaded / ev.total * 100) + '%）…', 'info');
        }
      };
      reader.onload = async () => {
        try {
          showToast('正在解析 PDF…', 'info');
          const text = await extractPdfText(reader.result);
          if (!text.trim()) {
            showToast('未能从 PDF 提取到文本（可能是扫描件/图片型 PDF，需先 OCR）', 'error');
            return;
          }
          applyLoadedFile(text, file.name);
        } catch (err) {
          showToast('PDF 解析失败：' + (err.message || err), 'error');
        }
      };
      reader.onerror = () => showToast('文件读取失败', 'error');
      reader.readAsArrayBuffer(file);
      e.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      let content = String(reader.result || '');
      // .eml 简易处理：保留头部元信息与正文
      if (/\.eml$/i.test(file.name)) content = normalizeEml(content);
      applyLoadedFile(content, file.name);
    };
    reader.onerror = () => showToast('文件读取失败', 'error');
    reader.readAsText(file, 'utf-8');
    e.target.value = '';
  });

  function applyLoadedFile(content, fileName) {
    emailEditor.setMarkdown(content);
    saveDraft();
    loadedFileName = fileName;
    $('fileNameText').textContent = fileName;
    $('fileNameTag').classList.add('visible');
    showToast('已读取文件：' + fileName, 'success');
    if (_mdPreviewOpen) $('mdPreviewContent').innerHTML = renderMarkdown(content);
  }

  // PDF 文本提取（pdf.js）：逐页取 textContent，按 Y 坐标变化分行。
  // 超大文件（如 150MB / 数千页）自动提前终止：提取文本达到预算或页数达上限即停，
  // 避免长时间等待与内存超限（邮件总结不需要全文，够 AI 理解即可）。
  const PDF_MAX_PAGES = 500;       // 页数上限
  const PDF_TEXT_BUDGET = 120000;  // 文本预算（发送前还会经 autoTruncate 再截取）
  async function extractPdfText(buffer) {
    if (typeof pdfjsLib === 'undefined') throw new Error('PDF 解析库未加载');
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
    const totalPages = pdf.numPages;
    const pageCount = Math.min(totalPages, PDF_MAX_PAGES);
    const pages = [];
    let collected = 0;
    let stoppedAt = 0;
    for (let p = 1; p <= pageCount; p++) {
      if (p === 1 || p % 10 === 0 || p === pageCount) {
        showToast('正在解析 PDF（第 ' + p + '/' + totalPages + ' 页）…', 'info');
      }
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      const lines = [];
      let line = '';
      let lastY = null;
      for (const item of content.items) {
        if (typeof item.str !== 'string') continue;
        const y = item.transform ? item.transform[5] : null;
        if (lastY !== null && y !== null && Math.abs(y - lastY) > 3) {
          if (line.trim()) lines.push(line.trim());
          line = '';
        }
        line += item.str;
        if (item.hasEOL) {
          if (line.trim()) lines.push(line.trim());
          line = '';
          lastY = null;
          continue;
        }
        if (y !== null) lastY = y;
      }
      if (line.trim()) lines.push(line.trim());
      const pageText = lines.join('\n').trim();
      if (pageText) { pages.push(pageText); collected += pageText.length; }
      page.cleanup(); // 释放页面资源，降低大文件内存占用
      if (collected >= PDF_TEXT_BUDGET) { stoppedAt = p; break; }
    }
    const NL = String.fromCharCode(10);
    if (stoppedAt > 0) {
      pages.push('[... PDF 内容量较大，已自动停止解析（提取至第 ' + stoppedAt + '/' + totalPages + ' 页），请基于现有内容总结 ...]');
    } else if (totalPages > PDF_MAX_PAGES) {
      pages.push('[... PDF 共 ' + totalPages + ' 页，仅解析前 ' + PDF_MAX_PAGES + ' 页，请基于现有内容总结 ...]');
    }
    return pages.join(NL + NL);
  }

  $('fileClearBtn').addEventListener('click', () => {
    loadedFileName = '';
    $('fileNameTag').classList.remove('visible');
  });

  $('clearInputBtn').addEventListener('click', () => {
    emailEditor.clear();
    localStorage.removeItem('email_summary_draft');
    loadedFileName = '';
    $('fileNameTag').classList.remove('visible');
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

  /* ==================== 超长内容自动处理 ==================== */
  // LLM 可接受的近似上限（约 6 万字符 ≈ 3~4 万 token）；
  // 超出时自动保留首尾（邮件头/最新往来通常在两端），省略中间并明确标注。
  // 编辑器仍保留全文，仅在发送给 AI 时截断。
  const MAX_INPUT_CHARS = 60000;
  function autoTruncate(text) {
    if (text.length <= MAX_INPUT_CHARS) return { text: text, truncated: false, removed: 0 };
    const headLen = Math.floor(MAX_INPUT_CHARS * 0.6);
    const tailLen = MAX_INPUT_CHARS - headLen;
    const removed = text.length - headLen - tailLen;
    const NL2 = String.fromCharCode(10) + String.fromCharCode(10);
    const marker = NL2 + '[... 中间约 ' + removed + ' 字符因长度限制自动省略，请基于现有内容总结并在风险区注明信息不完整 ...]' + NL2;
    return { text: text.slice(0, headLen) + marker + text.slice(text.length - tailLen), truncated: true, removed: removed };
  }

  /* ==================== AI 总结 ==================== */
  $('summarizeBtn').addEventListener('click', summarize);

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && editingIndex < 0) summarize();
  });

  async function summarize() {
    const fullText = emailEditor.getMarkdown().trim();
    if (!fullText) {
      showToast('请先粘贴邮件内容或选择本地文件', 'error');
      return;
    }
    if (!config.baseUrl || !config.apiKey || !config.model) {
      showToast('请先配置 API 设置', 'error');
      $('settingsPanel').classList.add('open');
      return;
    }

    // 超长内容自动截断（保留首尾，省略中间）
    const trunc = autoTruncate(fullText);
    if (trunc.truncated) {
      showToast('内容较长，已自动截取首尾共 ' + MAX_INPUT_CHARS + ' 字符（省略中间 ' + trunc.removed + ' 字符）', 'info');
    }

    const lang = $('outputLang').value;
    setLoading(true);
    const startedAt = Date.now();

    try {
      const url = config.baseUrl + '/chat/completions';
      // 经 AiService.proxyFetch：网页直连失败时自动走扩展代理桥（Token Plan 等无 CORS 端点也可用）
      const _pf = (window.AiService && window.AiService.proxyFetch) || fetch;
      const response = await _pf(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + config.apiKey,
        },
        body: JSON.stringify({
          model: config.model,
          messages: [
            { role: 'system', content: SKILL_PROMPT },
            {
              role: 'user',
              content: '请使用' + LANG_NAMES[lang] + '输出。以下是邮件内容，请按规范输出四段式详细总结与 To Do List：\n\n' + trunc.text,
            },
          ],
          temperature: 0.3,
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        const e = new Error(errText.slice(0, 200) || ('HTTP ' + response.status));
        e.status = response.status;
        throw e;
      }

      const data = await response.json();
      const result = data.choices && data.choices[0] && data.choices[0].message
        ? data.choices[0].message.content : null;
      if (!result) throw new Error('AI 返回内容为空');

      showResult(result);
      // 自动保存到历史（可后续查阅/编辑）
      addHistory(fullText, result, lang);
      const secs = ((Date.now() - startedAt) / 1000).toFixed(1);
      $('summaryMeta').textContent = '生成于 ' + formatTime(Date.now()) + ' · 耗时 ' + secs + 's' + (loadedFileName ? ' · 来源 ' + loadedFileName : '') + (trunc.truncated ? ' · 超长已自动截取' : '');
      showToast('总结生成完成，已保存到历史', 'success');
    } catch (err) {
      showToast(describeApiError(err), 'error');
    } finally {
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
    if (/Failed to fetch|NetworkError|Load failed|timeout/i.test(msg)) {
      return '无法连接 API：网络异常，或浏览器拦截了跨域请求（CORS）。可改用 Chrome 扩展版（无跨域限制），或换用支持跨域的 API 服务';
    }
    return msg || '未知错误，请稍后重试';
  }

  function setLoading(on) {
    $('loadingBar').classList.toggle('active', on);
    $('summarizeBtn').disabled = on;
    $('summarizeBtn').innerHTML = on
      ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="animation:spin 1s linear infinite;"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> 总结中...'
      : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> 生成总结';
  }

  function showResult(md) {
    const el = $('summaryResult');
    el.innerHTML = renderMarkdown(md);
    el.dataset.rawText = md;
    el.classList.add('md-fade-in');
    $('summaryFooter').classList.add('visible');
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

  function downloadSummary(format) {
    // 必须使用原始 Markdown（dataset.rawText）：textContent 已被 renderMarkdown 剥离语法
    const raw = $('summaryResult').dataset.rawText;
    if (!raw) { showToast('暂无总结内容可下载', 'error'); return; }
    const stamp = formatDate(Date.now());
    let filename, mime, content;
    if (format === 'md') {
      filename = 'email-summary-' + stamp + '.md';
      mime = 'text/markdown;charset=utf-8';
      content = raw;
    } else {
      filename = 'email-summary-' + stamp + '.html';
      mime = 'text/html;charset=utf-8';
      content = '<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n<meta charset="UTF-8"/>\n'
        + '<title>Email Summary</title>\n<style>\n'
        + '  body{font-family:Inter,"Noto Sans SC",sans-serif;background:#0d1420;color:#e6eaf2;'
        + 'padding:40px 48px;max-width:960px;margin:0 auto;line-height:1.85;font-size:15px;}\n'
        + '  h2{color:#7cc3ea;font-size:1.5rem;border-bottom:1px solid rgba(91,163,214,0.3);padding-bottom:10px;margin:32px 0 16px;}\n'
        + '  h3{color:#62c3ac;font-size:1.15rem;margin:24px 0 10px;}\n'
        + '  h4{color:#9ab8e0;font-size:1rem;margin:18px 0 8px;}\n'
        + '  table{border-collapse:collapse;width:100%;margin:12px 0;font-size:0.9em;}\n'
        + '  th,td{border:1px solid rgba(140,175,215,0.25);padding:8px 12px;text-align:left;vertical-align:top;}\n'
        + '  th{background:rgba(91,163,214,0.12);}\n'
        + '  blockquote{border-left:3px solid #d8a05e;background:rgba(216,160,94,0.08);margin:12px 0;padding:10px 16px;border-radius:0 8px 8px 0;}\n'
        + '  ul,ol{margin:8px 0 16px 20px;} li{margin:6px 0;line-height:1.7;}\n'
        + '  strong{color:#8ec4ea;} hr{border:none;border-top:1px solid rgba(91,163,214,0.15);margin:24px 0;}\n'
        + '  p{margin:8px 0;} code{background:rgba(91,163,214,0.14);padding:2px 6px;border-radius:4px;font-size:0.9em;}\n'
        + '</style>\n</head>\n<body>\n'
        + markdownToHtml(raw)
        + '\n</body>\n</html>';
    }
    const blob = new Blob([content], { type: mime });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
    showToast('已下载 ' + filename, 'success');
  }

  // Markdown → 独立 HTML（支持标题/表格/引用/列表/任务列表，用于导出文件）
  function markdownToHtml(md) {
    const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const inline = (s) => esc(s)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');
    const lines = md.split('\n');
    const out = [];
    let list = null; // 'ul' | 'ol'
    let inTable = false, tableHeaderDone = false;
    let inQuote = false;

    const closeList = () => { if (list) { out.push('</' + list + '>'); list = null; } };
    const closeTable = () => { if (inTable) { out.push('</table>'); inTable = false; tableHeaderDone = false; } };
    const closeQuote = () => { if (inQuote) { out.push('</blockquote>'); inQuote = false; } };

    for (let i = 0; i < lines.length; i++) {
      const rawLine = lines[i];
      const line = rawLine.trim();

      // 表格行
      if (/^\|.*\|\s*$/.test(line)) {
        closeList(); closeQuote();
        if (/^\|[\s:|-]+\|\s*$/.test(line)) { tableHeaderDone = true; continue; } // 分隔行
        if (!inTable) { out.push('<table>'); inTable = true; }
        const cells = line.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
        const tag = (!tableHeaderDone) ? 'th' : 'td';
        out.push('<tr>' + cells.map((c) => '<' + tag + '>' + inline(c) + '</' + tag + '>').join('') + '</tr>');
        continue;
      }
      closeTable();

      if (line === '') { closeList(); closeQuote(); continue; }

      if (/^---+\s*$/.test(line)) { closeList(); closeQuote(); out.push('<hr>'); continue; }

      const hm = line.match(/^(#{1,4})\s+(.+)/);
      if (hm) {
        closeList(); closeQuote();
        const lv = Math.min(hm[1].length, 4); // # → h1，## → h2，### → h3
        out.push('<h' + lv + '>' + inline(hm[2]) + '</h' + lv + '>');
        continue;
      }

      // 引用（含 > [!warning] callout）
      if (/^>\s?/.test(line)) {
        closeList();
        if (!inQuote) { out.push('<blockquote>'); inQuote = true; }
        const content = line.replace(/^>\s?/, '').replace(/^\[!\w+\]\s*/, '');
        if (content) out.push('<p>' + inline(content) + '</p>');
        continue;
      }
      closeQuote();

      // 任务列表
      const tm = line.match(/^[-*]\s+\[( |x|X)\]\s+(.+)/);
      if (tm) {
        if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul'; }
        out.push('<li>' + (tm[1] === ' ' ? '☐ ' : '☑ ') + inline(tm[2]) + '</li>');
        continue;
      }

      const um = line.match(/^[-*]\s+(.+)/);
      if (um) {
        if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul'; }
        out.push('<li>' + inline(um[1]) + '</li>');
        continue;
      }

      const om = line.match(/^\d+\.\s+(.+)/);
      if (om) {
        if (list !== 'ol') { closeList(); out.push('<ol>'); list = 'ol'; }
        out.push('<li>' + inline(om[1]) + '</li>');
        continue;
      }

      closeList();
      out.push('<p>' + inline(line) + '</p>');
    }
    closeList(); closeTable(); closeQuote();
    return out.join('\n');
  }

  /* ==================== 历史管理（保存 / 查阅 / 编辑 / 删除） ==================== */
  function addHistory(sourceText, result, lang) {
    history.unshift({
      title: deriveTitle(result, sourceText),
      source: sourceText.slice(0, 300),
      result: result,
      lang: lang,
      file: loadedFileName || '',
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
    if (history.length === 0) {
      list.innerHTML = '<div class="records-empty">暂无总结历史，生成总结后自动保存，可点击查看 / 编辑 / 下载</div>';
      return;
    }
    list.innerHTML = history.map((h, i) => {
      const preview = h.result.replace(/[#|>*`-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 90);
      return '<div class="history-item" data-index="' + i + '">'
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

  $('exportHistoryBtn').addEventListener('click', () => {
    if (history.length === 0) { showToast('暂无总结历史', 'info'); return; }
    const fname = 'ai-toolbox-email-summary-history-' + new Date().toISOString().slice(0, 10) + '.json';
    if (window.AiService && window.AiService.downloadText) AiService.downloadText(fname, JSON.stringify(history, null, 2), 'application/json');
  });

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
  renderHistory();
})();
