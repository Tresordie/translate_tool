// LinguaFlow - Background Service Worker

// Context menu for right-click translation
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'linguaflow-translate',
    title: 'AI Tool Box 翻译 "%s"',
    contexts: ['selection'],
  });
  // 侧边栏入口（Chrome 114+ Side Panel API）
  if (chrome.sidePanel) {
    chrome.contextMenus.create({
      id: 'linguaflow-open-side-panel',
      title: '在侧边栏打开 AI Tool Box',
      contexts: ['all'],
    });
  }
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'linguaflow-open-side-panel') {
    // 用户手势：可直接打开侧边栏
    if (chrome.sidePanel && tab && tab.windowId != null) {
      chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
    }
    return;
  }
  if (info.menuItemId === 'linguaflow-translate' && info.selectionText) {
    // Store selected text and open popup-like behavior
    chrome.storage.local.set({ selectedText: info.selectionText }, () => {
      // Open popup to show translation
      chrome.action.openPopup();
    });
  }
});

// ===== 键盘快捷键：打开侧边栏（Alt+Shift+L） =====
chrome.commands.onCommand.addListener((command) => {
  if (command === 'open-side-panel' && chrome.sidePanel) {
    chrome.windows.getCurrent({}, (win) => {
      if (win && win.id != null) {
        chrome.sidePanel.open({ windowId: win.id }).catch(() => {});
      }
    });
  }
});

// ===== 配置同步：任何扩展页面保存 config 后，广播给所有已打开的网页 =====
// 网页无法直接访问 chrome.storage，由各页面注入的 content script 接收
// 本消息，写入 localStorage('translate_config') 并通知页面 JS。
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;

  // API 配置同步（v0.23.0）
  if (changes.config) {
    const config = changes.config.newValue;
    if (config && config.baseUrl) {
      chrome.tabs.query({}, (tabs) => {
        for (const tab of tabs) {
          if (tab.id == null) continue;
          chrome.tabs.sendMessage(tab.id, { action: 'linguaflow:syncConfig', config }).catch(() => {});
        }
      });
    }
  }

  // 记录双向同步（v0.25.0）：chrome.storage 键 → 各网页标签页的 localStorage 键
  // （content.js 写入 localStorage 后，页面既有的 storage 事件监听会自动刷新 UI）
  for (const sk of Object.keys(RECORD_SYNC_KEYS)) {
    const ch = changes[sk];
    if (!ch || ch.newValue === undefined) continue;
    const lsKey = RECORD_SYNC_KEYS[sk];
    chrome.tabs.query({}, (tabs) => {
      for (const tab of tabs) {
        if (tab.id == null) continue;
        chrome.tabs.sendMessage(tab.id, { action: 'linguaflow:syncRecord', lsKey, key: sk, value: ch.newValue }).catch(() => {});
      }
    });
  }
});

// ===== 记录双向同步映射表（v0.25.0）：chrome.storage 键 → 网页 localStorage 键 =====
const RECORD_SYNC_KEYS = {
  todo_items: 'td_todo_items',              // 任务清单
  todo_cal_config: 'td_todo_cal_config',    // 任务清单日历配置
  hn_cards: 'hn_cards',                     // 热点雷达卡片
  history: 'translate_history',             // 智能翻译历史（popup/fullpage ↔ index）
  draft: 'translate_draft',                 // 智能翻译草稿（popup/fullpage ↔ index）
  work_records: 'wr_work_records',          // 工作报告记录
  work_summaries: 'wr_work_summaries',      // 工作报告 AI 总结
  work_config: 'wr_work_config',            // 工作报告配置
  work_draft: 'wr_work_draft',              // 工作报告草稿
  email_summary_history: 'email_summary_history', // 邮件总结历史
  email_summary_config: 'email_summary_config',   // 邮件总结配置
  learningHistory: 'learningHistory',       // 英语学习历史
  englishLearningData: 'englishLearningData',     // 英语学习内容
  ai_parse_state: 'ai_parse_state',         // AI 解析状态
  ai_prompts_state: 'ai_prompts_state',     // AI 提示词状态
};

// Handle messages from content script or popup
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // 网页版跨域代理桥（v0.23.0）：无 CORS 端点的请求经 background（host_permissions 免跨域）转发
  if (msg.action === 'linguaflow:proxyFetch') {
    (async () => {
      try {
        const r = await fetch(msg.url, {
          method: msg.method || 'GET',
          headers: msg.headers || {},
          body: msg.method && msg.method !== 'GET' ? msg.body : undefined,
        });
        const text = await r.text();
        sendResponse({ ok: r.ok, status: r.status, text });
      } catch (e) {
        sendResponse({ ok: false, status: 0, error: (e && e.message) || 'fetch failed' });
      }
    })();
    return true; // async response
  }

  // 网页保存配置反向同步（v0.23.0）：content.js 中继 → 写 chrome.storage → 扩展弹窗/侧边栏实时同步
  if (msg.action === 'linguaflow:saveConfig') {
    if (msg.config && msg.config.baseUrl) {
      chrome.storage.local.set({ config: { baseUrl: msg.config.baseUrl, apiKey: msg.config.apiKey, model: msg.config.model } }, () => {});
    }
    sendResponse({ ok: true });
    return;
  }

  // 网页记录反向同步（v0.25.0）：content.js 中继 → 写 chrome.storage → 扩展侧同步
  if (msg.action === 'linguaflow:saveRecord') {
    if (msg.key && RECORD_SYNC_KEYS[msg.key] && msg.value !== undefined) {
      const patch = {};
      patch[msg.key] = msg.value;
      chrome.storage.local.set(patch, () => {});
    }
    sendResponse({ ok: true });
    return;
  }

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
    return '无法连接 API：网络异常或 API 服务不可达，请检查 Base URL 与网络';
  }
  return msg || '未知错误，请稍后重试';
}

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
    const e = new Error(err.error?.message || `HTTP ${response.status}`);
    e.status = response.status;
    throw new Error(describeApiError(e));
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
