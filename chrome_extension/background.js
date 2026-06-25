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
    handleTranslation(msg.text, msg.config)
      .then(result => sendResponse({ success: true, result }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // async response
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

  const systemPrompt = `You are a professional translator. Translate from ${LANGUAGES[srcLang] || srcLang} (${srcLang}) to ${LANGUAGES[tgtLang] || tgtLang} (${tgtLang}).

IMPORTANT GUIDELINES:
1. **Context Understanding**: Carefully analyze the context, tone, and intended meaning before translating.
2. **Format Preservation**: Preserve ALL original formatting including Markdown syntax, HTML tags, line breaks, special characters, and code snippets (do NOT translate code).
3. **Natural Translation**: Produce fluent, natural-sounding translations that maintain the original intent.
4. **Consistency**: Maintain consistent terminology throughout.

Output ONLY the translated text with preserved formatting.`;

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
  return data.choices?.[0]?.message?.content?.trim() || '';
}
