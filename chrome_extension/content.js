// LinguaFlow - 划词翻译 Content Script

(function() {
  'use strict';

  // ===== 模型兼容小工具（与 ai-service.js 的 normalizeBaseUrl/isReasoningModel 保持同步；
  // content script 与页面隔离，无 window.AiService，故内联纯函数） =====
  function lfNormalizeBaseUrl(baseUrl) {
    let u = String(baseUrl || '').trim().replace(/[\u0000-\u0020\u007f\u3000]+/g, '').replace(/：/g, ':').replace(/／/g, '/');
    while (u.endsWith('/')) u = u.slice(0, -1);
    if (u.endsWith('/chat/completions')) u = u.slice(0, -1 * '/chat/completions'.length);
    return u;
  }
  function lfIsReasoningModel(model) {
    return /reasoner|reasoning|thinking|qwq|kimi-k3|deepseek-v4|(^|[^a-z0-9])o[134]($|[^0-9])/i.test(String(model || '').toLowerCase());
  }

  let config = null;
  let triggerEl = null;
  let tooltipEl = null;
  let selectedText = '';

  // ===== 记录启动拉取（v0.25.3）=====
  // content script 以 document_start 注入（先于页面脚本执行）；把 chrome.storage 中的
  // 全部同步记录键预先写入 localStorage，保证页面初始化读到的是最新数据——
  // 页面关闭期间在扩展/其他端产生的记录，刷新后依然存在（扩展为权威源）。
  // 键列表须与 background.js 的 RECORD_SYNC_KEYS 值保持一致。
  try {
    const RECORD_LS_KEYS = [
      'td_todo_items', 'td_todo_cal_config', 'hn_cards', 'translate_history', 'translate_draft',
      'wr_work_records', 'wr_work_summaries', 'wr_work_config', 'wr_work_draft',
      'email_summary_history', 'email_summary_config',
      'learningHistory', 'englishLearningData', 'ai_parse_state', 'ai_prompts_state'
    ];
    chrome.storage.local.get(RECORD_LS_KEYS, (res) => {
      Object.keys(res || {}).forEach((k) => {
        if (res[k] === undefined) return;
        try { localStorage.setItem(k, JSON.stringify(res[k])); } catch (e) { /* ignore */ }
      });
    });
  } catch (e) { /* ignore */ }

  // ===== Load config =====
  chrome.storage.local.get(['config'], ({ config: c }) => {
    config = c || {};
    syncConfigToPage(c);
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.config) {
      config = changes.config.newValue;
      syncConfigToPage(config);
    }
  });

  // 同步配置到网页：写入 localStorage('translate_config') 供页面 JS 读取，
  // 并通过 postMessage 实时通知已打开的页面（无需刷新）。
  function syncConfigToPage(cfg) {
    if (!cfg || !cfg.baseUrl) return;
    try {
      localStorage.setItem('translate_config', JSON.stringify({
        baseUrl: cfg.baseUrl,
        apiKey: cfg.apiKey,
        model: cfg.model,
      }));
    } catch (e) { /* ignore */ }
    try {
      window.postMessage({ source: 'linguaflow-extension', config: cfg }, '*');
    } catch (e) { /* ignore */ }
  }

  // Listen for messages from popup / background
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'updateConfig') {
      config = msg.config;
      syncConfigToPage(msg.config);
    }
    if (msg.action === 'linguaflow:syncConfig') {
      config = msg.config;
      syncConfigToPage(msg.config);
    }
    // 记录双向同步（v0.25.0）：扩展写入的记录 → 页面 localStorage
    // （localStorage 写入会触发页面既有的 storage 事件监听，自动刷新 UI）
    if (msg.action === 'linguaflow:syncRecord' && msg.lsKey && msg.value !== undefined) {
      try { localStorage.setItem(msg.lsKey, JSON.stringify(msg.value)); } catch (err) { /* ignore */ }
      // 同步通知页面 JS（AiService.onRecordSync 监听此消息做实时 UI 刷新）
      try { window.postMessage({ source: 'linguaflow-extension', type: 'record-sync', key: msg.key || msg.lsKey, value: msg.value }, '*'); } catch (err) { /* ignore */ }
    }
  });

  // ===== 网页跨域代理桥 + 配置反向同步（v0.23.0） =====
  // 页面（index.html / hotnews.html 等）→ postMessage → 此处 → chrome.runtime → background
  // 注意：content script 默认只注入顶层帧，因此桥请求（发往 window.top）由本监听处理，
  // 回包必须发往 e.source（发起请求的帧，可能是 index.html 里的 iframe），而非本帧 window。
  const streamPorts = {};   // bridgeId → 长端口（流式桥接，v0.25.5）

  // MV3 SW 可能在应答前被终止（「message channel closed」）。此处自动重发一次——
  // sendMessage 会重新唤醒 SW，第二次通常落在健康的 SW 实例上。上下文失效（扩展被
  // 重载/更新后旧 content script 存活）时同步抛错，直接回报明确错误。
  function lfSendRuntime(msg, onDone) {
    let settled = false;
    const attempt = (retried) => {
      try {
        chrome.runtime.sendMessage(msg, (res) => {
          const le = chrome.runtime.lastError;   // 必须读取，否则控制台报未检查
          if (settled) return;
          if (!retried && !res && le && /message channel closed|message port closed/i.test(le.message || '')) {
            setTimeout(() => attempt(true), 150);
            return;
          }
          settled = true;
          onDone({ res: res, error: (le && le.message) || '' });
        });
      } catch (err) {
        if (settled) return;
        settled = true;
        onDone({ res: null, error: (err && err.message) || 'bridge unavailable' });
      }
    };
    attempt(false);
  }

  window.addEventListener('message', (e) => {
    const d = e.data;
    if (!d || d.source !== 'linguaflow-page') return;

    // 桥可用性探测：回给发起帧（附带扩展版本，供页面诊断「扩展副本过旧」）
    if (d.type === 'bridge-ping' && d.bridgeId) {
      let v = '';
      try { v = chrome.runtime.getManifest().version; } catch (err) { /* ignore */ }
      try { e.source.postMessage({ source: 'linguaflow-extension', bridgeId: d.bridgeId, extVersion: v }, '*'); } catch (err) { /* ignore */ }
      return;
    }

    // 代理请求：background fetch（host_permissions 免跨域）后回给发起帧
    if (d.type === 'bridge-fetch' && d.bridgeId && d.url) {
      lfSendRuntime(
        { action: 'linguaflow:proxyFetch', url: d.url, method: d.method, headers: d.headers, body: d.body },
        ({ res, error }) => {
          try {
            e.source.postMessage({
              source: 'linguaflow-extension', bridgeId: d.bridgeId,
              ok: !!(res && res.ok), status: (res && res.status) || 0,
              text: (res && res.text) || '', error: (res && res.error) || error
            }, '*');
          } catch (err) { /* ignore */ }
        }
      );
      return;
    }

    // 流式代理请求（v0.25.5）：长端口分片中继。收到请求先回 ack 供页面探测通道支持，
    // 之后 background 的 chunk/json/http-error/end/error 事件原样回传发起帧。
    if (d.type === 'bridge-fetch-stream' && d.bridgeId && d.url) {
      try { e.source.postMessage({ source: 'linguaflow-extension', bridgeId: d.bridgeId, stream: true, event: 'ack' }, '*'); } catch (err) { /* ignore */ }
      try {
        const port = chrome.runtime.connect({ name: 'linguaflow:proxyFetchStream' });
        streamPorts[d.bridgeId] = port;
        port.onMessage.addListener((m) => {
          if (!m || m.bridgeId !== d.bridgeId) return;
          try {
            e.source.postMessage({
              source: 'linguaflow-extension', bridgeId: d.bridgeId, stream: true,
              event: m.event, text: m.text, status: m.status, error: m.error
            }, '*');
          } catch (err) { /* ignore */ }
        });
        port.onDisconnect.addListener(() => {
          const le = chrome.runtime.lastError;
          try {
            e.source.postMessage({
              source: 'linguaflow-extension', bridgeId: d.bridgeId, stream: true, event: 'error',
              error: (le && le.message) ? ('桥接流式通道中断：' + le.message) : '桥接流式通道中断'
            }, '*');
          } catch (err) { /* ignore */ }
          delete streamPorts[d.bridgeId];
        });
        port.postMessage({ bridgeId: d.bridgeId, url: d.url, method: d.method || 'GET', headers: d.headers || {}, body: d.body || '' });
      } catch (err) {
        try { e.source.postMessage({ source: 'linguaflow-extension', bridgeId: d.bridgeId, stream: true, event: 'error', error: 'bridge unavailable' }, '*'); } catch (e2) { /* ignore */ }
      }
      return;
    }

    // 桥接保活（v0.25.5）：长生成期间页面定期心跳 → 转成 port 消息/运行时消息唤醒 SW，
    // 重置 MV3 SW 空闲计时器，防止 background 在 fetch 完成前被回收导致「通道关闭」
    if (d.type === 'bridge-ka' && d.bridgeId) {
      if (streamPorts[d.bridgeId]) {
        try { streamPorts[d.bridgeId].postMessage({ bridgeId: d.bridgeId, event: 'ka' }); } catch (err) { /* ignore */ }
      } else {
        try { chrome.runtime.sendMessage({ action: 'linguaflow:ka' }, function () { void chrome.runtime.lastError; }); } catch (err) { /* ignore */ }
      }
      return;
    }

    // 流式取消：background 侧 AbortController 中止 fetch
    if (d.type === 'bridge-abort' && d.bridgeId && streamPorts[d.bridgeId]) {
      try { streamPorts[d.bridgeId].postMessage({ bridgeId: d.bridgeId, event: 'abort' }); } catch (err) { /* ignore */ }
      return;
    }

    // 网页保存配置 → 写 chrome.storage（扩展弹窗/侧边栏同步）
    if (d.type === 'save-config' && d.config && d.config.baseUrl) {
      try {
        chrome.runtime.sendMessage({
          action: 'linguaflow:saveConfig',
          config: { baseUrl: d.config.baseUrl, apiKey: d.config.apiKey, model: d.config.model }
        }, () => {});
      } catch (err) { /* ignore */ }
    }

    // 网页记录保存 → 写 chrome.storage（v0.25.0：扩展侧同步，映射表见 background.js）
    if (d.type === 'save-record' && d.key && d.value !== undefined) {
      try {
        chrome.runtime.sendMessage({ action: 'linguaflow:saveRecord', key: d.key, value: d.value }, () => {});
      } catch (err) { /* ignore */ }
    }
  });

  // ===== Text Selection =====
  document.addEventListener('mouseup', (e) => {
    // Ignore clicks inside our own elements
    if (e.target.closest('#linguaflow-tooltip') || e.target.closest('#linguaflow-trigger')) return;

    setTimeout(() => {
      const sel = window.getSelection();
      const text = sel.toString().trim();

      // Remove old elements
      removeTrigger();
      removeTooltip();

      if (text && text.length > 0 && text.length < 5000 && config?.enableSelectTranslate !== false) {
        selectedText = text;
        showTrigger(e, sel);
      }
    }, 10);
  });

  // Click outside to close
  document.addEventListener('mousedown', (e) => {
    if (!e.target.closest('#linguaflow-tooltip') && !e.target.closest('#linguaflow-trigger')) {
      removeTrigger();
      removeTooltip();
    }
  });

  // ESC to close
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      removeTrigger();
      removeTooltip();
    }
  });

  // ===== Trigger Icon =====
  function showTrigger(e, sel) {
    removeTrigger();

    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    triggerEl = document.createElement('div');
    triggerEl.id = 'linguaflow-trigger';
    triggerEl.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`;

    const x = e.pageX + 8;
    const y = rect.top + window.scrollY - 40;
    triggerEl.style.left = x + 'px';
    triggerEl.style.top = Math.max(y, rect.top + window.scrollY + 4) + 'px';

    triggerEl.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      removeTrigger();
      showTooltip(rect, selectedText);
    });

    document.body.appendChild(triggerEl);
  }

  function removeTrigger() {
    if (triggerEl) {
      triggerEl.remove();
      triggerEl = null;
    }
  }

  // ===== Tooltip =====
  function showTooltip(selectionRect, text) {
    removeTooltip();

    tooltipEl = document.createElement('div');
    tooltipEl.id = 'linguaflow-tooltip';
    tooltipEl.innerHTML = `
      <div class="lf-header">
        <div class="lf-brand">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
          AI Tool Box
        </div>
        <button class="lf-close" title="关闭">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="lf-source">${escapeHtml(text.length > 100 ? text.substring(0, 100) + '...' : text)}</div>
      <div class="lf-loading">
        <div class="lf-dots"><span></span><span></span><span></span></div>
        正在翻译...
      </div>
      <div class="lf-result" style="display:none;"></div>
      <div class="lf-footer" style="display:none;">
        <button class="lf-btn lf-copy-btn">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          复制
        </button>
      </div>
    `;

    document.body.appendChild(tooltipEl);

    // Position
    positionTooltip(selectionRect);

    // Close button
    tooltipEl.querySelector('.lf-close').addEventListener('click', removeTooltip);

    // Start translation
    translateForTooltip(text);
  }

  function positionTooltip(rect) {
    if (!tooltipEl) return;

    const tooltipRect = tooltipEl.getBoundingClientRect();
    let x = rect.left + window.scrollX;
    let y = rect.bottom + window.scrollY + 8;

    // Keep within viewport
    if (x + tooltipRect.width > window.innerWidth - 20) {
      x = window.innerWidth - tooltipRect.width - 20 + window.scrollX;
    }
    if (y + tooltipRect.height > window.innerHeight + window.scrollY - 20) {
      y = rect.top + window.scrollY - tooltipRect.height - 8;
    }

    tooltipEl.style.left = Math.max(x, 10) + 'px';
    tooltipEl.style.top = Math.max(y, 10) + 'px';
  }

  function removeTooltip() {
    if (tooltipEl) {
      tooltipEl.remove();
      tooltipEl = null;
    }
  }

  // ===== Translate =====
  async function translateForTooltip(text) {
    if (!config?.baseUrl || !config?.apiKey || !config?.model) {
      showResult('请先在插件设置中配置 API', true);
      return;
    }

    const srcLang = config.sourceLang || 'zh';
    const tgtLang = config.targetLang || 'en';

    const LANGUAGES = {
      zh: '中文', en: '英语', ja: '日语', ko: '韩语', fr: '法语',
      de: '德语', es: '西班牙语', pt: '葡萄牙语', ru: '俄语',
      ar: '阿拉伯语', it: '意大利语', nl: '荷兰语', th: '泰语',
      vi: '越南语', id: '印尼语', ms: '马来语', tr: '土耳其语',
      pl: '波兰语', sv: '瑞典语', da: '丹麦语', fi: '芬兰语',
      el: '希腊语', cs: '捷克语', ro: '罗马尼亚语', hu: '匈牙利语',
      uk: '乌克兰语', hi: '印地语', bn: '孟加拉语', he: '希伯来语', fa: '波斯语',
    };

    const systemPrompt = `You are a professional translator with deep expertise in linguistics, culture, and domain knowledge.

Translate from ${LANGUAGES[srcLang] || srcLang} (${srcLang}) to ${LANGUAGES[tgtLang] || tgtLang} (${tgtLang}).

CRITICAL WORKFLOW — follow this thinking process before translating:

**Step 1: Deep Context Analysis (think before you translate)**
Silently analyze the source text:
- **Domain & Topic**: What field? (technology, medicine, legal, literature, casual, news, academic, marketing, docs)
- **Text Type**: Formal document, informal chat, technical manual, creative writing, UI text, email?
- **Tone & Register**: Formal, informal, humorous, serious, persuasive, instructional, empathetic, neutral?
- **Audience**: General public, experts, children, business professionals?
- **Key Concepts**: Identify domain-specific terminology, idioms, cultural references requiring careful handling.
- **Intent**: Inform, persuade, entertain, instruct, or warn?

**Step 2: Translation with Context Awareness**
- Choose vocabulary appropriate for the identified domain and register
- Adapt idioms and cultural references to closest target-language equivalents
- Maintain the same tone and emotional weight as the original
- Use domain-standard terminology
- Preserve the author's voice and writing style

**Step 3: Format Preservation**
Preserve ALL original formatting: Markdown, HTML tags, line breaks, special characters, code snippets (do NOT translate code).

**Step 4: Consistency & Auto-Formatting**
- Maintain consistent terminology throughout
- Remove unnecessary blank lines and extra whitespace
- Ensure proper paragraph separation
- Fix any broken formatting from the source text
- Normalize list indentation and spacing

Output ONLY the translated and formatted text.`;

    try {
      // URL 归一化 + 推理模型参数自适应：与 AiService.chat() 同一模式（小工具见文件顶部）
      const url = lfNormalizeBaseUrl(config.baseUrl) + '/chat/completions';
      const reasoning = lfIsReasoningModel(config.model);
      async function translateReq(includeTemp) {
        const body = {
          model: config.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: text }
          ],
        };
        if (!reasoning && includeTemp) body.temperature = 0.3;
        return await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.apiKey}`,
          },
          body: JSON.stringify(body),
        });
      }

      let response = await translateReq(!reasoning);
      // 部分推理模型收到 temperature 仍报 400 → 去参重试一次
      if (!response.ok && !reasoning && response.status === 400) {
        const errText = await response.text().catch(() => '');
        if (/temperature/i.test(errText)) response = await translateReq(false);
      }

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error?.message || `HTTP ${response.status}`);
      }

      const data = await response.json();
      let result = data.choices?.[0]?.message?.content?.trim() || '';
      if (!result) throw new Error('翻译结果为空');

      // Auto-format the result
      result = autoFormatResult(result);

      showResult(result, false);
    } catch (err) {
      showResult('翻译失败: ' + err.message, true);
    }
  }

  function showResult(text, isError) {
    if (!tooltipEl) return;

    const loading = tooltipEl.querySelector('.lf-loading');
    const result = tooltipEl.querySelector('.lf-result');
    const footer = tooltipEl.querySelector('.lf-footer');

    if (loading) loading.style.display = 'none';
    result.style.display = 'block';
    result.textContent = text;
    if (isError) result.classList.add('error');

    if (!isError) {
      footer.style.display = 'flex';
      tooltipEl.querySelector('.lf-copy-btn').addEventListener('click', () => {
        navigator.clipboard.writeText(text).then(() => {
          const btn = tooltipEl.querySelector('.lf-copy-btn');
          btn.textContent = '已复制!';
          setTimeout(() => {
            btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> 复制`;
          }, 1500);
        });
      });
    }
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ===== Auto-Format Result =====
  function autoFormatResult(text) {
    // 1. Normalize line endings
    text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    
    // 2. Remove leading/trailing whitespace from each line
    text = text.split('\n').map(line => line.trimEnd()).join('\n');
    
    // 3. Collapse multiple blank lines into one
    text = text.replace(/\n{3,}/g, '\n\n');
    
    // 4. Remove leading/trailing blank lines
    text = text.replace(/^\n+/, '').replace(/\n+$/, '');
    
    // 5. Fix spacing around markdown headings
      text = text.replace(/([^\n])\n(#{1,6}\s)/g, '$1\n\n$2');
    
    // 6. Normalize list indentation
    text = text.replace(/^([\s]*[-*+])\s{2,}/gm, '$1 ');
    text = text.replace(/^([\s]*\d+\.)\s{2,}/gm, '$1 ');
    
    // 7. Ensure proper spacing after punctuation
    text = text.replace(/([。！？；])([^\n\s])/g, '$1 $2');
    
    // 8. Remove extra spaces before punctuation
    text = text.replace(/\s+([。！？，；：、])/g, '$1');
    
    // 9. Normalize code block spacing
    text = text.replace(/```\w*\n{2,}/g, '```\n');
    text = text.replace(/\n{2,}```/g, '\n```');
    
    return text;
  }

})();
