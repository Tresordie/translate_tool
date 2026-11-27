// v0.52.3 时间轴导出对齐 voice_transcription（src/lib/ai/timeline.ts + exporters.ts）：
// 时间轴表格/「彩点 emoji + 日期」列表 → 行内样式可视化卡片；
// 预览（renderMarkdown）/单文件 HTML（mdToHtml）/md 导出（downloadText→upgradeMarkdownTimeline）三处一致；
// 非时间轴内容、代码围栏、既有 tl-* 骨架、嵌套/任务列表一字不动；公众号纯文本转换不受影响。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let passed = 0, failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name); }
}

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.window = globalThis;
globalThis.addEventListener = () => {};
new Function(fs.readFileSync(path.join(root, 'markdown.js'), 'utf8')).call(globalThis);
const renderMarkdown = globalThis.renderMarkdown;
const upgradeMarkdownTimeline = globalThis.upgradeMarkdownTimeline;
const markdownToWechat = globalThis.markdownToWechat;
new Function(fs.readFileSync(path.join(root, 'ai-service.js'), 'utf8') + '\nreturn globalThis.AiService;').call(globalThis);
const svc = globalThis.AiService;

const EV_TABLE = '| 时间 | 事件 | 说明 |\n|---|---|---|\n| 2026-11-20 | 电芯排查 | 4.19V 异常 |\n| 2026-11-21 | 供应商评审 | 确认批次 |';
const TASK_TABLE = '| 日期 | 任务 | 状态 |\n|---|---|---|\n| 2026-11-20 | 电芯排查 | 已完成 |\n| 2026-11-21 | 供应商评审 | 进行中 |';
const PLAIN_TABLE = '| 参数 | 值 | 单位 |\n|---|---|---|\n| 电压 | 4.19 | V |\n| 压差 | 50.6 | mV |';
const EV_LIST = '- 🟢 2026-11-20 完成电芯排查\n- 🔵 2026-11-21 供应商评审\n- 🟡 2026-11-22 待确认批次';

console.log('— renderMarkdown：时间轴表格 → 卡片 —');
const h1 = renderMarkdown(EV_TABLE);
check('事件表格识别为时间轴卡片', h1.includes('md-timeline') && h1.includes('2026-11-20') && h1.includes('电芯排查') && h1.includes('4.19V 异常'));
check('不再输出朴素表格', !h1.includes('<table'));
check('行内样式 + 主题变量（导出兼容）', h1.includes('border-radius:50%') && h1.includes('var(--tl-risk,#dc2626)') && !h1.includes('<style'));
check('面板浅色兜底（导出 HTML/md 查看器自成一体）', h1.includes('background:var(--tl-bg,#ffffff)') && h1.includes('var(--tl-line,#cbd5e1)'));
const h2 = renderMarkdown(TASK_TABLE);
check('状态列 → 任务轴（完成划线 + 状态徽章）', h2.includes('md-timeline') && h2.includes('line-through') && h2.includes('已完成') && h2.includes('🚧'));
check('图例行（四色语义说明）', h1.includes('● 完成/推进'.replace('● ', '')) && h1.includes('风险/升级') && h1.includes('卡点/停滞') && h1.includes('进行中/中性') && (h1.split('●').length - 1 >= 4));
const hBold = renderMarkdown('| 时间 | 事件 | 说明 |\n|---|---|---|\n| 11-10 | 发起客诉 | **7台NG** @933，库存 **1549pcs** |\n| 11-12 | 创建NCR | 编号 `NCR-192001486` |');
check('表格 **要点** 加粗、`代码` 成 chip（变量驱动）', hBold.includes('<b style="color:var(--tl-strong,#0b1220);font-weight:700;">7台NG</b>') && hBold.includes('NCR-192001486') && hBold.includes('<code style='));
const h3 = renderMarkdown(PLAIN_TABLE);
check('非时间轴表格保持原渲染', h3.includes('<table>') && h3.includes('<td>4.19</td>') && !h3.includes('md-timeline'));
const h4 = renderMarkdown('| A | B |\n|---|---|\n| 00:01 | 开场 |\n| 00:12 | 讨论 |');
check('mm:ss 首列兜底识别（转写稿时间轴）', h4.includes('md-timeline') && h4.includes('开场'));
const h5 = renderMarkdown('| 时间 | 事件 |\n|---|---|\n| 2026-11-20 | 唯一条目 |');
check('单行表格不升级（参考项目 ≥2 条规则）', h5.includes('<table>') && !h5.includes('md-timeline'));
const h6 = renderMarkdown('| **时间** | **事件** |\n|---|---|\n| **2026-11-20** | **排查** |\n| 2026-11-21 | 评审 |');
check('粗体表头/单元格剥离后仍识别', h6.includes('md-timeline') && h6.includes('排查'));

console.log('— renderMarkdown：彩点日期列表 → 卡片 —');
const l1 = renderMarkdown(EV_LIST);
check('G-SPEC 彩点+日期列表识别为卡片', l1.includes('md-timeline') && l1.includes('完成电芯排查') && !l1.includes('<ul>'));
check('🟢🔵🟡 彩点列表 → 事件轴（彩色圆环+同色时间戳，非任务徽章）', l1.includes('var(--tl-ok,') && l1.includes('var(--tl-warn,') && !l1.includes('line-through') && !l1.includes('✅'));
const l1b = renderMarkdown('- ✅ 2026-11-20 完成甲项\n- 🚧 2026-11-21 进行乙项');
check('✅🚧 状态列表 → 任务轴（划线+徽章）', l1b.includes('line-through') && l1b.includes('✅') && l1b.includes('🚧'));
const l2 = renderMarkdown('- 苹果\n- 香蕉');
check('普通列表不升级', l2.includes('<ul>') && !l2.includes('md-timeline'));
const l3 = renderMarkdown('- 3.5 版本发布\n- 4.0 规划');
check('数字开头非日期不误吞（3.5 版本发布）', l3.includes('<ul>') && !l3.includes('md-timeline'));
const l4 = renderMarkdown('- 🟢 2026-11-20 父项\n  - 子项\n- 🔵 2026-11-21 父项二');
check('嵌套列表保持原渲染', l4.includes('<ul>') && !l4.includes('md-timeline'));
const l5 = renderMarkdown('- [x] 2026-11-20 完成X\n- [ ] 2026-11-21 待办Y');
check('任务清单（checkbox）不受影响', l5.includes('type="checkbox"') && !l5.includes('md-timeline'));
const l6 = renderMarkdown('- **14:00** 开场与目标对齐\n- **14:20** 风险同步');
check('strong 只包时间戳 → 标题取正文首段', l6.includes('md-timeline') && l6.includes('开场与目标对齐') && l6.includes('14:00'));
const l7 = renderMarkdown('- 🔴 11月20日 异常上报\n- 🟢 11月21日 已解决');
check('mm月dd日 日期格式识别', l7.includes('md-timeline') && l7.includes('异常上报'));

console.log('— upgradeMarkdownTimeline：md 导出升级 —');
const u1 = upgradeMarkdownTimeline('前文\n\n' + EV_LIST + '\n\n后文');
check('列表 → 卡片 HTML，前后文保留', u1.includes('md-timeline') && u1.includes('前文') && u1.includes('后文') && !u1.includes('- 🟢'));
const u2 = upgradeMarkdownTimeline('## 模块\n\n' + EV_TABLE + '\n\n收尾');
check('表格 → 卡片 HTML', u2.includes('md-timeline') && !u2.includes('| 时间 |') && u2.includes('收尾'));
const fenced = '```\n' + EV_LIST + '\n```';
check('代码围栏内列表原样保留', upgradeMarkdownTimeline(fenced) === fenced);
const TL_A = ['<style>', '.tl-panel-light{background:#f5f7fa}', '</style>', '<div class="tl-panel-light"><div class="tl-event">', '  <div class="tl-ev ph-blue"><span class="d">9/10</span><span class="t">首次上报</span></div>', '</div></div>'].join('\n');
check('既有 tl-* 骨架原样保留（不重复升级）', upgradeMarkdownTimeline(TL_A) === TL_A);
const plainMd = '# 标题\n\n普通段落\n\n- 苹果\n- 香蕉';
check('普通 md 一字不动', upgradeMarkdownTimeline(plainMd) === plainMd);
check('非时间轴表格 md 一字不动', upgradeMarkdownTimeline(PLAIN_TABLE) === PLAIN_TABLE);
const u6 = upgradeMarkdownTimeline('- 🟢 2026-11-20 甲项\n\n- 🔵 2026-11-21 乙项');
check('空行分隔的列表项同样升级（与预览一致）', u6.includes('md-timeline'));
const once = upgradeMarkdownTimeline('正文\n\n' + EV_LIST);
check('幂等：二次升级不再变化', upgradeMarkdownTimeline(once) === once);

console.log('— 既有能力不回归 —');
const wc = markdownToWechat(EV_TABLE);
check('公众号纯文本转换不受影响（仍为文本表格）', wc.includes('时间') && !wc.includes('md-timeline') && !wc.includes('<div'));
const sk = renderMarkdown('前置\n\n' + TL_A + '\n\n后置');
check('预览仍放行 tl-* 骨架（.md-embed 作用域化）', sk.includes('<div class="md-embed">') && sk.includes('.md-embed .tl-panel-light{'));
check('单文件 HTML 导出含时间轴卡片', svc.mdToHtml('## 时间轴\n\n' + EV_TABLE, 't').includes('md-timeline'));

console.log('— downloadText 接线（md 导出统一升级） —');
let captured = null;
const realCreate = URL.createObjectURL;
globalThis.document = {
  createElement: () => ({ click() {}, setAttribute() {}, style: {} }),
  body: { appendChild() {}, removeChild() {} },
};
URL.createObjectURL = (blob) => { captured = blob; return 'blob:fake'; };
URL.revokeObjectURL = () => {};
svc.downloadText('x.md', EV_LIST, 'text/markdown;charset=utf-8');
const mdBlobText = await captured.text();
check('text/markdown 下载自动升级时间轴', mdBlobText.includes('md-timeline') && !mdBlobText.includes('- 🟢'));
captured = null;
svc.downloadText('x.txt', EV_LIST, 'text/plain;charset=utf-8');
const txtBlobText = await captured.text();
check('非 markdown 下载不升级', txtBlobText === EV_LIST);
if (realCreate) URL.createObjectURL = realCreate;

console.log('— 双副本一致 —');
check('markdown.js 逐字一致', fs.readFileSync(path.join(root, 'markdown.js'), 'utf8') === fs.readFileSync(path.join(root, 'chrome_extension', 'markdown.js'), 'utf8'));
const dlSec = (c) => c.slice(c.indexOf('  function downloadText(filename, content, mime) {'), c.indexOf('  /* ==================== 附件统一处理'));
const a = fs.readFileSync(path.join(root, 'ai-service.js'), 'utf8');
const b = fs.readFileSync(path.join(root, 'chrome_extension', 'ai-service.js'), 'utf8');
check('downloadText 段逐字一致', dlSec(a) === dlSec(b) && dlSec(a).includes('upgradeMarkdownTimeline'));

console.log('— 页面本地下载点闸门（绕过 AiService.downloadText 的 4 处 × 双副本） —');
{
  const gate = 'md 导出统一升级时间轴（与 AiService.downloadText 闸门同款）';
  const pages = ['workreport.js', 'email_summary.js', 'wechat_schedule.js', 'english_learning.js'];
  for (const p of pages) {
    const rc = fs.readFileSync(path.join(root, p), 'utf8');
    const ec = fs.readFileSync(path.join(root, 'chrome_extension', p), 'utf8');
    check(p + ' 双副本均含本地 md 闸门', rc.split(gate).length === 2 && ec.split(gate).length === 2 &&
      rc.includes("window.upgradeMarkdownTimeline) content = window.upgradeMarkdownTimeline(content);") &&
      ec.includes("window.upgradeMarkdownTimeline) content = window.upgradeMarkdownTimeline(content);"));
  }
}


console.log('— 主题适配（深浅随宿主） —');
const mdSrc = fs.readFileSync(path.join(root, 'markdown.js'), 'utf8');
check('markdown.js 不再写死深色值（全部 var 化）', !mdSrc.includes('#0c1220') && !mdSrc.includes('#e8eef6') && !mdSrc.includes('#3cb371'));
const thR = fs.readFileSync(path.join(root, 'theme.css'), 'utf8');
const thE = fs.readFileSync(path.join(root, 'chrome_extension', 'theme.css'), 'utf8');
check('theme.css 双副本逐字一致', thR === thE);
check('深色主题（曜石）覆盖深色时间轴配色', ['lf-obsidian'].every(t => thR.includes('html[data-theme="' + t + '"] .md-timeline')) && thR.includes('--tl-bg: #0c1220') && thR.includes('--tl-strong: #ffffff'));
check('打印回落浅色（@media print 覆盖块）', thR.slice(thR.indexOf('.md-timeline')).includes('@media print'));
const printIdx = thR.indexOf('--tl-bg: #ffffff');
check('打印兜底值与 markdown.js 浅色兜底一致', printIdx > 0 && mdSrc.includes('var(--tl-bg,#ffffff)'));

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
