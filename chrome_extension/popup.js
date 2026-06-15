// ===== Languages =====
const LANGUAGES = [
  { code: 'zh', name: '中文' },
  { code: 'en', name: 'English' },
  { code: 'ja', name: '日本語' },
  { code: 'ko', name: '한국어' },
  { code: 'fr', name: 'Français' },
  { code: 'de', name: 'Deutsch' },
  { code: 'es', name: 'Español' },
  { code: 'pt', name: 'Português' },
  { code: 'ru', name: 'Русский' },
  { code: 'ar', name: 'العربية' },
  { code: 'it', name: 'Italiano' },
  { code: 'nl', name: 'Nederlands' },
  { code: 'th', name: 'ไทย' },
  { code: 'vi', name: 'Tiếng Việt' },
  { code: 'id', name: 'Indonesia' },
  { code: 'ms', name: 'Melayu' },
  { code: 'tr', name: 'Türkçe' },
  { code: 'pl', name: 'Polski' },
  { code: 'sv', name: 'Svenska' },
  { code: 'da', name: 'Dansk' },
  { code: 'fi', name: 'Suomi' },
  { code: 'el', name: 'Ελληνικά' },
  { code: 'cs', name: 'Čeština' },
  { code: 'ro', name: 'Română' },
  { code: 'hu', name: 'Magyar' },
  { code: 'uk', name: 'Українська' },
  { code: 'hi', name: 'हिन्दी' },
  { code: 'bn', name: 'বাংলা' },
  { code: 'he', name: 'עברית' },
  { code: 'fa', name: 'فارسی' },
];

// ===== DOM =====
const $ = id => document.getElementById(id);
const sourceLang = $('sourceLang');
const targetLang = $('targetLang');
const sourceText = $('sourceText');
const resultText = $('resultText');
const resultArea = $('resultArea');
const resultFooter = $('resultFooter');
const charCount = $('charCount');
const translateBtn = $('translateBtn');
const settingsPanel = $('settingsPanel');
const toast = $('toast');

// ===== Init =====
function init() {
  // Populate selects
  LANGUAGES.forEach(lang => {
    sourceLang.add(new Option(lang.name, lang.code));
    targetLang.add(new Option(lang.name, lang.code));
  });
  sourceLang.value = 'zh';
  targetLang.value = 'en';

  // Load config
  chrome.storage.local.get(['config'], ({ config }) => {
    if (config) {
      if (config.baseUrl) $('baseUrl').value = config.baseUrl;
      if (config.apiKey) $('apiKey').value = config.apiKey;
      if (config.model) $('modelName').value = config.model;
      $('enableSelectTranslate').checked = config.enableSelectTranslate !== false;
      if (config.sourceLang) sourceLang.value = config.sourceLang;
      if (config.targetLang) targetLang.value = config.targetLang;
    } else {
      // Show settings on first run
      settingsPanel.classList.add('open');
      $('toggleSettings').classList.add('active');
    }
  });

  // Restore draft text (auto-saved while typing)
  chrome.storage.local.get(['draft'], ({ draft }) => {
    if (draft?.sourceText) {
      sourceText.value = draft.sourceText;
      updateCharCount();
    }
    if (draft?.resultText) {
      resultText.textContent = draft.resultText;
      resultText.dataset.text = draft.resultText;
      resultArea.classList.add('visible');
      resultFooter.style.display = 'flex';
    }
  });

  // Check for text from content script (overrides draft)
  chrome.storage.local.get(['selectedText'], ({ selectedText }) => {
    if (selectedText) {
      sourceText.value = selectedText;
      updateCharCount();
      chrome.storage.local.remove('selectedText');
      // Auto translate
      setTimeout(() => doTranslate(), 100);
    }
  });
}

// ===== Settings =====
$('toggleSettings').addEventListener('click', () => {
  settingsPanel.classList.toggle('open');
  $('toggleSettings').classList.toggle('active');
});

$('saveSettings').addEventListener('click', () => {
  const config = {
    baseUrl: $('baseUrl').value.trim().replace(/\/+$/, ''),
    apiKey: $('apiKey').value.trim(),
    model: $('modelName').value.trim(),
    enableSelectTranslate: $('enableSelectTranslate').checked,
    sourceLang: sourceLang.value,
    targetLang: targetLang.value,
  };
  chrome.storage.local.set({ config }, () => {
    showToast('配置已保存', 'success');
    settingsPanel.classList.remove('open');
    $('toggleSettings').classList.remove('active');
    // Notify content script
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, {
          action: 'updateConfig',
          config
        }).catch(() => {});
      }
    });
  });
});

// Save language preference on change
sourceLang.addEventListener('change', saveLangPrefs);
targetLang.addEventListener('change', saveLangPrefs);

function saveLangPrefs() {
  chrome.storage.local.get(['config'], ({ config }) => {
    if (config) {
      config.sourceLang = sourceLang.value;
      config.targetLang = targetLang.value;
      chrome.storage.local.set({ config });
    }
  });
}

// ===== Swap =====
$('swapLangs').addEventListener('click', () => {
  [sourceLang.value, targetLang.value] = [targetLang.value, sourceLang.value];
  if (resultText.textContent && sourceText.value.trim()) {
    sourceText.value = resultText.dataset.text || '';
    updateCharCount();
  }
  saveLangPrefs();
});

// ===== Char count + Auto-save draft =====
let saveTimer = null;
sourceText.addEventListener('input', () => {
  updateCharCount();
  // Debounced auto-save (300ms after last keystroke)
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveDraft, 300);
});
function updateCharCount() {
  charCount.textContent = sourceText.value.length;
}
function saveDraft() {
  const draft = {
    sourceText: sourceText.value,
    resultText: resultText.dataset.text || '',
  };
  chrome.storage.local.set({ draft });
}

// ===== Clear =====
$('clearBtn').addEventListener('click', () => {
  sourceText.value = '';
  resultText.textContent = '';
  resultArea.classList.remove('visible');
  resultFooter.style.display = 'none';
  updateCharCount();
  sourceText.focus();
  // Clear saved draft
  chrome.storage.local.remove('draft');
});

// ===== Copy =====
$('copyBtn').addEventListener('click', () => {
  const text = resultText.dataset.text || resultText.textContent;
  if (!text) return;
  navigator.clipboard.writeText(text).then(
    () => showToast('已复制', 'success'),
    () => showToast('复制失败', 'error')
  );
});

// ===== Translate =====
translateBtn.addEventListener('click', doTranslate);
sourceText.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    doTranslate();
  }
});

async function doTranslate() {
  const text = sourceText.value.trim();
  if (!text) { showToast('请输入文本', 'error'); return; }

  const config = await getConfig();
  if (!config?.baseUrl || !config?.apiKey || !config?.model) {
    showToast('请先配置 API', 'error');
    settingsPanel.classList.add('open');
    $('toggleSettings').classList.add('active');
    return;
  }

  const src = LANGUAGES.find(l => l.code === sourceLang.value);
  const tgt = LANGUAGES.find(l => l.code === targetLang.value);

  translateBtn.disabled = true;
  translateBtn.innerHTML = '翻译中<span class="loading-dots"><span></span><span></span><span></span></span>';
  resultArea.classList.add('visible');
  resultFooter.style.display = 'none';
  resultText.textContent = '';
  resultText.classList.remove('error');

  const systemPrompt = `You are a professional translator. Translate from ${src.name} (${src.code}) to ${tgt.name} (${tgt.code}). Output ONLY the translated text. Preserve formatting and special characters.`;

  try {
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
    const result = data.choices?.[0]?.message?.content?.trim() || '';
    if (!result) throw new Error('翻译结果为空');

    await typeText(resultText, result);
    resultText.dataset.text = result;
    resultFooter.style.display = 'flex';
    // Save draft after successful translation
    saveDraft();
  } catch (err) {
    resultText.textContent = '翻译失败: ' + err.message;
    resultText.classList.add('error');
  } finally {
    translateBtn.disabled = false;
    translateBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg> 翻译`;
  }
}

// ===== Typing Effect =====
function typeText(el, text, speed = 15) {
  return new Promise(resolve => {
    el.textContent = '';
    el.classList.add('typing-cursor');
    let i = 0;
    const timer = setInterval(() => {
      if (i < text.length) {
        el.textContent += text[i];
        i++;
        el.scrollTop = el.scrollHeight;
      } else {
        clearInterval(timer);
        el.classList.remove('typing-cursor');
        resolve();
      }
    }, speed);
  });
}

// ===== Helpers =====
function getConfig() {
  return new Promise(resolve => {
    chrome.storage.local.get(['config'], ({ config }) => resolve(config || null));
  });
}

function showToast(msg, type) {
  toast.textContent = msg;
  toast.className = `toast ${type} show`;
  setTimeout(() => toast.classList.remove('show'), 2200);
}

// ===== Start =====
init();
