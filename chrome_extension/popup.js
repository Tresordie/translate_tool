// Google Fonts 异步启用：MV3 CSP 禁止 inline onload，改由 JS 在字体样式表加载完成后切换 media
(function () {
  var gf = document.getElementById('gfAsync');
  if (gf) gf.addEventListener('load', function () { gf.media = 'all'; });
})();
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
const $ = id => { const el = document.getElementById(id); if (!el) console.error("[Popup] #"+id+" not found"); return el; };
const safeBind = (id, event, fn) => {
  const el = $(id);
  if (el) el.addEventListener(event, fn);
};

const sourceLang = $('sourceLang');
const targetLang = $('targetLang');
const srcEditor = MdEditor.create($('sourceEditor'), {
  placeholder: '请输入要翻译的文本...',
  onInput: () => {
    updateCharCount();
    // Debounced auto-save (300ms after last keystroke)
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveDraft, 300);
  }
});
const resultText = $('resultText');
const resultArea = $('resultArea');
const resultFooter = $('resultFooter');
const charCount = $('charCount');
const translateBtn = $('translateBtn');
const settingsPanel = $('settingsPanel');
const toast = $('toast');
const historySection = $('historySection');
const historyList = $('historyList');

// ===== History State =====
let history = [];

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
      srcEditor.setMarkdown(draft.sourceText);
      updateCharCount();
    }
    if (draft?.resultText) {
      renderResult(draft.resultText);
      resultArea.classList.add('visible');
      resultFooter.style.display = 'flex';
    }
  });

  // Load history
  chrome.storage.local.get(['history'], ({ history: h }) => {
    history = h || [];
    renderHistory();
  });

  // Restore popup size
  chrome.storage.local.get(['popupSize'], ({ popupSize }) => {
    if (popupSize) {
      document.body.style.width = popupSize.width + 'px';
      document.body.style.height = popupSize.height + 'px';
    }
  });

  // Check for text from content script (overrides draft)
  chrome.storage.local.get(['selectedText'], ({ selectedText }) => {
    if (selectedText) {
      srcEditor.setMarkdown(selectedText);
      updateCharCount();
      chrome.storage.local.remove('selectedText');
      // Auto translate
      setTimeout(() => doTranslate(), 100);
      return;
    }
  });

  // Check for pending/completed background translation
  restoreTranslateResult();
}

// ===== Settings =====
safeBind('toggleSettings', 'click', () => {
  settingsPanel.classList.toggle('open');
  $('toggleSettings').classList.toggle('active');
});

// Open side panel (Chrome 114+)
safeBind('openSidePanel', 'click', () => {
  if (chrome.sidePanel) {
    chrome.windows.getCurrent({}, (win) => {
      if (win && win.id != null) chrome.sidePanel.open({ windowId: win.id });
    });
  } else {
    showToast('当前浏览器不支持 Side Panel（需 Chrome 114+）', 'error');
  }
});

// Open full screen in new tab
safeBind('openFullscreen', 'click', () => {
  const fullPageUrl = chrome.runtime.getURL('fullpage.html');
  chrome.tabs.create({ url: fullPageUrl });
});

// Open todo list in new tab
safeBind('openTodoList', 'click', () => {
  const todoUrl = chrome.runtime.getURL('todolist.html');
  chrome.tabs.create({ url: todoUrl });
});

// Open work report in new tab
safeBind('openWorkReport', 'click', () => {
  const reportUrl = chrome.runtime.getURL('workreport.html');
  chrome.tabs.create({ url: reportUrl });
});

// Open English learning in new tab
safeBind('openEnglishLearning', 'click', () => {
  const englishUrl = chrome.runtime.getURL('english_learning.html');
  chrome.tabs.create({ url: englishUrl });
});

// Open email summary in new tab
safeBind('openEmailSummary', 'click', () => {
  const emailUrl = chrome.runtime.getURL('email_summary.html');
  chrome.tabs.create({ url: emailUrl });
});

// Open AI Parse in new tab
safeBind('openAiParse', 'click', () => {
  const parseUrl = chrome.runtime.getURL('ai_parse.html');
  chrome.tabs.create({ url: parseUrl });
});

// Open AI Prompts in new tab
safeBind('openAiPrompts', 'click', () => {
  const promptsUrl = chrome.runtime.getURL('ai_prompts.html');
  chrome.tabs.create({ url: promptsUrl });
});

// Open Hot News Radar in new tab
safeBind('openHotNews', 'click', () => {
  const hotnewsUrl = chrome.runtime.getURL('hotnews.html');
  chrome.tabs.create({ url: hotnewsUrl });
});

safeBind('saveSettings', 'click', () => {
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
safeBind('swapLangs', 'click', () => {
  [sourceLang.value, targetLang.value] = [targetLang.value, sourceLang.value];
  if (resultText.dataset.text && srcEditor.getMarkdown().trim()) {
    srcEditor.setMarkdown(resultText.dataset.text || '');
    updateCharCount();
  }
  saveLangPrefs();
});

// ===== Char count + Auto-save draft =====
let saveTimer = null;
function updateCharCount() {
  charCount.textContent = srcEditor.getMarkdown().length;
  updateMdPreview();
}
function saveDraft() {
  const draft = {
    sourceText: srcEditor.getMarkdown(),
    resultText: resultText.dataset.text || '',
  };
  chrome.storage.local.set({ draft });
}

// ===== Clear =====
safeBind('clearBtn', 'click', () => {
  srcEditor.clear();
  resultText.textContent = '';
  delete resultText.dataset.text;
  resultArea.classList.remove('visible');
  resultFooter.style.display = 'none';
  updateCharCount();
  srcEditor.focus();
  updateMdPreview();
  // Clear saved draft
  chrome.storage.local.remove('draft');
});

// ===== Copy =====
safeBind('copyBtn', 'click', () => {
  const text = resultText.dataset.text || resultText.textContent;
  if (!text) return;
  navigator.clipboard.writeText(text).then(
    () => showToast('已复制', 'success'),
    () => showToast('复制失败', 'error')
  );
});

// ===== Translate =====
translateBtn.addEventListener('click', doTranslate);
srcEditor.container.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    doTranslate();
  }
});

// ===== Restore Background Translation Result =====
function restoreTranslateResult() {
  chrome.storage.local.get(['translateTask', 'translatingState'], (data) => {
    const task = data.translateTask;
    const state = data.translatingState;

    // If there's a completed translation result from background
    if (task && task.status === 'done' && state) {
      // Only restore if it matches our current state or is recent (< 5 min)
      const isRecent = (Date.now() - task.endTime) < 5 * 60 * 1000;
      const isMatch = state.text === task.text;
      if (isRecent || isMatch) {
        const result = task.result;
        if (result) {
          renderResult(result);
          resultArea.classList.add('visible');
          resultFooter.style.display = 'flex';
          // Add to history
          const src = LANGUAGES.find(l => l.code === task.srcCode) || LANGUAGES[0];
          const tgt = LANGUAGES.find(l => l.code === task.tgtCode) || LANGUAGES[1];
          addHistory(src, tgt, task.text, result);
          saveDraft();
        }
        chrome.storage.local.remove(['translateTask', 'translatingState']);
        return;
      }
    }

    // If translation is still running in background
    if (task && task.status === 'running' && state) {
      // Show loading state
      srcEditor.setMarkdown(state.text || '');
      updateCharCount();
      if (state.srcCode) sourceLang.value = state.srcCode;
      if (state.tgtCode) targetLang.value = state.tgtCode;
      translateBtn.disabled = true;
      translateBtn.innerHTML = '\u7ffb\u8bd1\u4e2d<span class="loading-dots"><span></span><span></span><span></span></span>';
      resultArea.classList.add('visible');
      resultFooter.style.display = 'none';
      resultText.textContent = '';
      resultText.classList.remove('error');

      // Poll for result every 500ms
      const pollInterval = setInterval(() => {
        chrome.storage.local.get(['translateTask'], ({ translateTask }) => {
          if (!translateTask || translateTask.id !== task.id) return;

          if (translateTask.status === 'done') {
            clearInterval(pollInterval);
            translateBtn.disabled = false;
            translateBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg> \u5f00\u59cb\u7ffb\u8bd1<span class="btn-shortcut">Ctrl+\u21b5</span>';
            const result = translateTask.result;
            if (result) {
              renderResult(result);
              resultFooter.style.display = 'flex';
              const src = LANGUAGES.find(l => l.code === translateTask.srcCode) || LANGUAGES[0];
              const tgt = LANGUAGES.find(l => l.code === translateTask.tgtCode) || LANGUAGES[1];
              addHistory(src, tgt, translateTask.text, result);
              saveDraft();
            }
            chrome.storage.local.remove(['translateTask', 'translatingState']);
          } else if (translateTask.status === 'error') {
            clearInterval(pollInterval);
            translateBtn.disabled = false;
            translateBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg> \u5f00\u59cb\u7ffb\u8bd1<span class="btn-shortcut">Ctrl+\u21b5</span>';
            resultText.textContent = '\u7ffb\u8bd1\u5931\u8d25: ' + translateTask.error;
            resultText.classList.add('error');
            chrome.storage.local.remove(['translateTask', 'translatingState']);
          }
          // If still running, keep polling
        });
      }, 500);

      // Stop polling after 60 seconds max
      setTimeout(() => {
        clearInterval(pollInterval);
        if (translateBtn.disabled) {
          translateBtn.disabled = false;
          translateBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg> \u5f00\u59cb\u7ffb\u8bd1<span class="btn-shortcut">Ctrl+\u21b5</span>';
          resultText.textContent = '\u7ffb\u8bd1\u8d85\u65f6';
          resultText.classList.add('error');
        }
      }, 60000);
      return;
    }

    // Clean up stale state
    if (state && !task) {
      chrome.storage.local.remove('translatingState');
    }
  });
}

async function doTranslate() {
  const text = srcEditor.getMarkdown().trim();
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

  // Save state before translation (in case popup closes)
  chrome.storage.local.set({
    translatingState: {
      text: text,
      srcCode: src.code,
      tgtCode: tgt.code,
      timestamp: Date.now(),
    }
  });

  try {
    // Send translation request to background service worker
    const response = await chrome.runtime.sendMessage({
      action: 'translate',
      text: text,
      config: config,
      srcCode: src.code,
      tgtCode: tgt.code,
    });

    if (!response.success) {
      throw new Error(response.error);
    }

    const result = response.result;
    if (!result) throw new Error('翻译结果为空');

    // Clear the translating state
    chrome.storage.local.remove('translatingState');

    renderResult(result);
    resultFooter.style.display = 'flex';
    saveDraft();
    addHistory(src, tgt, text, result);
  } catch (err) {
    chrome.storage.local.remove('translatingState');
    resultText.textContent = '翻译失败: ' + err.message;
    resultText.classList.add('error');
  } finally {
    translateBtn.disabled = false;
    translateBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg> 开始翻译<span class="btn-shortcut">Ctrl+↵</span>`;
  }
}

// ===== Render Result (Markdown + fade-in) =====
function renderResult(text) {
  resultText.classList.remove('md-fade-in', 'error');
  void resultText.offsetWidth;
  resultText.innerHTML = renderMarkdown(text);
  resultText.dataset.text = text;
  resultText.classList.add('md-fade-in');
}

// ===== Auto-Format Result =====
function autoFormatResult(text) {
  // 1. Normalize line endings
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  // 2. Remove trailing whitespace from each line
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

// ===== History Management =====
function addHistory(src, tgt, text, result) {
  history.unshift({
    srcLang: src.name,
    tgtLang: tgt.name,
    srcCode: src.code,
    tgtCode: tgt.code,
    text: text,
    result: result,
    time: new Date().toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
  });
  if (history.length > 20) history = history.slice(0, 20);
  chrome.storage.local.set({ history });
  renderHistory();
}

function renderHistory() {
  if (history.length === 0) {
    historySection.classList.remove('visible');
    return;
  }
  historySection.classList.add('visible');
  historyList.innerHTML = history.map((h, i) => `
    <div class="history-item" data-index="${i}">
      <div class="hi-meta">
        <span>${h.srcLang}</span>
        <span class="hi-arrow">→</span>
        <span>${h.tgtLang}</span>
        <span class="hi-time">${h.time}</span>
      </div>
      <div class="hi-text md-rendered">${renderMarkdown(h.text)}</div>
      <div class="hi-text md-rendered">${renderMarkdown(h.result)}</div>
      <button class="hi-delete" data-index="${i}" title="删除">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
        </svg>
      </button>
    </div>
  `).join('');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ===== Markdown Live Preview =====
let _mdPreviewOpen = false;
function toggleMdPreview() {
  _mdPreviewOpen = !_mdPreviewOpen;
  const panel = document.getElementById('mdPreviewPanel');
  const btn = document.getElementById('previewToggleBtn');
  if (_mdPreviewOpen) {
    panel.style.display = 'block';
    btn.classList.add('active');
    updateMdPreview();
  } else {
    panel.style.display = 'none';
    btn.classList.remove('active');
  }
}
function updateMdPreview() {
  if (!_mdPreviewOpen) return;
  const text = srcEditor.getMarkdown();
  const preview = document.getElementById('mdPreviewContent');
  if (text.trim()) {
    preview.innerHTML = renderMarkdown(text);
  } else {
    preview.innerHTML = '<p style="color:var(--text-dim);font-style:italic;font-size:12px;">输入 Markdown 即可预览...</p>';
  }
}


// History item click: load translation
historyList.addEventListener('click', (e) => {
  // Delete button
  const deleteBtn = e.target.closest('.hi-delete');
  if (deleteBtn) {
    e.stopPropagation();
    const index = parseInt(deleteBtn.dataset.index);
    history.splice(index, 1);
    chrome.storage.local.set({ history });
    renderHistory();
    return;
  }
  // Item click: load history
  const item = e.target.closest('.history-item');
  if (item) {
    const index = parseInt(item.dataset.index);
    const h = history[index];
    if (h) {
      sourceLang.value = h.srcCode;
      targetLang.value = h.tgtCode;
      srcEditor.setMarkdown(h.text);
      updateCharCount();
      saveLangPrefs();
    }
  }
});

// Clear all history
safeBind('clearHistoryBtn', 'click', () => {
  history = [];
  chrome.storage.local.remove('history');
  renderHistory();
});

// ===== Resize Drag =====
(function initResize() {
  const MIN_W = 320;
  const MAX_W = 800;
  const MIN_H = 300;
  const MAX_H = screen.availHeight;
  let startX, startY, startW, startH, dir;

  document.querySelectorAll('.resize-handle').forEach(handle => {
    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dir = handle.dataset.dir;
      startX = e.screenX;
      startY = e.screenY;
      startW = document.body.offsetWidth;
      startH = document.body.offsetHeight;
      document.body.classList.add('resizing');

      document.addEventListener('mousemove', onResize);
      document.addEventListener('mouseup', onResizeEnd);
    });
  });

  function onResize(e) {
    let dx = e.screenX - startX;
    let dy = e.screenY - startY;
    let newW = startW;
    let newH = startH;

    if (dir.includes('e')) newW = Math.min(MAX_W, Math.max(MIN_W, startW + dx));
    if (dir.includes('w')) newW = Math.min(MAX_W, Math.max(MIN_W, startW - dx));
    if (dir.includes('s')) newH = Math.min(MAX_H, Math.max(MIN_H, startH + dy));
    if (dir.includes('n')) newH = Math.min(MAX_H, Math.max(MIN_H, startH - dy));

    document.body.style.width = newW + 'px';
    document.body.style.height = newH + 'px';
  }

  function onResizeEnd() {
    document.body.classList.remove('resizing');
    document.removeEventListener('mousemove', onResize);
    document.removeEventListener('mouseup', onResizeEnd);
    // Save size
    const popupSize = {
      width: document.body.offsetWidth,
      height: document.body.offsetHeight,
    };
    chrome.storage.local.set({ popupSize });
  }
})();

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
try { init(); } catch(e) { console.error("[Popup] init error:", e); }
