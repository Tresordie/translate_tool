/**
 * theme.test.mjs — 主题系统协议测试（v0.55.0 精简为 3 款）
 *
 * 覆盖:
 *   1. 双副本逐字一致（theme.css / theme.js ↔ chrome_extension/）
 *   2. 注册表：3 款（浅 2 / 深 1），默认 lf-iris；已删 9 款 id 零残留
 *   3. 行为：LinguaFlowTheme.set 对 3 款逐一设置 data-theme/data-mode
 *   4. 兜底迁移：已删 9 款 + 旧 cat-* + v0.47.2 删除款 + 未知 id 全部落到现存主题
 *   5. 变量协议：:root 锚定 lf-iris；iris/obsidian 覆盖 cream 基线 + 完整 SUPERSET
 *   6. WCAG 对比度：iris/obsidian 严格档（dim/link ≥4.5、btn 白字 ≥3），cream 旧款底线
 *   7. 共享控件精修层（8c/8c.2）：高度令牌/min-height/禁用态/滚动条/发丝边/焦点环/Toast/kbd
 *
 * 运行: node tests/theme.test.mjs
 */
import fs from 'fs';
import path from 'path';
import url from 'url';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const root = path.join(here, '..');

let passed = 0, failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name); }
}

const css = fs.readFileSync(path.join(root, 'theme.css'), 'utf8');
const js = fs.readFileSync(path.join(root, 'theme.js'), 'utf8');
const cssExt = fs.readFileSync(path.join(root, 'chrome_extension', 'theme.css'), 'utf8');
const jsExt = fs.readFileSync(path.join(root, 'chrome_extension', 'theme.js'), 'utf8');

console.log('— 1. 双副本一致 —');
check('theme.css 双副本逐字一致', css === cssExt);
check('theme.js 双副本逐字一致', js === jsExt);

console.log('— 2/3. 注册表与切换行为（真实执行 theme.js） —');
// 最小 DOM 桩：init() 立即执行，但 getElementById→null / querySelectorAll→[] 使 UI 构建短路
const attrs = {};
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => { mem.set(k, String(v)); },
  removeItem: (k) => { mem.delete(k); },
};
globalThis.document = {
  readyState: 'loading',
  documentElement: {
    classList: { add() {}, remove() {} },
    setAttribute: (k, v) => { attrs[k] = v; },
  },
  getElementById: () => null,
  querySelectorAll: () => [],
  addEventListener: () => {},
  createElement: () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {} }),
};
globalThis.window = globalThis;
globalThis.self = globalThis;
globalThis.top = globalThis;
globalThis.addEventListener = () => {};
globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, addListener() {} });
globalThis.location = { pathname: '/workreport.html' };

new Function(js).call(globalThis);
const LFT = globalThis.LinguaFlowTheme;
check('LinguaFlowTheme API 暴露', !!LFT && typeof LFT.set === 'function');
check('主题总数 3', LFT.themes.length === 3);
const ids = LFT.themes.map(t => t.id);
check('lf-iris / lf-cream / lf-obsidian 已注册', ['lf-iris', 'lf-cream', 'lf-obsidian'].every(id => ids.includes(id)));
check('默认主题 lf-iris', LFT.get() === 'lf-iris');
// 分组：源码中浅色组含 iris/cream、深色组含 obsidian（按 THEME_GROUPS 段落判定）
const lightSeg = js.slice(js.indexOf("label: '浅色'"), js.indexOf("label: '深色'"));
const darkSeg = js.slice(js.indexOf("label: '深色'"), js.indexOf('DARK_THEMES'));
check('iris/cream 在浅色组', lightSeg.includes('lf-iris') && lightSeg.includes('lf-cream'));
check('obsidian 在深色组', darkSeg.includes('lf-obsidian'));

const LIGHT = ['lf-iris', 'lf-cream'];
const DARK = ['lf-obsidian'];
const DELETED = ['lf-verdant', 'lf-paper', 'lf-mist', 'lf-sky', 'lf-graphite', 'lf-slate', 'lf-midnight', 'lf-orbit', 'lf-nocturne'];
let modeOk = true;
for (const id of LIGHT.concat(DARK)) {
  LFT.set(id, false);
  const want = DARK.includes(id) ? 'dark' : 'light';
  if (attrs['data-theme'] !== id || attrs['data-mode'] !== want) {
    modeOk = false; console.log('    ↳ 异常:', id, attrs['data-theme'], attrs['data-mode']);
  }
}
check('3 款 set() 后 data-theme/data-mode 全部正确', modeOk);

console.log('— 4. 已删 9 款零残留 + 兜底迁移 —');
for (const id of DELETED) {
  check('theme.css 无 ' + id + ' 残留（块/色板/专属层/时间轴组）', !css.includes(id));
  check('theme.js 仅迁移表保留 ' + id + ' 键', !js.split("'" + id + "':").join('').includes(id));
}
const MIGRATE = {
  'lf-verdant': 'lf-iris', 'lf-paper': 'lf-cream', 'lf-mist': 'lf-cream', 'lf-sky': 'lf-iris',
  'lf-graphite': 'lf-obsidian', 'lf-slate': 'lf-obsidian', 'lf-midnight': 'lf-obsidian',
  'lf-orbit': 'lf-obsidian', 'lf-nocturne': 'lf-obsidian',
  'cat-mocha': 'lf-obsidian', 'cat-latte': 'lf-cream', 'lf-dawn': 'lf-cream', 'lf-tokyo': 'lf-obsidian',
  'lf-bogus-unknown': 'lf-iris',
};
for (const [old, target] of Object.entries(MIGRATE)) {
  mem.set('linguaflow_theme', old);
  const got = LFT.get();
  check('残留 ' + old + ' → ' + target + '（且回写存储）', got === target && mem.get('linguaflow_theme') === target);
}
mem.delete('linguaflow_theme');

console.log('— 5. 变量协议（3 块 + :root 锚定） —');
const SUPERSET = [
  '--primary', '--primary-light', '--primary-dark', '--accent', '--accent2',
  '--neon-cyan', '--neon-purple', '--neon-blue', '--neon-green', '--orange', '--red', '--blue',
  '--bg-dark', '--bg-gradient', '--bg-body', '--bg-card', '--bg-card2', '--bg-elevated',
  '--glass-bg', '--glass-border', '--glass-shadow', '--glass-shadow-hover',
  '--text', '--text-secondary', '--text-dim', '--text-strong',
  '--white-rgb', '--primary-rgb', '--accent2-rgb', '--cyan-rgb', '--purple-rgb', '--green-rgb',
  '--primary-a02', '--primary-a03', '--primary-a04', '--primary-a05', '--primary-a06',
  '--primary-a08', '--primary-a10', '--primary-a12', '--primary-a15', '--primary-a18',
  '--primary-a20', '--primary-a25', '--primary-a30', '--primary-a35', '--primary-a40',
  '--accent2-a06', '--accent2-a08',
  '--cyan-a03', '--cyan-a04', '--cyan-a06', '--cyan-a08', '--cyan-a10', '--cyan-a15', '--cyan-a20',
  '--green-a04', '--green-a06', '--green-a08', '--green-a10', '--green-a15',
  '--white-a03', '--white-a04', '--white-a05', '--white-a06', '--white-a10',
  '--orb-opacity', '--glow-opacity', '--noise-opacity',
  '--orb1-color', '--orb2-color', '--orb3-color', '--card-border-glow', '--shadow-tint-rgb',
  '--green', '--green-a12', '--cyan-a12', '--green-a20',
  '--red-a08', '--red-a10', '--red-a12', '--accent2-a10',
  '--white-a08', '--white-a12', '--white-a15',
  '--md-pre-color', '--md-table-border', '--md-th-bg',
  '--scanline-opacity', '--grid-opacity', '--star-opacity',
  '--md-code-bg', '--md-code-color', '--md-pre-bg', '--md-pre-border', '--md-link',
  '--md-blockquote-border', '--md-blockquote-bg',
  '--header-gradient', '--btn-gradient', '--input-bg', '--input-border',
  '--scrollbar-color', '--scrollbar-hover', '--focus-ring', 'color-scheme',
];
const blocks = {};
for (const id of LIGHT.concat(DARK)) {
  const re = new RegExp('html\\[data-theme="' + id + '"\\]\\s*\\{([\\s\\S]*?)\\n\\}');
  const m = css.match(re);
  blocks[id] = m ? m[1] : null;
  check(id + ' 变量块存在', !!blocks[id]);
}
function varNames(block) {
  return [...block.matchAll(/^\s*(--[a-z0-9-]+|color-scheme):/gm)].map(m => m[1]);
}
check(':root 锚定 lf-iris（JS 加载前回退，唯一主题锚点）', /:root,\s*\nhtml\[data-theme="lf-iris"\]/.test(css) && (css.match(/:root,/g) || []).length === 1);
// 基线 = 幸存旧块 cream 的变量集；iris/obsidian 另须覆盖完整 SUPERSET
const baseline = new Set(varNames(blocks['lf-cream'] || ''));
check('cream 基线非空（≥60 项）', baseline.size >= 60);
let protoOk = true;
for (const id of ['lf-iris', 'lf-obsidian']) {
  const names = new Set(varNames(blocks[id] || ''));
  const missing = [...baseline].filter(v => !names.has(v));
  if (missing.length) { protoOk = false; console.log('    ↳', id, '缺基线变量:', missing.join(', ')); }
}
check('iris/obsidian 均含 cream 基线（' + baseline.size + ' 项）', protoOk);
let superOk = true;
for (const id of ['lf-iris', 'lf-obsidian']) {
  const missing = SUPERSET.filter(v => !blocks[id] || !blocks[id].includes(v + ':'));
  if (missing.length) { superOk = false; console.log('    ↳', id, '缺超集变量:', missing.join(', ')); }
}
check('新主题块覆盖完整超集（' + SUPERSET.length + ' 项）', superOk);

console.log('— 6. 关键值与色板 —');
check('Iris 主色 #6366f1', /--primary:\s*#6366f1/.test(blocks['lf-iris'] || ''));
check('Iris color-scheme: light', /color-scheme:\s*light/.test(blocks['lf-iris'] || ''));
check('Obsidian 琥珀 accent2 #f5a623', /--accent2:\s*#f5a623/.test(blocks['lf-obsidian'] || ''));
check('Obsidian color-scheme: dark', /color-scheme:\s*dark/.test(blocks['lf-obsidian'] || ''));
check('Obsidian 在时间轴深色选择器组（唯一深色）', /html\[data-theme="lf-obsidian"\]\s*\.md-timeline/.test(css));
check('3 款色板齐全', ['lf-iris', 'lf-cream', 'lf-obsidian'].every(id => css.includes('swatch-' + id)));
check('打印浅色面栈兜底仍在', css.includes('@media print') && css.includes('--tl-bg: #ffffff'));

console.log('— 7. WCAG 对比度 —');
// 分级：iris/obsidian 严格执行 WCAG（dim/link ≥4.5、btn 白字 ≥3）；
// cream 为幸存旧款，配色不擅自改动，只守宽松底线（dim ≥2.5、btn ≥1.5）。
function lum(hex) {
  hex = hex.replace('#', '');
  const c = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(v => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function ratio(a, b) {
  const la = lum(a), lb = lum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
function getVar(block, name) {
  const m = block.match(new RegExp(name.replace(/[-]/g, '\\-') + ':\\s*([^;]+);'));
  return m ? m[1].trim() : null;
}
const STRICT = ['lf-iris', 'lf-obsidian'];
let strictOk = true, legacyFloorOk = true;
const legacyGaps = [];
for (const id of LIGHT.concat(DARK)) {
  const b = blocks[id];
  if (!b) { strictOk = false; continue; }
  const strict = STRICT.includes(id);
  const dimMin = strict ? 4.5 : 2.5, btnMin = strict ? 3.0 : 1.5;
  const dim = getVar(b, '--text-dim'), body = getVar(b, '--bg-body'),
        card = getVar(b, '--bg-card'), link = getVar(b, '--md-link');
  const tests = [
    ['text-dim/bg-body', dim, body, dimMin],
    ['text-dim/bg-card', dim, card, dimMin],
  ];
  if (strict) tests.push(['md-link/bg-card', link, card, 4.5]);
  for (const [label, fg, bg, min] of tests) {
    if (!fg || !bg || !fg.startsWith('#') || !bg.startsWith('#')) {
      if (strict) { strictOk = false; console.log('    ↳', id, label, '非 hex:', fg, bg); }
      continue;
    }
    const r = ratio(fg, bg);
    if (r < min) {
      if (strict) { strictOk = false; console.log('    ↳', id, label, r.toFixed(2), '<', min); }
      else { legacyFloorOk = false; console.log('    ↳ 底线失守:', id, label, r.toFixed(2)); }
    } else if (!strict && r < 4.5) {
      legacyGaps.push(id + ' ' + label + ' ' + r.toFixed(2));
    }
  }
  const grad = getVar(b, '--btn-gradient') || '';
  const stops = grad.match(/#[0-9a-fA-F]{6}/g) || [];
  if (!stops.length && strict) { strictOk = false; console.log('    ↳', id, 'btn-gradient 无 hex 停止点'); }
  for (const s of stops) {
    const r = ratio('#ffffff', s);
    if (r < btnMin) {
      if (strict) { strictOk = false; console.log('    ↳', id, 'btn白字/' + s, r.toFixed(2), '<', btnMin); }
      else { legacyFloorOk = false; console.log('    ↳ 底线失守:', id, 'btn白字/' + s, r.toFixed(2)); }
    } else if (!strict && r < 3) {
      legacyGaps.push(id + ' btn白字/' + s + ' ' + r.toFixed(2));
    }
  }
}
check('iris/obsidian：dim/link ≥4.5 且按钮渐变白字 ≥3', strictOk);
check('cream 守住宽松底线（dim ≥2.5 / btn ≥1.5，配色不改）', legacyFloorOk);
if (legacyGaps.length) console.log('  · 已知遗留（cream 未达严格 WCAG，共 ' + legacyGaps.length + ' 处，留待后续配色专项）');

console.log('— 8. 共享控件精修层（8c/8c.2） —');
check('控件高度令牌 --ctl-h/--ctl-h-lg', css.includes('--ctl-h: 34px') && css.includes('--ctl-h-lg: 42px'));
check('次级控件 min-height 兜底', /\.btn-tool[\s\S]{0,220}min-height:\s*var\(--ctl-h/.test(css));
check('主 CTA min-height 兜底', /\.translate-btn,\s*\.btn-summarize\s*\{\s*min-height:\s*var\(--ctl-h-lg/.test(css));
check('禁用态基线（button:disabled）', /button:disabled\s*\{[\s\S]{0,200}cursor:\s*not-allowed/.test(css));
check('Firefox 细滚动条', css.includes('scrollbar-width: thin'));
check('浅色卡片发丝边（令牌化）', css.includes('border: 1px solid var(--glass-border); /* v0.54.0'));
check('键盘焦点环随主题主色', css.includes('outline: 2px solid var(--primary) !important'));
check('Toast success 走主题绿令牌', css.includes('rgba(var(--green-rgb, 64,160,130), 0.95)'));
check('Toast info 走主题主色令牌', css.includes('rgba(var(--primary-rgb, 90,130,190), 0.92)'));
check('主题面板增宽 232px', /\.theme-panel\s*\{\s*min-width:\s*232px/.test(css));
check('8c.2 元素质感统一（button.btn-tool 字重/圆角）', /button\.btn-tool[\s\S]{0,160}font-weight:\s*600/.test(css));
check('8c.2 悬停抬升 -2px', /button\.btn-tool:hover[\s\S]{0,160}translateY\(-2px\)/.test(css));
check('8c.2 主 CTA 字重 650 + 字距', /button\.translate-btn,\s*button\.btn-summarize\s*\{\s*font-weight:\s*650;\s*letter-spacing:\s*0\.02em/.test(css));
check('CTA 内 kbd 白字（跨主题对比修复）', css.includes('.btn-record .kbd, .btn-summarize .kbd, .translate-btn .kbd { color: #fff !important; }'));

console.log('\n结果: ' + passed + ' 通过, ' + failed + ' 失败');
process.exit(failed ? 1 : 0);
