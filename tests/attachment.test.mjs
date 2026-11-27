/**
 * attachment.test.mjs — 附件统一处理（v0.51.1）单元测试
 *
 * 覆盖:
 *   1. AiService 附件助手：150MB 上限校验 / 大文本首尾截断 / PDF 提取依赖守卫 / 带进度读取
 *   2. 三页接线：email_summary / ai_parse / workreport 源码引用共享助手与 UI 元素（含多文件 multiple + 循环处理 + 合并载入）
 *   3. 双副本一致：助手段逐字一致 + page JS/HTML 接线一致
 *   4. v0.52.1：解析要求/总结要求 单行input → 自动增高textarea + ⤢大编辑器弹窗（双副本 + 跨页同款）
 *   5. v0.52.2：通读优先规则——三页全部总结路径先完整理解全部输入与附件，再按用户要求总结
 *   6. v0.53.0：对齐 voice_transcription——三页统一 summarizeContent + OUTPUT_LANGS（跟随原文+16 种）+ 空 select 由 JS 渲染
 *
 * 运行: node tests/attachment.test.mjs
 */
import fs from 'fs';
import path from 'path';
import url from 'url';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..');

// —— 浏览器全局桩（同 summary-template.test.mjs）：ai-service.js 顶层挂载 AiService ——
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => { mem.set(k, String(v)); },
  removeItem: (k) => { mem.delete(k); },
};
globalThis.window = globalThis;
globalThis.addEventListener = () => {};

function loadService(relPath) {
  const code = fs.readFileSync(path.join(ROOT, relPath), 'utf8');
  return new Function(code + '\nreturn global.AiService;').call(globalThis);
}

let passed = 0, failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name); }
}

const svc = loadService('ai-service.js');
const svcExt = loadService('chrome_extension/ai-service.js');

console.log('— 附件助手（AiService） —');
check('MAX_ATTACHMENT_BYTES = 150MB', svc.MAX_ATTACHMENT_BYTES === 150 * 1024 * 1024);
check('小文件通过校验（返回 null）', svc.checkAttachment({ size: 1024, name: 'a.txt' }) === null);
check('恰好 150MB 通过校验', svc.checkAttachment({ size: 150 * 1024 * 1024, name: 'a.pdf' }) === null);
check('超过 150MB 被拒且提示含 150MB', typeof svc.checkAttachment({ size: 150 * 1024 * 1024 + 1, name: 'a.pdf' }) === 'string'
  && svc.checkAttachment({ size: 150 * 1024 * 1024 + 1, name: 'a.pdf' }).indexOf('150MB') !== -1);
check('扩展副本 MAX_ATTACHMENT_BYTES 一致', svcExt.MAX_ATTACHMENT_BYTES === svc.MAX_ATTACHMENT_BYTES);

console.log('— 大文本截断 —');
const short = svc.truncateLargeText('hello', 1000);
check('短文本原样返回', short.truncated === false && short.text === 'hello' && short.removed === 0);
const long = 'A'.repeat(600) + 'B'.repeat(2000) + 'C'.repeat(400);
const cut = svc.truncateLargeText(long, 1000);
check('超长文本触发截断', cut.truncated === true && cut.removed === 3000 - 1000);
check('保留开头 60%（600 字符）', cut.text.startsWith('A'.repeat(600)));
check('保留结尾 40%（400 字符）', cut.text.endsWith('C'.repeat(400)));
check('截断标注可见', cut.text.indexOf('已自动截取首尾共 1000 字符') !== -1 && cut.text.indexOf('省略中间 2000 字符') !== -1);
check('扩展副本截断结果一致', JSON.stringify(svcExt.truncateLargeText(long, 1000)) === JSON.stringify(cut));

console.log('— PDF 提取依赖守卫 —');
let pdfErr = '';
try { await svc.extractPdfText(new ArrayBuffer(8)); } catch (e) { pdfErr = String(e && e.message || e); }
check('无 pdfjsLib 时明确报错', pdfErr.indexOf('pdf.min.js') !== -1);
check('extractPdfText / readAttachmentText 均导出', typeof svc.extractPdfText === 'function' && typeof svc.readAttachmentText === 'function');

console.log('— 三页接线（源码级） —');
function src(p) { return fs.readFileSync(path.join(ROOT, p), 'utf8'); }
function both(p) { return [src(p), src('chrome_extension/' + p)]; }

for (const [i, s] of both('email_summary.js').entries()) {
  const tag = 'email_summary.js[' + (i ? 'ext' : 'root') + ']';
  check(tag + ' 走统一 150MB 校验', s.indexOf('AiService.checkAttachment') !== -1);
  check(tag + ' PDF 走共享 extractPdfText', s.indexOf('AiService.extractPdfText') !== -1);
  check(tag + ' 文本走共享 readAttachmentText', s.indexOf('AiService.readAttachmentText') !== -1);
  check(tag + ' 旧 200MB/10MB 拒绝规则已移除', s.indexOf('200 * 1024 * 1024') === -1 && s.indexOf('>200MB') === -1);
  check(tag + ' 多文件循环处理（超限跳过）', s.indexOf('const files = Array.from(e.target.files || [])') !== -1 && s.indexOf("status: 'extracting'") !== -1);
  check(tag + ' 附件清单模式（内容不灌入输入框）', s.indexOf('emailEditor.setMarkdown(content);') === -1 && s.indexOf("status: 'extracting'") !== -1 && s.indexOf("entry.status = 'done'") !== -1);
  check(tag + ' 附件清单渲染与逐项移除（行卡片）', s.indexOf('function renderAttachmentList') !== -1 && s.indexOf("$('fileList').addEventListener") !== -1 && s.indexOf('fi-remove') !== -1 && s.indexOf('AiService.formatBytes ? AiService.formatBytes(f.size)') !== -1);
  check(tag + ' 全文组装 buildFullText（附件分界 + 输入框正文）', s.indexOf('function buildFullText') !== -1 && s.indexOf("'===== 附件 ' + (i + 1) + '：' + f.name") !== -1);
  check(tag + ' PDF 读取走共享 readAttachmentBuffer', s.indexOf('AiService.readAttachmentBuffer') !== -1);
  check(tag + ' Office 附件走共享 extractOfficeText', s.indexOf('AiService.extractOfficeText') !== -1);
  check(tag + ' 总结要求随内容组装并注入 userPrompt（v0.53.0）', s.indexOf("const instruction = (($('summaryInstruction') || {}).value || '').trim();") !== -1 && s.indexOf('userPrompt: instruction') !== -1);
  check(tag + ' 解析要求持久化 email_summary_config.instruction', s.indexOf('config.instruction = instrInput.value.trim();') !== -1 && s.indexOf('instruction: config.instruction') !== -1);
  check(tag + ' 解析要求自动增高 + 大编辑器弹窗（v0.52.1）', s.indexOf('function autoGrowInstruction') !== -1 && s.indexOf('function initInstructionModal') !== -1 && s.indexOf('initInstructionModal();') !== -1);
  check(tag + ' 弹窗保存派发 change 复用持久化（v0.52.1）', s.indexOf("el.dispatchEvent(new Event('change'))") !== -1);
  check(tag + ' 统一走 AiService.summarizeContent（v0.53.0，不再 looksLikeEmail 分支）', s.indexOf('_as.summarizeContent({') !== -1 && s.indexOf('AiService.looksLikeEmail') === -1);
  check(tag + ' 旧 SKILL/DOC 默认提示词已移除（统一 G-SPEC）', s.indexOf('const SKILL_PROMPT') === -1 && s.indexOf('const DOC_SUMMARY_PROMPT') === -1 && s.indexOf("template: tplId !== 'default' ? tplId : ''") !== -1);
  check(tag + ' 超长输入不再首尾截断（map-reduce 由 AiService 处理）', s.indexOf('function autoTruncate') === -1 && s.indexOf('const MAX_INPUT_CHARS') === -1 && s.indexOf('map-reduce') !== -1);
}
for (const [i, s] of both('ai_parse.js').entries()) {
  const tag = 'ai_parse.js[' + (i ? 'ext' : 'root') + ']';
  check(tag + ' 走统一 150MB 校验', s.indexOf('Ai.checkAttachment') !== -1);
  check(tag + ' PDF 走共享 extractPdfText（修复 readAsText 乱码）', s.indexOf('Ai.extractPdfText') !== -1 && s.indexOf('Ai.readTextFile(f)') === -1);
  check(tag + ' 文本走共享 readAttachmentText', s.indexOf('Ai.readAttachmentText') !== -1);
  check(tag + ' PDF 读取走共享 readAttachmentBuffer', s.indexOf('Ai.readAttachmentBuffer') !== -1);
  check(tag + ' Office 附件走共享 extractOfficeText', s.indexOf('Ai.extractOfficeText') !== -1);
  check(tag + ' 配置 pdf worker', s.indexOf("pdfjsLib.GlobalWorkerOptions.workerSrc = 'pdf.worker.min.js'") !== -1);
}
for (const [i, s] of both('ai_parse.html').entries()) {
  check('ai_parse.html[' + (i ? 'ext' : 'root') + '] 引入 pdf.min.js', s.indexOf('<script src="pdf.min.js"></script>') !== -1);
  check('ai_parse.html[' + (i ? 'ext' : 'root') + '] fileInput 支持多文件', /id="fileInput"[^>]*multiple/.test(s));
  check('ai_parse.html[' + (i ? 'ext' : 'root') + '] accept 含 Office 格式', s.indexOf('.docx,.xlsx,.xlsm,.pptx') !== -1);
  check('ai_parse.html[' + (i ? 'ext' : 'root') + '] 附件清单容器与卡片样式', s.indexOf('id="fileList"') !== -1 && s.indexOf('.fi-meta') !== -1);
}
for (const [i, s] of both('workreport.js').entries()) {
  const tag = 'workreport.js[' + (i ? 'ext' : 'root') + ']';
  check(tag + ' 附件处理函数', s.indexOf('function handleAttachments') !== -1 && s.indexOf('function clearWorkInput') !== -1);
  check(tag + ' 走统一 150MB 校验', s.indexOf('AiService.checkAttachment') !== -1);
  check(tag + ' PDF/文本走共享助手', s.indexOf('AiService.extractPdfText') !== -1 && s.indexOf('AiService.readAttachmentText') !== -1);
  check(tag + ' 绑定选择附件/清单移除/清空输入', s.indexOf("$('selectFileBtn')") !== -1 && s.indexOf("$('fileList')") !== -1 && s.indexOf("$('clearInputBtn')") !== -1);
  check(tag + ' 多文件循环处理（超限跳过）', s.indexOf('handleAttachments(files)') !== -1 && s.indexOf("status: 'extracting'") !== -1);
  check(tag + ' 处理前拷贝 FileList（防清空后失效）', s.indexOf('Array.prototype.slice.call(e.target.files || [])') !== -1);
  check(tag + ' 附件清单模式（内容不灌入输入框）', s.indexOf('workEditor.setMarkdown(content);') === -1 && s.indexOf("status: 'extracting'") !== -1 && s.indexOf("entry.status = 'done'") !== -1);
  check(tag + ' PDF 读取走共享 readAttachmentBuffer', s.indexOf('AiService.readAttachmentBuffer') !== -1);
  check(tag + ' Office 附件走共享 extractOfficeText', s.indexOf('AiService.extractOfficeText') !== -1);
  check(tag + ' 无记录时兜底：附件清单 + 输入框正文', s.indexOf('var usingEditor = false;') !== -1 && s.indexOf('function buildInputSourceText') !== -1 && s.indexOf("!draftText && !loadedFiles.some") !== -1);
  check(tag + ' 总结要求随内容组装并注入 userPrompt（v0.53.0）', s.indexOf("const instruction = (($('summaryInstruction') || {}).value || '').trim();") !== -1 && s.indexOf('userPrompt: instruction') !== -1);
  check(tag + ' 解析要求持久化 work_config.summaryInstruction', s.indexOf('config.summaryInstruction = this.value.trim();') !== -1 && s.indexOf('summaryInstruction: config.summaryInstruction') !== -1);
  check(tag + ' 解析要求自动增高 + 大编辑器弹窗（v0.52.1）', s.indexOf('function autoGrowInstruction') !== -1 && s.indexOf('function initInstructionModal') !== -1 && s.indexOf('initInstructionModal();') !== -1 && s.indexOf('autoGrowInstruction();') !== -1);
  check(tag + ' 弹窗保存派发 change 复用持久化（v0.52.1）', s.indexOf("el.dispatchEvent(new Event('change'))") !== -1);
  check(tag + ' 配置 pdf worker', s.indexOf("pdfjsLib.GlobalWorkerOptions.workerSrc = 'pdf.worker.min.js'") !== -1);
}
for (const [i, s] of both('workreport.html').entries()) {
  const tag = 'workreport.html[' + (i ? 'ext' : 'root') + ']';
  check(tag + ' 附件按钮/文件标签/清空输入齐全', s.indexOf('id="selectFileBtn"') !== -1 && s.indexOf('id="fileList"') !== -1 && s.indexOf('id="clearInputBtn"') !== -1);
  check(tag + ' 工具栏样式与附件清单容器', s.indexOf('.input-toolbar') !== -1 && s.indexOf('.file-list') !== -1 && s.indexOf('.file-item') !== -1 && s.indexOf('id="fileList"') !== -1);
  check(tag + ' 引入 pdf.min.js', s.indexOf('<script src="pdf.min.js"></script>') !== -1);
  check(tag + ' fileInput 支持多文件', /id="fileInput"[^>]*multiple/.test(s));
  check(tag + ' accept 含 Office 格式', s.indexOf('.docx,.xlsx,.xlsm,.pptx') !== -1);
  check(tag + ' 解析要求输入框存在', s.indexOf('id="summaryInstruction"') !== -1);
  check(tag + ' 解析要求为自动增高 textarea（v0.52.1）', /<textarea[^>]*id="summaryInstruction"/.test(s) && s.indexOf('type="text" id="summaryInstruction"') === -1 && s.indexOf('.instruction-wrap') !== -1);
  check(tag + ' 解析要求 ⤢ 展开按钮 + 大编辑器弹窗（v0.52.1）', s.indexOf('id="instrExpandBtn"') !== -1 && s.indexOf('id="instrModalOverlay"') !== -1 && s.indexOf('id="instrModalText"') !== -1 && s.indexOf('.instr-modal') !== -1);
}
for (const [i, s] of both('email_summary.html').entries()) {
  check('email_summary.html[' + (i ? 'ext' : 'root') + '] fileInput 支持多文件', /id="fileInput"[^>]*multiple/.test(s));
  check('email_summary.html[' + (i ? 'ext' : 'root') + '] accept 含 Office 格式', s.indexOf('.docx,.xlsx,.xlsm,.pptx') !== -1);
  check('email_summary.html[' + (i ? 'ext' : 'root') + '] 解析要求输入框存在', s.indexOf('id="summaryInstruction"') !== -1);
  check('email_summary.html[' + (i ? 'ext' : 'root') + '] 总结要求为自动增高 textarea（v0.52.1）', /<textarea[^>]*id="summaryInstruction"/.test(s) && s.indexOf('type="text" id="summaryInstruction"') === -1 && s.indexOf('.instruction-wrap') !== -1);
  check('email_summary.html[' + (i ? 'ext' : 'root') + '] 总结要求 ⤢ 展开按钮 + 大编辑器弹窗（v0.52.1）', s.indexOf('id="instrExpandBtn"') !== -1 && s.indexOf('id="instrModalOverlay"') !== -1 && s.indexOf('id="instrModalText"') !== -1 && s.indexOf('.instr-modal') !== -1);
}
for (const [i, s] of both('email_summary.html').entries()) {
  check('email_summary.html[' + (i ? 'ext' : 'root') + '] fileInput 支持多文件', /id="fileInput"[^>]*multiple/.test(s));
}
check('readAttachmentBuffer 均导出（双副本）', typeof svc.readAttachmentBuffer === 'function' && typeof svcExt.readAttachmentBuffer === 'function');

console.log('— Office 文档提取（docx/xlsx/pptx，v0.52.0） —');
check('detectOfficeKind 识别 docx/xlsx/xlsm/pptx', svc.detectOfficeKind('a.docx') === 'docx' && svc.detectOfficeKind('b.XLSX') === 'xlsx' && svc.detectOfficeKind('c.xlsm') === 'xlsx' && svc.detectOfficeKind('d.pptx') === 'pptx');
check('detectOfficeKind 拒绝旧二进制格式', svc.detectOfficeKind('a.doc') === '' && svc.detectOfficeKind('b.xls') === '' && svc.detectOfficeKind('c.ppt') === '' && svc.detectOfficeKind('d.pdf') === '');
check('扩展副本 detectOfficeKind 一致', svcExt.detectOfficeKind('a.docx') === svc.detectOfficeKind('a.docx'));

const DOCX_XML = '<w:document><w:body>'
  + '<w:p><w:r><w:t>评审纪要标题</w:t></w:r><w:r><w:t>第一段</w:t></w:r></w:p>'
  + '<w:p><w:fldSimple w:instr="PAGE"><w:r><w:instrText>PAGE</w:instrText></w:r></w:fldSimple><w:r><w:t>决议一：按期发货</w:t></w:r></w:p>'
  + '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>风险项</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>负责人</w:t></w:r></w:p></w:tc></w:tr>'
  + '<w:tr><w:tc><w:p><w:r><w:t>缺料</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>李四</w:t></w:r></w:p></w:tc></w:tr></w:tbl>'
  + '</w:body></w:document>';
const docxOut = svc.docxXmlToText(DOCX_XML);
check('docx 段落换行', docxOut.indexOf('评审纪要标题第一段\n') !== -1);
check('docx 表格单元格制表符分隔', docxOut.indexOf('风险项\t负责人\n缺料\t李四') !== -1);
check('docx 域代码 instrText 已剔除', docxOut.indexOf('instrText') === -1 && docxOut.indexOf('PAGE') === -1);
check('docx 实体解码', svc.docxXmlToText('<w:p><w:r><w:t>A &amp; B &lt;C&gt;</w:t></w:r></w:p>').indexOf('A & B <C>') !== -1);
check('扩展副本 docx 提取一致', svcExt.docxXmlToText(DOCX_XML) === docxOut);

const SHARED = ['站点', '良率', '深圳FTA', '99.2%'];
const SHEET1 = '<worksheet><sheetData>'
  + '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>'
  + '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" t="s"><v>3</v></c></row>'
  + '<row r="3"><c r="A3"><v>128</v></c><c r="B3"><v>97.8</v></c></row>'
  + '</sheetData></worksheet>';
const xlsxOut = svc.xlsxXmlToText(SHEET1, SHARED, '测试良率');
check('xlsx 表名标题行', xlsxOut.indexOf('## 测试良率\n') === 0);
check('xlsx 共享字符串还原', xlsxOut.indexOf('站点 | 良率') !== -1 && xlsxOut.indexOf('深圳FTA | 99.2%') !== -1);
check('xlsx 数值单元格', xlsxOut.indexOf('128 | 97.8') !== -1);
check('xlsx inlineStr 单元格', svc.xlsxXmlToText('<row><c t="inlineStr"><is><t>备注文字</t></is></c></row>', [], 'S').indexOf('备注文字') !== -1);
check('xlsx 空表返回空串', svc.xlsxXmlToText('<row><c r="A1"><v></v></c></row>', [], 'S') === '');
check('扩展副本 xlsx 提取一致', svcExt.xlsxXmlToText(SHEET1, SHARED, '测试良率') === xlsxOut);

const SLIDE_XML = '<p:sld><p:spTree><p:sp><p:txBody>'
  + '<a:p><a:r><a:t>标题：良率周报</a:t></a:r></a:p>'
  + '<a:p><a:r><a:t>重点：99.2%</a:t></a:r><a:r><a:t> 达标</a:t></a:r></a:p>'
  + '</p:txBody></p:sp></p:spTree></p:sld>';
const pptxOut = svc.pptxXmlToText(SLIDE_XML, 2);
check('pptx 幻灯片编号标题', pptxOut.indexOf('## 幻灯片 2\n') === 0);
check('pptx 段落分行与 run 拼接', pptxOut.indexOf('标题：良率周报\n重点：99.2% 达标') !== -1);
check('扩展副本 pptx 提取一致', svcExt.pptxXmlToText(SLIDE_XML, 2) === pptxOut);

let officeErr = '';
try { await svc.extractOfficeText({ name: 'legacy.doc', size: 10 }); } catch (e) { officeErr = String(e && e.message || e); }
check('旧格式 .doc 明确报错并指引转换', officeErr.indexOf('.docx') !== -1 && officeErr.indexOf('另存') !== -1);
let zipErr = '';
try { await svc.extractOfficeText({ name: 'a.docx', size: 10 }); } catch (e) { zipErr = String(e && e.message || e); }
check('非浏览器环境 JSZip 明确报错', zipErr.indexOf('JSZip') !== -1);
check('extractOfficeText / docxXmlToText / xlsxXmlToText / pptxXmlToText 均导出', typeof svc.extractOfficeText === 'function' && typeof svc.docxXmlToText === 'function' && typeof svc.xlsxXmlToText === 'function' && typeof svc.pptxXmlToText === 'function');

console.log('— HTML 附件转可读文本（文件形式的邮件内容，v0.52.0） —');
const HTML_EMAIL = '<!DOCTYPE html><html><head><style>b{color:red}</style><script>noise()</script></head>'
  + '<body><p><b>From:</b> buyer@example.com</p><p><b>Subject:</b> Maple packs schedule</p>'
  + '<table><tr><td>Item</td><td>Qty</td></tr><tr><td>Maple packs</td><td>1,400pcs</td></tr></table>'
  + '<p>Please confirm by 9/15.</p></body></html>';
const htmlOut = svc.htmlToPlainText(HTML_EMAIL);
check('html 去 script/style', htmlOut.indexOf('noise') === -1 && htmlOut.indexOf('color:red') === -1);
check('html 头部保留可被邮件识别', svc.looksLikeEmail(htmlOut) === true);
check('html 表格单元格制表符分隔', htmlOut.indexOf('Item\tQty\nMaple packs\t1,400pcs') !== -1);
check('html 实体解码', svc.htmlToPlainText('<p>A &amp; B</p>').indexOf('A & B') !== -1);
check('html 普通文档转干净文本', svc.htmlToPlainText('<div><h1>标题</h1><p>正文段落</p><br><p>第二段</p></div>') === '标题\n正文段落\n\n第二段');
check('扩展副本 html 提取一致', svcExt.htmlToPlainText(HTML_EMAIL) === htmlOut);
check('htmlToPlainText 导出', typeof svc.htmlToPlainText === 'function');
let msgErr = '';
try { await svc.readAttachmentText({ name: 'outlook.msg', size: 100 }); } catch (e) { msgErr = String(e && e.message || e); }
check('.msg 二进制格式明确报错并指引 .eml/.html', msgErr.indexOf('.msg') !== -1 && msgErr.indexOf('.eml') !== -1);

console.log('— 双副本一致（新增段逐字） —');
// ai-service.js 附件助手段：从段首注释到「单文件 HTML 导出」注释前
function sliceBetween(s, from, to) {
  // 根目录/扩展副本行尾历史不一致（CRLF vs LF），比对前归一化
  s = s.replace(/\r\n/g, '\n');
  const a = s.indexOf(from), b = s.indexOf(to);
  return (a === -1 || b === -1 || b <= a) ? null : s.slice(a, b);
}
const helperRoot = sliceBetween(src('ai-service.js'), '/* ==================== 附件统一处理', '  // 单文件 HTML 导出');
const helperExt = sliceBetween(src('chrome_extension/ai-service.js'), '/* ==================== 附件统一处理', '  // 单文件 HTML 导出');
check('ai-service.js 附件助手段逐字一致', helperRoot !== null && helperRoot === helperExt);

const jszipRoot = fs.readFileSync(path.join(ROOT, 'jszip.min.js'), 'utf8');
const jszipExt = fs.readFileSync(path.join(ROOT, 'chrome_extension/jszip.min.js'), 'utf8');
check('jszip.min.js 双副本一致且为真实库', jszipRoot === jszipExt && jszipRoot.length > 50000 && jszipRoot.indexOf('JSZip') !== -1);

check('email_summary.js 双副本整体一致', src('email_summary.js') === src('chrome_extension/email_summary.js'));
check('ai_parse.js 双副本整体一致', src('ai_parse.js') === src('chrome_extension/ai_parse.js'));
const wrSectionRoot = sliceBetween(src('workreport.js'), '// ===== 附件支持', '// ===== Save / Update Record');
const wrSectionExt = sliceBetween(src('chrome_extension/workreport.js'), '// ===== 附件支持', '// ===== Save / Update Record');
check('workreport.js 附件段逐字一致', wrSectionRoot !== null && wrSectionRoot === wrSectionExt);
const wrBindRoot = sliceBetween(src('workreport.js'), '// 附件与清空输入', "btn = $('applyFilterBtn');");
const wrBindExt = sliceBetween(src('chrome_extension/workreport.js'), '// 附件与清空输入', "btn = $('applyFilterBtn');");
check('workreport.js 绑定段逐字一致', wrBindRoot !== null && wrBindRoot === wrBindExt);
check('workreport.html 工具栏段逐字一致',
  sliceBetween(src('workreport.html'), '<div class="input-toolbar">', '<div id="workInput"')
  === sliceBetween(src('chrome_extension/workreport.html'), '<div class="input-toolbar">', '<div id="workInput"'));

// 解析要求字段升级段（v0.52.1）：双副本逐字 + 跨页同款
const INSTR_FROM = '// ===== 解析要求字段升级（v0.52.1）';
const INSTR_TO = '// ===== 解析要求字段升级（结束） =====';
const instrWrRoot = sliceBetween(src('workreport.js'), INSTR_FROM, INSTR_TO);
const instrWrExt = sliceBetween(src('chrome_extension/workreport.js'), INSTR_FROM, INSTR_TO);
check('workreport.js 解析要求升级段逐字一致', instrWrRoot !== null && instrWrRoot === instrWrExt);
const instrEsRoot = sliceBetween(src('email_summary.js'), INSTR_FROM, INSTR_TO);
const instrEsExt = sliceBetween(src('chrome_extension/email_summary.js'), INSTR_FROM, INSTR_TO);
check('email_summary.js 解析要求升级段逐字一致', instrEsRoot !== null && instrEsRoot === instrEsExt);
check('两页解析要求升级段跨页同款', instrWrRoot !== null && instrWrRoot === instrEsRoot);

// 通读优先规则（v0.52.2）：三页全部总结路径必须先完整理解全部输入与附件再按要求总结
console.log('— 通读优先规则（v0.52.2） —');
check('READ_FIRST_RULE 中文规则导出', typeof svc.READ_FIRST_RULE === 'string' && svc.READ_FIRST_RULE.indexOf('通读优先') !== -1 && svc.READ_FIRST_RULE.indexOf('【用户额外要求】') !== -1);
check('READ_FIRST_RULE_EN 英文规则导出', typeof svc.READ_FIRST_RULE_EN === 'string' && svc.READ_FIRST_RULE_EN.indexOf('fully read and understand') !== -1);
check('25 套模板提示词全部注入通读优先', svc.SUMMARY_TEMPLATES.every((t) => svc.summaryTemplatePrompt(t.id, '中文').indexOf('通读优先') !== -1));
check('自由分析默认提示词注入通读优先', svc.PROMPTS.analyze.indexOf('通读优先') !== -1);
const aiSrc = src('ai-service.js');
check('旧 analyzePrompt/emailPrompt 已移除，统一 freeSummaryPrompt + summarizeContent', aiSrc.indexOf('function analyzePrompt') === -1 && aiSrc.indexOf('function emailPrompt') === -1 && aiSrc.indexOf('function freeSummaryPrompt') !== -1 && aiSrc.indexOf('function summarizeContent') !== -1);
check('默认路径统一注入通读优先（freeSummaryPrompt → PROMPTS.analyze）', svc.freeSummaryPrompt('').indexOf('通读优先') !== -1 && svc.PROMPTS.analyze === svc.freeSummaryPrompt(''));
const RF_FROM = '// ===== 通读优先规则（v0.52.2） =====';
const RF_TO = '// ===== 通读优先规则（结束） =====';
const rfRoot = sliceBetween(aiSrc, RF_FROM, RF_TO);
const rfExt = sliceBetween(src('chrome_extension/ai-service.js'), RF_FROM, RF_TO);
check('ai-service.js 通读优先段双副本逐字一致', rfRoot !== null && rfRoot === rfExt);
for (const [tag, rel] of [['root', 'workreport.js'], ['ext', 'chrome_extension/workreport.js']]) {
  const s = src(rel);
  check(tag + ' workreport 统一走 summarizeContent（通读优先由 AiService 注入）', s.indexOf('_as.summarizeContent({') !== -1 && s.indexOf('userPrompt: instruction') !== -1 && s.indexOf('var readFirstRule') === -1);
}
for (const [tag, rel] of [['root', 'email_summary.js'], ['ext', 'chrome_extension/email_summary.js']]) {
  const s = src(rel);
  check(tag + ' email 统一走 summarizeContent（旧 SKILL 铁律段已移除）', s.indexOf('_as.summarizeContent({') !== -1 && s.indexOf('7. **通读优先**') === -1);
}

// v0.53.0 对齐 voice_transcription：语言表统一 + HTML 空 select + wechat 排除 auto
console.log('— v0.53.0 输出语言统一（跟随原文 + 16 种） —');
check('OUTPUT_LANGS 17 项且首项 auto（name 空＝跟随原文）', svc.OUTPUT_LANGS.length === 17 && svc.OUTPUT_LANGS[0].code === 'auto' && svc.OUTPUT_LANGS[0].name === '');
for (const [tag, rel, marker] of [
  ['root', 'workreport.js', 'AiService.OUTPUT_LANGS.map'],
  ['ext', 'chrome_extension/workreport.js', 'AiService.OUTPUT_LANGS.map'],
  ['root', 'email_summary.js', 'AiService.OUTPUT_LANGS.map'],
  ['ext', 'chrome_extension/email_summary.js', 'AiService.OUTPUT_LANGS.map'],
  ['root', 'ai_parse.js', 'Ai.OUTPUT_LANGS.map'],
  ['ext', 'chrome_extension/ai_parse.js', 'Ai.OUTPUT_LANGS.map'],
]) {
  check(tag + ' ' + rel + ' 语言下拉由 OUTPUT_LANGS 渲染', src(rel).indexOf(marker) !== -1);
}
for (const [i, s] of both('workreport.html').entries()) {
  const tag = 'workreport.html[' + (i ? 'ext' : 'root') + ']';
  check(tag + ' outputLang 空 select 由 JS 渲染', /<select id="outputLang"><!-- v0\.53\.0[^>]*--><\/select>/.test(s));
  check(tag + ' 输入语言侧隐藏（不再参与组 prompt）', s.indexOf('id="inputLang"') !== -1 && s.indexOf('class="lang-select-wrap" style="display:none;"') !== -1);
}
for (const [i, s] of both('email_summary.html').entries()) {
  check('email_summary.html[' + (i ? 'ext' : 'root') + '] outputLang 空 select 由 JS 渲染', /<select id="outputLang"><!-- v0\.53\.0[^>]*--><\/select>/.test(s));
}
for (const [i, s] of both('wechat_schedule.js').entries()) {
  check('wechat_schedule.js[' + (i ? 'ext' : 'root') + '] 语言下拉排除 auto（保持显式选语言）', s.indexOf(".filter(function (l) { return l.code !== 'auto'; })") !== -1);
}
for (const [i, s] of both('workreport.js').entries()) {
  check('workreport.js[' + (i ? 'ext' : 'root') + '] LANG_NAMES_EN 已移除', s.indexOf('LANG_NAMES_EN') === -1);
}
check('ai_parse 附件分界与正文置末（v0.53.0）', src('ai_parse.js').indexOf("'===== 附件 ' + (parts.length + 1)") !== -1);

console.log('');
console.log(`共 ${passed + failed} 项断言: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
