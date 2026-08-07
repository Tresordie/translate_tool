/**
 * theme.js — LinguaFlow 主题切换系统
 * 功能: 主题切换UI、localStorage持久化、iframe跨页面同步
 * 用法: 在页面底部引入 <script src="theme.js"></script> 即可自动注入切换器
 */
(function (global) {
  'use strict';

  var STORAGE_KEY = 'linguaflow_theme';
  var THEMES = [
    { id: 'ocean', name: '海洋', desc: '深海蓝 · 宁静深邃' },
    { id: 'fresh', name: '清新', desc: '自然绿 · 清爽明亮' },
    { id: 'dark', name: '暗黑', desc: '纯净深色 · 极简专注' },
    { id: 'light', name: '浅色', desc: '明亮简洁 · 护眼舒适' },
    { id: 'warm', name: '暖橙', desc: '暖阳橙黄 · 温馨活力' },
    { id: 'sakura', name: '樱花', desc: '樱花粉 · 柔美浪漫' }
  ];
  
  var DEFAULT_THEME = 'fresh';
  
  function getSavedTheme() {
    try { return localStorage.getItem(STORAGE_KEY) || DEFAULT_THEME; } catch (e) { return DEFAULT_THEME; }
  }

  function applyTheme(themeId, animate) {
    var html = document.documentElement;
    if (animate) {
      html.classList.add('theme-transitioning');
      setTimeout(function () { html.classList.remove('theme-transitioning'); }, 400);
    }
    html.setAttribute('data-theme', themeId);
    try { localStorage.setItem(STORAGE_KEY, themeId); } catch (e) {}
    updatePanelState(themeId);

    // 广播主题到所有 iframe（覆盖 file:// 下 storage 事件不触发的场景）
    var iframes = document.querySelectorAll('iframe');
    for (var i = 0; i < iframes.length; i++) {
      try {
        iframes[i].contentWindow.postMessage({ type: 'linguaflow-theme', theme: themeId }, '*');
      } catch (e) {}
    }
  }

  /* ---------- 切换器 UI ---------- */
  var panelEl = null;

  function buildUI() {
    // FAB 按钮
    var fab = document.createElement('button');
    fab.className = 'theme-fab';
    fab.title = '切换主题';
    fab.setAttribute('aria-label', '切换主题');
    fab.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      '<circle cx="12" cy="12" r="5"/>' +
      '<path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>' +
      '</svg>';

    // 面板
    panelEl = document.createElement('div');
    panelEl.className = 'theme-panel';
    var html = '<div class="theme-panel-title">选择主题</div>';
    for (var i = 0; i < THEMES.length; i++) {
      var t = THEMES[i];
      html += '<button class="theme-option" data-theme-id="' + t.id + '">' +
        '<span class="theme-swatch swatch-' + t.id + '"></span>' +
        '<span>' + t.name + '<br><small style="font-size:0.7rem;color:var(--text-dim);font-weight:400;">' + t.desc + '</small></span>' +
        '<span class="check">✓</span>' +
        '</button>';
    }
    panelEl.innerHTML = html;

    fab.addEventListener('click', function (e) {
      e.stopPropagation();
      panelEl.classList.toggle('open');
    });
    document.addEventListener('click', function (e) {
      if (panelEl && !panelEl.contains(e.target) && e.target !== fab) {
        panelEl.classList.remove('open');
      }
    });
    panelEl.addEventListener('click', function (e) {
      var btn = e.target.closest('.theme-option');
      if (!btn) return;
      var id = btn.getAttribute('data-theme-id');
      applyTheme(id, true);
      panelEl.classList.remove('open');
    });

    document.body.appendChild(fab);
    document.body.appendChild(panelEl);
    updatePanelState(getSavedTheme());
  }

  function updatePanelState(themeId) {
    if (!panelEl) return;
    var opts = panelEl.querySelectorAll('.theme-option');
    for (var i = 0; i < opts.length; i++) {
      var isActive = opts[i].getAttribute('data-theme-id') === themeId;
      opts[i].classList.toggle('active', isActive);
    }
  }

  /* ---------- iframe 同步 ---------- */
  function setupSync() {
    // 监听 storage 事件 (同源 iframe 之间)
    global.addEventListener('storage', function (e) {
      if (e.key === STORAGE_KEY && e.newValue) {
        applyTheme(e.newValue, true);
      }
    });

    // 如果当前页面在 iframe 中，从父页面接收主题
    if (global.parent !== global) {
      try {
        var parentTheme = global.parent.document.documentElement.getAttribute('data-theme');
        if (parentTheme) applyTheme(parentTheme, false);
      } catch (e) {}

      global.addEventListener('message', function (e) {
        if (e.data && e.data.type === 'linguaflow-theme' && e.data.theme) {
          applyTheme(e.data.theme, true);
        }
      });
    }
  }

  /* ---------- Markdown 预览按钮绑定（仅扩展环境） ---------- */
  // MV3 CSP 禁止 inline onclick，扩展页面由 theme.js 统一绑定；
  // 网页版继续使用 inline onclick，此处不绑定以避免双重触发。
  function bindMdPreviewButtons() {
    var fn = global.toggleMdPreview;
    if (typeof fn !== 'function') return;
    // 仅在按钮没有内联 onclick 时绑定：
    // 扩展页面（CSP 移除内联 onclick）直接打开或在扩展中都能生效；
    // 根页面保留内联 onclick，此处跳过以避免双重触发。
    function bindIfNoInline(el) {
      if (el && !el.getAttribute('onclick')) el.addEventListener('click', fn);
    }
    bindIfNoInline(document.getElementById('previewToggleBtn'));
    bindIfNoInline(document.querySelector('.md-preview-close'));
  }

  /* ---------- 星星背景生成（幂等、CSP 安全） ---------- */
  // 统一由此处生成，替代各页面分散的内联星星脚本（内联脚本在扩展 MV3 CSP 下被阻止）。
  // 幂等：若 #stars 不存在或已有 .star 子元素则跳过，避免与页面级生成器重复。
  function generateStars() {
    var c = document.getElementById('stars');
    if (!c || c.querySelector('.star')) return;
    for (var i = 0; i < 60; i++) {
      var s = document.createElement('div');
      s.className = 'star';
      s.style.left = Math.random() * 100 + '%';
      s.style.top = Math.random() * 100 + '%';
      s.style.animationDelay = Math.random() * 3 + 's';
      s.style.animationDuration = (2 + Math.random() * 3) + 's';
      s.style.width = s.style.height = (1 + Math.random() * 2) + 'px';
      c.appendChild(s);
    }
  }

  /* ---------- 初始化 ---------- */
  function init() {
    // 先生成星星背景（需在 inIframe 判断前执行，保证 iframe 子页面也有星星）
    generateStars();

    var theme = getSavedTheme();
    applyTheme(theme, false);
    setupSync();
    bindMdPreviewButtons();

    //  iframe 子页面不注入独立切换器（跟随父页面主题，保持界面一致）
    var inIframe = (global.self !== global.top);
    if (inIframe) {
      // 标记嵌入模式：配合 theme.css 隐藏页面独立标题，与宿主页面保持一致
      document.documentElement.classList.add('in-iframe');
      return;
    }

    // 扩展 popup 空间有限且为快捷工具，不注入切换器（主题自动跟随保存的设置）
    try {
      if (/popup\.html/.test(global.location.pathname)) return;
    } catch (e) {}

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', buildUI);
    } else {
      buildUI();
    }
  }

  // 暴露 API
  global.LinguaFlowTheme = {
    set: function (id, animate) { applyTheme(id, animate !== false); },
    get: getSavedTheme,
    themes: THEMES
  };

  init();
})(typeof window !== 'undefined' ? window : this);
