/**
 * markdown-export.test.mjs — SVG 渲染与单文件 HTML 导出（v0.51.0）单元测试
 *
 * 背景：scenario-templates 模板按 G-SPEC 输出内联 SVG 封面/示意图 + 大量表格。
 * 修复前：renderMarkdown 全量转义（SVG 显示成源码文本），三页 HTML 导出各自为政
 * （workreport 转换器不支持表格、ai_parse 的 mdToHtml 无 CSS）。
 *
 * 覆盖:
 *   1. renderMarkdown：内联 SVG 块与 ```svg/```xml 围栏放行渲染（净化 script、事件属性与 javascript: 链接）
 *   2. 非 SVG HTML 仍转义、表格/mermaid 代码块照常
 *   3. AiService.mdToHtml：技能 R2 单文件壳（内联 CSS/浅底深字/打印样式，正文含 SVG）
 *   4. markdown.js 与 chrome_extension 副本逐字一致；mdToHtml 段两副本一致
 *
 * 运行: node tests/markdown-export.test.mjs
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

// —— 全局桩（markdown.js 挂 window || this；ai-service.js 需 localStorage/window） ——
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => { mem.set(k, String(v)); },
  removeItem: (k) => { mem.delete(k); },
};
globalThis.window = globalThis;
globalThis.addEventListener = () => {};

new Function(fs.readFileSync(path.join(root, 'markdown.js'), 'utf8')).call(globalThis);
const renderMarkdown = globalThis.renderMarkdown;

function loadService(relPath) {
  const code = fs.readFileSync(path.join(root, relPath), 'utf8');
  return new Function(code + '\nreturn global.AiService;').call(globalThis);
}
const svc = loadService('ai-service.js');

const SAMPLE_SVG = '<svg width="600" height="80" xmlns="http://www.w3.org/2000/svg"><rect width="600" height="80" fill="#e8f1fb"/><text x="24" y="46" font-size="20">结论标题</text></svg>';

console.log('— renderMarkdown：SVG 放行 —');
const md1 = '# 标题\n\n' + SAMPLE_SVG + '\n\n正文段落。';
const h1 = renderMarkdown(md1);
check('内联 SVG 块原样保留', h1.includes('<svg width="600" height="80"') && h1.includes('<circle') === false && h1.includes('<rect') && h1.includes('结论标题'));
check('SVG 不被转义', !h1.includes('&lt;svg'));

const md2 = '前文\n\n```svg\n' + SAMPLE_SVG + '\n```\n\n后文';
const h2 = renderMarkdown(md2);
check('```svg 围栏展开为内联 SVG', h2.includes('<svg width="600"') && !h2.includes('&lt;svg') && !h2.includes('<pre>'));

const md2b = '```xml\n' + SAMPLE_SVG + '\n```';
check('```xml 围栏同样展开', renderMarkdown(md2b).includes('<svg width="600"'));

const md3 = '```mermaid\nmindmap\n  root((主题))\n```';
const h3 = renderMarkdown(md3);
check('mermaid 仍为代码块', h3.includes('<pre><code class="lang-mermaid">'));

console.log('— renderMarkdown：净化与转义 —');
const evil = '<svg width="10"><script>alert(1)</script><rect onerror="x()" onclick="y()"/><a xlink:href="javascript:alert(2)"/><rect fill="#fff"/></svg>';
const h4 = renderMarkdown(evil);
check('<script> 被剔除', !h4.includes('script'));
check('on* 事件属性被剔除', !h4.includes('onerror') && !h4.includes('onclick'));
check('javascript: 链接被剔除', !h4.includes('javascript:'));
check('无害子元素保留', h4.includes('<rect fill="#fff"/>'));
check('放行名单外的 HTML（span 等）仍转义', renderMarkdown('<span>文本</span>').includes('&lt;span&gt;文本&lt;/span&gt;'));

console.log('— renderMarkdown：既有能力不回归 —');
const mixed = '| 事项 | 负责人 |\n|---|---|\n| 写周报 | 张三 |\n\n- [x] 已完成\n- [ ] 待办\n\n> 引用文字';
const h5 = renderMarkdown(mixed);
check('表格渲染', h5.includes('<th') && h5.includes('<td>写周报</td>'));
check('任务列表渲染', h5.includes('type="checkbox" disabled checked') && h5.includes('task-item'));
check('引用块渲染', h5.includes('<blockquote>'));

console.log('— renderMarkdown：时间轴骨架放行（references/timeline.md） —');
const TL_A = [
  '<style>',
  '.tl-panel-light{background:#f5f7fa;border:1px solid #dfe4ea;border-radius:10px}',
  '.tl-ev .t{font-weight:700;font-size:14.5px;color:#1a2332}',
  '.ph-blue{--dot:#0b6bcb;--pill:#e8f1fb}',
  '</style>',
  '<div class="tl-panel-light"><div class="tl-event">',
  '  <div class="tl-ev ph-blue"><span class="d">9/10</span><span class="t">首次上报</span><div class="x">两次复测未复现</div></div>',
  '</div></div>',
].join('\n');
const tlHtml = renderMarkdown('前置文字\n\n' + TL_A + '\n\n后置文字');
check('骨架 <style>+<div> 放行渲染', tlHtml.includes('<div class="tl-panel-light">') && tlHtml.includes('<span class="d">9/10</span>'));
check('骨架样式作用域化（.md-embed 前缀）', tlHtml.includes('.md-embed .tl-panel-light{') && tlHtml.includes('.md-embed .ph-blue{'));
check('骨架包 .md-embed 容器', tlHtml.includes('<div class="md-embed">'));
check('骨架不转义', !tlHtml.includes('&lt;div class="tl-panel-light"'));
check('骨架外文本正常转义渲染', tlHtml.includes('<p>前置文字</p>') && tlHtml.includes('<p>后置文字</p>'));
const tlEvil = '<style>.tl-task{background:#1b1e24}</style><div class="tl-task"><script>alert(1)</script><div onclick="x()">a</div></div>';
const tlEvilHtml = renderMarkdown(tlEvil);
check('骨架内 <script>/on* 被剔除', !tlEvilHtml.includes('script') && !tlEvilHtml.includes('onclick'));
check('```html 围栏内的骨架放行', renderMarkdown('```html\n' + TL_A + '\n```').includes('<div class="tl-panel-light">'));
check('非骨架 ```html 围栏仍为代码块', renderMarkdown('```html\n<p>hi</p>\n```').includes('<pre><code class="lang-html">'));

console.log('— AiService.mdToHtml（技能同款交互式单文件导出） —');
const doc = svc.mdToHtml(md1, '测试标题');
check('完整 HTML 壳', doc.startsWith('<!DOCTYPE html>') && doc.includes('<style>') && doc.includes('</html>'));
check('一级标题提取为 header.top h1 + 日期胶囊（不重复出现在模块里）', doc.includes('<header class="top"><h1>标题</h1><div class="meta">') && doc.includes('class="pill"') && doc.includes('<details class="mod"') && !doc.includes('<h1>标题</h1></details>'));
check('工具栏（全部展开/折叠 + 打印导出 PDF）', doc.includes('id="expandAll"') && doc.includes('id="collapseAll"') && doc.includes('id="printBtn"'));
check('参考规格版式（白底深字 + indigo 主色 + 1280px 内容宽度）', doc.includes('background:#fff') && doc.includes('color:#1f2937') && doc.includes('#6366f1') && doc.includes('.page{max-width:1280px'));
check('模块可折叠 + 逐模块复制源码（details/modsrc/copy）', doc.includes('<details class="mod" open>') && doc.includes('class="modsrc"') && doc.includes('button class="copy"'));
check('模块内嵌 markdown 源（复制可用）', doc.includes('## 30 秒 TL;DR') || doc.split('class="modsrc"').length >= 2);
check('内联 CSS + 打印样式（打印前全展开）', doc.includes('@media print') && doc.includes('beforeprint'));
check('打印收回 A4 宽度 760px（参考 PRINT_CSS）', doc.includes('.page{max-width:760px;padding:0}'));
check('参考排版细节（h1 靛蓝下划线 / h2 左竖条 / 深色代码块 / 浅靛引用 / 行高 1.75）', doc.includes('border-bottom:3px solid #6366f1') && doc.includes('.body h2{font-size:1.3em') && doc.includes('.body pre{background:#111827') && doc.includes('border-left:4px solid #a5b4fc') && doc.includes('line-height:1.75'));
check('任务列表去圆点 + 复选框主题色（与预览 theme.css 同款）', doc.includes('li.task-item{list-style:none;margin-left:-1.2em}') && doc.includes('accent-color:#6366f1'));
check('正文含渲染后的 SVG（.fig 图框；转义 SVG 仅出现在 modsrc 复制源中）', doc.includes('<div class="fig"><svg width="600"') && doc.indexOf('<div class="fig"><svg') < doc.indexOf('class="modsrc"'));
check('表格包 .tablewrap（横滚/斑马纹/th 浅靛）', (() => {
  const t = svc.mdToHtml('| 事项 | 负责人 |\n|---|---|\n| 写周报 | 张三 |', 't');
  return t.includes('<div class="tablewrap"><table>') && t.includes('.body th{background:#eef2ff');
})());
check('mermaid 源码块标记类', svc.mdToHtml(md3, 't').includes('<pre><code class="mermaid-src">'));
check('导出保留时间轴骨架（md-embed 作用域化）', svc.mdToHtml('## 模块\n\n' + TL_A, 't').includes('<div class="md-embed"><style>.md-embed .tl-panel-light'));

console.log('— AiService.mdToHtmlAsync（mermaid 离线渲染） —');
const fakeLib = 'window.__mmdFake=1;var s="</script>";' + 'x'.repeat(60000);
const realFetch = globalThis.fetch;
globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => fakeLib });
const docM = await svc.mdToHtmlAsync('## 图\n\n```mermaid\nmindmap\n  root((主题))\n```\n\n正文', 't');
check('mermaid 源码块替换为 .mmd 卡 + pre.mermaid', docM.includes('<div class="mmd"><pre class="mermaid">') && docM.includes('mindmap'));
check('源码折叠兜底（.mmd-src）', docM.includes('<details class="mmd-src"><summary>Mermaid 源码</summary>'));
check('内嵌 mermaid 库 + 初始化（base 主题/indigo 变量）', docM.includes('window.__mmdFake=1') && docM.includes('mermaid.initialize') && docM.includes('#6366f1'));
check('mindmap/pie 独立色板也收敛 indigo（cScale/pie，不吃 primaryColor）', docM.includes('"cScale0":"#eef2ff"') && docM.includes('"cScalePeer0":"#6366f1"') && docM.includes('"pie1":"#6366f1"') && docM.includes('"cScale11":"#c7d2fe"'));
check('mindmap 下划线/连线 CSS 强制靛蓝（压过 SVG 内 #id 规则）', doc.includes('.mmd svg [class*="section-"] line{stroke:#818cf8!important}') && doc.includes('.mmd svg [class*="section-edge-"]{stroke:#a5b4fc!important}'));
check('各图型 useMaxWidth:false（自然尺寸防宽图文字挤压）', docM.includes('timeline":{"useMaxWidth":false}') || docM.includes('"timeline":{"useMaxWidth":false}'));
check('.mmd 图卡自然宽度 + 溢出横滚（非缩放）', docM.includes('.mmd{margin:14px 0;padding:12px;border:1px solid #e5e7eb;border-radius:10px;background:#fff;overflow-x:auto}') && docM.includes('.mmd pre.mermaid{width:max-content'));
check('库内 </script> 已转义防断标签', docM.includes('<\\/script>'));
check('渲染初始化脚本在 </body> 前', docM.indexOf('mermaid.run') < docM.indexOf('</body>'));
const docPlain = await svc.mdToHtmlAsync('## 无图\n\n只有正文。', 't');
check('无 mermaid 块不内嵌库', !docPlain.includes('__mmdFake'));
const svc2 = loadService('ai-service.js');
globalThis.fetch = async () => { throw new Error('offline'); };
const docFallback = await svc2.mdToHtmlAsync('## 图\n\n```mermaid\nflowchart LR\n  A --> B\n```', 't');
check('库不可用回退源码块（mermaid-src 保留、不内嵌）', docFallback.includes('mermaid-src') && !docFallback.includes('pre class="mermaid"') && !docFallback.includes('__mmdFake'));
globalThis.fetch = realFetch;
check('无标题结构回退单模块', (() => { const d = svc.mdToHtml('只有一段正文，没有任何标题。', 't'); return d.includes('details class="mod"') && d.includes('只有一段正文'); })());
const docNoRm = (() => { const rm = globalThis.renderMarkdown; globalThis.renderMarkdown = undefined; const d = svc.mdToHtml('<b>x</b>', 't'); globalThis.renderMarkdown = rm; return d; })();
check('renderMarkdown 缺失时回退转义输出', docNoRm.includes('&lt;b&gt;x&lt;/b&gt;'));

console.log('— 导出命名（总结名称 + 时间戳，对齐参考 timestampName/resultTitle） —');
check('总结名称取首个一级标题', svc.summaryFileTitle('# 会议纪要：Q4 复盘\n\n正文') === '会议纪要：Q4 复盘');
check('非法文件名字符剔除', svc.summaryFileTitle('# a/b\\c:d*e?f"g<h>i|j\n') === 'abcdefghij');
check('超长标题截断 30 字符', svc.summaryFileTitle('# ' + '长'.repeat(50)).length === 30);
check('无一级标题回退 AI总结（## 不算）', svc.summaryFileTitle('## 二级\n正文') === 'AI总结' && svc.summaryFileTitle('') === 'AI总结');
check('时间戳文件名格式 名称-YYYYMMDD-HHMMSS.ext', /^会议纪要-\d{8}-\d{6}\.html$/.test(svc.timestampName('会议纪要', 'html')));

console.log('— 双副本一致 —');
check('markdown.js 逐字一致', fs.readFileSync(path.join(root, 'markdown.js'), 'utf8') === fs.readFileSync(path.join(root, 'chrome_extension', 'markdown.js'), 'utf8'));
const a = fs.readFileSync(path.join(root, 'ai-service.js'), 'utf8');
const b = fs.readFileSync(path.join(root, 'chrome_extension', 'ai-service.js'), 'utf8');
// 锚点必须真实命中（旧锚点「导出壳」不存在 → slice(-1,…) 空串恒等，检查形同虚设）
const sec = (c) => { const i = c.indexOf('  // 单文件 HTML 导出（'); const j = c.indexOf('  function describeApiError(err) {'); return i >= 0 && j > i ? c.slice(i, j) : null; };
check('mdToHtml 段逐字一致（CSS/命名函数/mermaid 主题）', sec(a) !== null && sec(a).length > 5000 && sec(a) === sec(b));
check('双副本均导出命名函数', a.includes('summaryFileTitle: summaryFileTitle,') && b.includes('summaryFileTitle: summaryFileTitle,') && a.includes('timestampName: timestampName,') && b.includes('timestampName: timestampName,'));
for (const [f, marker] of [['workreport.js', 'AiService.summaryFileTitle(raw)'], ['email_summary.js', 'AiService.summaryFileTitle(raw)'], ['ai_parse.js', 'Ai.summaryFileTitle(currentSummaryMd)']]) {
  const r = fs.readFileSync(path.join(root, f), 'utf8');
  const e = fs.readFileSync(path.join(root, 'chrome_extension', f), 'utf8');
  check(f + ' 双副本结果区导出均按总结名称命名', r.includes(marker) && e.includes(marker) && r.includes('timestampName') && e.includes('timestampName'));
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
