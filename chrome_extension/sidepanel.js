// ================================================================
// LinguaFlow — Side Panel 逻辑
// 功能: 五模块 Tab 切换（iframe 懒加载）、API 配置读写与实时同步、
//       主题跟随（由 theme.js 负责）、Toast 提示
// 存储: chrome.storage.local（与 popup / fullpage / 各子页面共享）
// ================================================================

// ===== DOM =====
const $ = id => { const el = document.getElementById(id); if (!el) console.error('[SidePanel] #' + id + ' not found'); return el; };

const settingsPanel = $('spSettingsPanel');
const toggleSettingsBtn = $('spToggleSettings');

// ===== Toast =====
function showToast(msg, type) {
  const toast = $('spToast');
  if (!toast) return;
  toast.textContent = msg;
  toast.className = `toast ${type} show`;
  setTimeout(() => toast.classList.remove('show'), 2200);
}

// ===== 设置面板 =====
toggleSettingsBtn.addEventListener('click', () => {
  settingsPanel.classList.toggle('open');
  toggleSettingsBtn.classList.toggle('active');
});

function loadConfig(config) {
  if (!config) return;
  if (config.baseUrl) $('spBaseUrl').value = config.baseUrl;
  if (config.apiKey) $('spApiKey').value = config.apiKey;
  if (config.model) $('spModelName').value = config.model;
}

$('spSaveSettings').addEventListener('click', () => {
  const config = {
    baseUrl: $('spBaseUrl').value.trim().replace(/\/+$/, ''),
    apiKey: $('spApiKey').value.trim(),
    model: $('spModelName').value.trim(),
  };
  chrome.storage.local.set({ config }, () => {
    showToast('配置已保存', 'success');
    settingsPanel.classList.remove('open');
    toggleSettingsBtn.classList.remove('active');
    broadcastConfig(config);
  });
});

// ===== 配置实时同步（popup / fullpage / 其他页面保存后立即生效） =====
function broadcastConfig(config) {
  const msg = { source: 'linguaflow-extension', config };
  document.querySelectorAll('.sp-frame').forEach((f) => {
    try { f.contentWindow.postMessage(msg, '*'); } catch (err) { /* ignore */ }
  });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.config || !changes.config.newValue) return;
  const c = changes.config.newValue;
  if (!c || !c.baseUrl) return;
  loadConfig(c);
  // 子页面在扩展环境会直接监听 chrome.storage，这里额外转发覆盖 file:// 等场景
  broadcastConfig(c);
});

// ===== Tab 切换 + iframe 懒加载（首次激活才挂载，避免一次加载全部子页面） =====
const PANELS = ['translate', 'workreport', 'todolist', 'english', 'email', 'aiparse', 'aiprompts', 'hotnews'];

function switchTab(tab) {
  if (!PANELS.includes(tab)) return;
  document.querySelectorAll('.sp-tab').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  document.querySelectorAll('.sp-panel').forEach((panel) => {
    panel.classList.toggle('active', panel.dataset.panel === tab);
  });
  const iframe = document.querySelector(`.sp-panel[data-panel="${tab}"] .sp-frame`);
  if (iframe && !iframe.getAttribute('src')) {
    iframe.setAttribute('src', iframe.dataset.src);
  }
}

document.querySelectorAll('.sp-tab').forEach((btn) => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

// ===== 启动 =====
chrome.storage.local.get(['config'], ({ config }) => {
  loadConfig(config);
});
switchTab('translate');
