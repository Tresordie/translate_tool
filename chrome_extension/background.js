// LinguaFlow - Background Service Worker

// Context menu for right-click translation
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'linguaflow-translate',
    title: 'LinguaFlow 翻译 "%s"',
    contexts: ['selection'],
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'linguaflow-translate' && info.selectionText) {
    // Store selected text and open popup-like behavior
    chrome.storage.local.set({ selectedText: info.selectionText }, () => {
      // Open popup to show translation
      chrome.action.openPopup();
    });
  }
});

// Handle messages from content script or popup
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'translate') {
    // Save translation task to storage so it persists even if popup closes
    const taskId = Date.now().toString();
    chrome.storage.local.set({
      translateTask: {
        id: taskId,
        status: 'running',
        text: msg.text,
        config: msg.config,
        srcCode: msg.srcCode,
        tgtCode: msg.tgtCode,
        startTime: Date.now(),
      }
    });

    handleTranslation(msg.text, msg.config)
      .then(result => {
        // Save result to storage (persists after popup closes)
        chrome.storage.local.set({
          translateTask: {
            id: taskId,
            status: 'done',
            result: result,
            text: msg.text,
            srcCode: msg.srcCode,
            tgtCode: msg.tgtCode,
            endTime: Date.now(),
          }
        });
        sendResponse({ success: true, result, taskId });
      })
      .catch(err => {
        chrome.storage.local.set({
          translateTask: {
            id: taskId,
            status: 'error',
            error: err.message,
            text: msg.text,
            srcCode: msg.srcCode,
            tgtCode: msg.tgtCode,
            endTime: Date.now(),
          }
        });
        sendResponse({ success: false, error: err.message });
      });
    return true; // async response
  }

  // Check if there's a pending translation result
  if (msg.action === 'checkTranslateResult') {
    chrome.storage.local.get(['translateTask'], ({ translateTask }) => {
      sendResponse(translateTask || null);
    });
    return true;
  }

  // Run AppleScript via native messaging host
  if (msg.action === 'runAppleScript') {
    handleAppleScriptViaNative(msg.script)
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
});

async function handleTranslation(text, config) {
  if (!config?.baseUrl || !config?.apiKey || !config?.model) {
    throw new Error('请先配置 API');
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

**Step 4: Consistency**
Maintain consistent terminology throughout.

Output ONLY the translated and formatted text.`;

  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: text }
      ],
      temperature: 0.3,
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `HTTP ${response.status}`);
  }

  const data = await response.json();
  let result = data.choices?.[0]?.message?.content?.trim() || '';
  
  // Auto-format the result
  result = autoFormatResult(result);
  
  return result;
}

// ===== Auto-Format Result =====
function autoFormatResult(text) {
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  text = text.split('\n').map(line => line.trimEnd()).join('\n');
  text = text.replace(/\n{3,}/g, '\n\n');
  text = text.replace(/^\n+/, '').replace(/\n+$/, '');
  text = text.replace(/([^\n])\n(#{1,6}\s)/g, '$1\n\n$2');
  text = text.replace(/^([\s]*[-*+])\s{2,}/gm, '$1 ');
  text = text.replace(/^([\s]*\d+\.)\s{2,}/gm, '$1 ');
  text = text.replace(/([。！？；])([^\n\s])/g, '$1 $2');
  text = text.replace(/\s+([。！？，；：、])/g, '$1');
  text = text.replace(/```\w*\n{2,}/g, '```\n');
  text = text.replace(/\n{2,}```/g, '\n```');
  return text;
}

// ===== Native Messaging: AppleScript =====
function handleAppleScriptViaNative(script) {
  return new Promise((resolve, reject) => {
    try {
      const port = chrome.runtime.connectNative('com.linguflow.reminders');
      let resolved = false;

      port.onMessage.addListener((response) => {
        if (!resolved) {
          resolved = true;
          port.disconnect();
          resolve(response);
        }
      });

      port.onDisconnect.addListener(() => {
        if (!resolved) {
          resolved = true;
          const err = chrome.runtime.lastError;
          if (err && err.message.includes('not found')) {
            resolve({
              success: false,
              needInstall: true,
              error: '原生宿主未安装。请先在终端运行: ./install_native_host.sh [扩展ID]'
            });
          } else {
            resolve({
              success: false,
              error: err ? err.message : '原生宿主连接断开'
            });
          }
        }
      });

      port.postMessage({ action: 'runAppleScript', script: script });
    } catch (e) {
      resolve({ success: false, error: e.message });
    }
  });
}
