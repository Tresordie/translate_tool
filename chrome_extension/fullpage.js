// ===== Generate Stars =====
(function() {
  const container = document.getElementById('stars');
  for (let i = 0; i < 60; i++) {
    const star = document.createElement('div');
    star.className = 'star';
    star.style.left = Math.random() * 100 + '%';
    star.style.top = Math.random() * 100 + '%';
    star.style.animationDelay = Math.random() * 3 + 's';
    star.style.animationDuration = (2 + Math.random() * 3) + 's';
    star.style.width = star.style.height = (1 + Math.random() * 2) + 'px';
    container.appendChild(star);
  }
})();

// ===== Languages =====
const LANGUAGES = [
  { code: 'zh', name: '中文', flag: '🇨🇳' },
  { code: 'en', name: '英语', flag: '🇺🇸' },
  { code: 'ja', name: '日语', flag: '🇯' },
  { code: 'ko', name: '韩语', flag: '🇰🇷' },
  { code: 'fr', name: '法语', flag: '🇷' },
  { code: 'de', name: '德语', flag: '🇪' },
  { code: 'es', name: '西班牙语', flag: '🇸' },
  { code: 'pt', name: '葡萄牙语', flag: '🇵🇹' },
  { code: 'ru', name: '俄语', flag: '🇷' },
  { code: 'ar', name: '阿拉伯语', flag: '🇦' },
  { code: 'it', name: '意大利语', flag: '🇮🇹' },
  { code: 'nl', name: '荷兰语', flag: '🇳🇱' },
  { code: 'th', name: '泰语', flag: '🇹' },
  { code: 'vi', name: '越南语', flag: '🇳' },
  { code: 'id', name: '印尼语', flag: '🇮🇩' },
  { code: 'ms', name: '马来语', flag: '🇲🇾' },
  { code: 'tr', name: '土耳其语', flag: '🇷' },
  { code: 'pl', name: '波兰语', flag: '🇵🇱' },
  { code: 'sv', name: '瑞典语', flag: '🇸🇪' },
  { code: 'da', name: '丹麦语', flag: '🇰' },
  { code: 'fi', name: '芬兰语', flag: '🇫🇮' },
  { code: 'el', name: '希腊语', flag: '🇬🇷' },
  { code: 'cs', name: '捷克语', flag: '🇨🇿' },
  { code: 'ro', name: '罗马尼亚语', flag: '🇷🇴' },
  { code: 'hu', name: '匈牙利语', flag: '🇭' },
  { code: 'uk', name: '乌克兰语', flag: '🇺🇦' },
  { code: 'hi', name: '印地语', flag: '🇮' },
  { code: 'bn', name: '孟加拉语', flag: '🇧🇩' },
  { code: 'he', name: '希伯来语', flag: '🇮🇱' },
  { code: 'fa', name: '波斯语', flag: '🇮🇷' },
];

// ===== State =====
let config = {};
let history = [];

// ===== Init =====
async function init() {
  const sourceLang = document.getElementById('sourceLang');
  const targetLang = document.getElementById('targetLang');

  LANGUAGES.forEach(lang => {
    sourceLang.add(new Option(`${lang.flag}  ${lang.name}`, lang.code));
    targetLang.add(new Option(`${lang.flag}  ${lang.name}`, lang.code));
  });

  sourceLang.value = 'zh';
  targetLang.value = 'en';

  // Load state from chrome.storage.local
  const data = await chrome.storage.local.get(['config', 'history', 'draft']);

  if (data.config) {
    config = data.config;
    if (config.baseUrl) document.getElementById('baseUrl').value = config.baseUrl;
    if (config.apiKey) document.getElementById('apiKey').value = config.apiKey;
    if (config.model) document.getElementById('modelName').value = config.model;
    if (config.sourceLang) sourceLang.value = config.sourceLang;
    if (config.targetLang) targetLang.value = config.targetLang;
  }

  if (!config.apiKey) {
    document.getElementById('settingsPanel').classList.add('open');
  }

  // Restore draft
  if (data.draft) {
    const draft = data.draft;
    if (draft.sourceText) {
      document.getElementById('sourceText').value = draft.sourceText;
      updateCharCount();
    }
    if (draft.resultText) {
      const output = document.getElementById('outputText');
      output.textContent = draft.resultText;
      output.dataset.text = draft.resultText;
    }
    if (draft.sourceLang) sourceLang.value = draft.sourceLang;
    if (draft.targetLang) targetLang.value = draft.targetLang;
  }

  // Load history
  history = data.history || [];
  renderHistory();
}

// ===== Settings =====
function toggleSettings() {
  document.getElementById('settingsPanel').classList.toggle('open');
}

function saveSettings() {
  config.baseUrl = document.getElementById('baseUrl').value.trim().replace(/\/+$/, '');
  config.apiKey = document.getElementById('apiKey').value.trim();
  config.model = document.getElementById('modelName').value.trim();
  config.sourceLang = document.getElementById('sourceLang').value;
  config.targetLang = document.getElementById('targetLang').value;
  chrome.storage.local.set({ config });
  showToast('配置已保存', 'success');
  setTimeout(() => document.getElementById('settingsPanel').classList.remove('open'), 600);
}

// ===== Swap =====
function swapLanguages() {
  const s = document.getElementById('sourceLang');
  const t = document.getElementById('targetLang');
  [s.value, t.value] = [t.value, s.value];

  const output = document.getElementById('outputText');
  const source = document.getElementById('sourceText');
  if (output.dataset.text && source.value.trim()) {
    source.value = output.dataset.text;
    updateCharCount();
  }
}

// ===== Typing Effect =====
function typeText(element, text, speed = 18) {
  return new Promise(resolve => {
    element.innerHTML = '';
    element.classList.add('typing-cursor');
    let i = 0;
    const timer = setInterval(() => {
      if (i < text.length) {
        element.textContent += text[i];
        i++;
        element.scrollTop = element.scrollHeight;
      } else {
        clearInterval(timer);
        element.classList.remove('typing-cursor');
        element.dataset.text = text;
        resolve();
      }
    }, speed);
  });
}

// ===== Translate =====
async function doTranslate() {
  const text = document.getElementById('sourceText').value.trim();
  if (!text) { showToast('请输入要翻译的文本', 'error'); return; }
  if (!config.baseUrl || !config.apiKey || !config.model) {
    showToast('请先配置 API 设置', 'error');
    document.getElementById('settingsPanel').classList.add('open');
    return;
  }

  const sourceLang = LANGUAGES.find(l => l.code === document.getElementById('sourceLang').value);
  const targetLang = LANGUAGES.find(l => l.code === document.getElementById('targetLang').value);

  const btn = document.getElementById('translateBtn');
  const status = document.getElementById('statusText');
  const output = document.getElementById('outputText');
  const loadingBar = document.getElementById('loadingBar');

  btn.disabled = true;
  btn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v4m0 12v4m-7.07-3.93l2.83-2.83m8.48-8.48l2.83-2.83M2 12h4m12 0h4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83"/></svg> 翻译中...';
  status.textContent = `${sourceLang.flag} ${sourceLang.name}  →  ${targetLang.flag} ${targetLang.name}`;
  output.innerHTML = '';
  delete output.dataset.text;
  loadingBar.classList.add('active');

  const systemPrompt = `You are a professional translator with deep expertise in ${sourceLang.name} and ${targetLang.name} linguistics, culture, and domain knowledge.

Your task is to translate text from ${sourceLang.name} (${sourceLang.code}) to ${targetLang.name} (${targetLang.code}).

CRITICAL WORKFLOW — You MUST follow this thinking process before translating:

**Step 1: Deep Context Analysis (think before you translate)**
Before producing any translation, silently analyze the source text:
- **Domain & Topic**: What field does this text belong to? (e.g., technology, medicine, legal, literature, casual conversation, news, academic paper, marketing, software documentation)
- **Text Type**: Is it a formal document, informal chat, technical manual, creative writing, UI text, email, or social media post?
- **Tone & Register**: Is the tone formal, informal, humorous, serious, persuasive, instructional, empathetic, or neutral?
- **Audience**: Who is the intended reader? (e.g., general public, experts, children, business professionals)
- **Key Concepts**: Identify domain-specific terminology, idioms, cultural references, and nuanced expressions that require careful handling.
- **Intent**: What is the author trying to achieve? (inform, persuade, entertain, instruct, warn)

**Step 2: Translation with Context Awareness**
Based on your analysis:
- Choose vocabulary and expressions appropriate for the identified domain and register
- Adapt idioms and cultural references to their closest equivalents in the target language
- Maintain the same tone and emotional weight as the original
- Use domain-standard terminology (e.g., medical terms stay medical, tech terms stay tech)
- Preserve the author's voice and writing style

**Step 3: Format Preservation**
Preserve ALL original formatting including:
- Markdown syntax (headings, bold, italic, lists, code blocks, links, etc.)
- HTML tags and attributes
- Line breaks and spacing
- Special characters and symbols
- Code snippets (do NOT translate code, variable names, or function names)

**Step 4: Consistency**
Maintain consistent terminology throughout the translation. If a term appears multiple times, translate it the same way each time.

**Step 5: Auto-Formatting**
After translation, automatically organize and format the output:
- Remove unnecessary blank lines and extra whitespace
- Ensure proper paragraph separation (single blank line between paragraphs)
- Fix any broken formatting from the source text
- Normalize list indentation and spacing
- Ensure consistent heading levels
- Clean up any redundant punctuation

Output ONLY the translated and formatted text. Do not add explanations, notes, or your analysis process.`;

  try {
    const url = `${config.baseUrl}/chat/completions`;
    const response = await fetch(url, {
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
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error?.message || `HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    let result = data.choices?.[0]?.message?.content?.trim() || '';

    if (!result) throw new Error('翻译结果为空，请检查模型配置');

    // Auto-format the result
    result = autoFormatResult(result);

    loadingBar.classList.remove('active');
    await typeText(output, result);

    addHistory(sourceLang, targetLang, text, result);
    status.textContent = `翻译完成  ${sourceLang.flag} → ${targetLang.flag}`;
    saveDraft();
  } catch (err) {
    loadingBar.classList.remove('active');
    output.innerHTML = `<span class="output-placeholder" style="color:#ef4444;">翻译失败: ${escapeHtml(err.message)}</span>`;
    status.textContent = '翻译失败';
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg> 开始翻译';
  }
}

// ===== History =====
function addHistory(src, tgt, text, result) {
  history.unshift({
    srcLang: src.name, tgtLang: tgt.name,
    srcFlag: src.flag, tgtFlag: tgt.flag,
    srcCode: src.code, tgtCode: tgt.code,
    text: text,
    result: result,
    time: new Date().toLocaleString('zh-CN'),
  });
  if (history.length > 20) history = history.slice(0, 20);
  chrome.storage.local.set({ history });
  renderHistory();
}

function renderHistory() {
  const card = document.getElementById('historyCard');
  const list = document.getElementById('historyList');
  if (history.length === 0) { card.classList.remove('visible'); return; }

  card.classList.add('visible');
  list.innerHTML = history.map((h, i) => `
    <div class="history-item" data-index="${i}">
      <div class="history-item-content">
        <div class="hi-meta">
          <span>${h.srcFlag} ${h.srcLang}</span>
          <span class="hi-arrow">→</span>
          <span>${h.tgtFlag} ${h.tgtLang}</span>
          <span class="hi-time">${h.time}</span>
        </div>
        <div class="hi-text">${escapeHtml(h.text)}</div>
      </div>
      <button class="hi-delete" data-index="${i}" title="删除">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
        </svg>
      </button>
    </div>
  `).join('');
}

// Event delegation for history list clicks
function handleHistoryClick(e) {
  const deleteBtn = e.target.closest('.hi-delete');
  if (deleteBtn) {
    e.stopPropagation();
    const index = parseInt(deleteBtn.dataset.index);
    deleteHistoryItem(index);
    return;
  }
  const item = e.target.closest('.history-item');
  if (item) {
    const index = parseInt(item.dataset.index);
    loadHistory(index);
  }
}

function loadHistory(index) {
  const h = history[index];
  document.getElementById('sourceLang').value = h.srcCode;
  document.getElementById('targetLang').value = h.tgtCode;
  document.getElementById('sourceText').value = h.text;
  updateCharCount();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function clearHistory() {
  history = [];
  chrome.storage.local.remove('history');
  renderHistory();
}

function deleteHistoryItem(index) {
  history.splice(index, 1);
  chrome.storage.local.set({ history });
  renderHistory();
}

// ===== Utility =====
let _draftTimer = null;
function updateCharCount() {
  const text = document.getElementById('sourceText').value;
  document.getElementById('charCount').textContent = `${text.length} 字符`;
  // Auto-save draft (debounced 300ms)
  clearTimeout(_draftTimer);
  _draftTimer = setTimeout(saveDraft, 300);
}
function saveDraft() {
  const draft = {
    sourceText: document.getElementById('sourceText').value,
    resultText: document.getElementById('outputText').dataset.text || '',
    sourceLang: document.getElementById('sourceLang').value,
    targetLang: document.getElementById('targetLang').value,
  };
  chrome.storage.local.set({ draft });
}

function clearSource() {
  document.getElementById('sourceText').value = '';
  document.getElementById('outputText').innerHTML = '<span class="output-placeholder">翻译结果将显示在这里...</span>';
  document.getElementById('outputText').dataset.text = '';
  document.getElementById('statusText').textContent = '';
  updateCharCount();
  // Clear saved draft
  chrome.storage.local.remove('draft');
}

async function pasteFromClipboard() {
  try {
    const text = await navigator.clipboard.readText();
    document.getElementById('sourceText').value = text;
    updateCharCount();
    showToast('已粘贴', 'success');
  } catch {
    showToast('无法读取剪贴板', 'error');
  }
}

function copyResult() {
  const output = document.getElementById('outputText');
  const text = output.dataset.text || output.textContent;
  if (!text || text.includes('翻译结果将显示在这里')) {
    showToast('没有可复制的内容', 'error');
    return;
  }
  navigator.clipboard.writeText(text).then(
    () => showToast('已复制到剪贴板', 'success'),
    () => showToast('复制失败', 'error')
  );
}

function showToast(msg, type) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.className = `toast ${type} show`;
  setTimeout(() => toast.classList.remove('show'), 2800);
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
  
  // 5. Fix spacing around markdown headings (ensure blank line before heading)
  text = text.replace(/([^\n])\n(#{1,6}\s)/g, '$1\n\n$2');
  
  // 6. Normalize list indentation (ensure consistent spacing after list markers)
  text = text.replace(/^([\s]*[-*+])\s{2,}/gm, '$1 ');
  text = text.replace(/^([\s]*\d+\.)\s{2,}/gm, '$1 ');
  
  // 7. Ensure proper spacing after punctuation (Chinese/English)
  text = text.replace(/([。！？；])([^\n\s])/g, '$1 $2');
  
  // 8. Remove extra spaces before punctuation
  text = text.replace(/\s+([。！？，；：、])/g, '$1');
  
  // 9. Normalize code block spacing
  text = text.replace(/```\w*\n{2,}/g, '```\n');
  text = text.replace(/\n{2,}```/g, '\n```');
  
  return text;
}

// ===== Event Bindings =====
function bindEvents() {
  document.getElementById('settingsBtn').addEventListener('click', toggleSettings);
  document.getElementById('saveSettingsBtn').addEventListener('click', saveSettings);
  document.getElementById('swapBtn').addEventListener('click', swapLanguages);
  document.getElementById('sourceText').addEventListener('input', updateCharCount);
  document.getElementById('clearSourceBtn').addEventListener('click', clearSource);
  document.getElementById('pasteBtn').addEventListener('click', pasteFromClipboard);
  document.getElementById('copyResultBtn').addEventListener('click', copyResult);
  document.getElementById('translateBtn').addEventListener('click', doTranslate);
  document.getElementById('clearHistoryBtn').addEventListener('click', clearHistory);

  // History list event delegation
  document.getElementById('historyList').addEventListener('click', handleHistoryClick);

  // Keyboard shortcut
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      doTranslate();
    }
  });
}

// ===== Start =====
init().then(bindEvents);
