/**
 * summary-template.test.mjs — 总结模板 + v0.53.0 对齐 voice_transcription 单元测试
 *
 * 覆盖:
 *   1. SUMMARY_TEMPLATES 清单（25 套 × 5 场景）与 getSummaryTemplate 往返
 *   2. summaryTemplatePrompt：25 套专属正文关键词 + 共享【输出契约】G-SPEC + 【本任务说明】
 *      + 通读优先 + 【用户额外要求】 + 【输出语言】①-⑦ 清单（置最末，防契约衰减）
 *   3. OUTPUT_LANGS：跟随原文(auto) + 16 种常用语言，与参考项目字面对齐；未知回退 auto
 *   4. freeSummaryPrompt：三页默认模式统一 G-SPEC；auto 不注入语言指令
 *   5. summarizeContent：短文本直出 / 超长 map-reduce（8000/块、并发 2、上限 120）/
 *      页面级 config 透传 / onProgress 阶段 / AbortError
 *   6. analyzeContent 委托 summarizeContent（旧 email playbook 已移除）
 *   7. 根目录与 chrome_extension 双副本一致
 *
 * 运行: node tests/summary-template.test.mjs
 */
import fs from 'fs';
import path from 'path';
import url from 'url';

const here = path.dirname(url.fileURLToPath(import.meta.url));

// —— 浏览器全局桩：ai-service.js 顶层经 (function(global){...})(window || this) 挂载 AiService，
//    chat() 读 localStorage('translate_config')，proxyFetch 非 extension 环境走 globalThis.fetch ——
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => { mem.set(k, String(v)); },
  removeItem: (k) => { mem.delete(k); },
};
// ai-service.js 顶层注册桥接收通道（window.addEventListener('message', ...)），node 下以全局桩代替
globalThis.window = globalThis;
globalThis.addEventListener = () => {};

function loadService(relPath) {
  const code = fs.readFileSync(path.join(here, '..', relPath), 'utf8');
  // new Function 体内为 sloppy 模式，顶层 this = globalThis
  return new Function(code + '\nreturn global.AiService;').call(globalThis);
}

let passed = 0, failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name); }
}

const svc = loadService('ai-service.js');

console.log('— 模板清单 —');
const EXPECT_IDS = ['M1','M2','M3','M4','M5','D1','D2','D3','D4','D5','T1','T2','T3','T4','T5','E1','E2','E3','E4','E5','W1','W2','W3','W4','W5'];
check('共 25 套模板', svc.SUMMARY_TEMPLATES.length === 25);
check('id 集合 M1-W5', JSON.stringify(svc.SUMMARY_TEMPLATES.map((t) => t.id)) === JSON.stringify(EXPECT_IDS));
check('每套模板 label/hint/scene 齐全', svc.SUMMARY_TEMPLATES.every((t) => t.id && t.label && t.hint && t.scene));
check('scene 五组各 5 套', ['会议纪要','日报周报','任务提取','邮件总结','邮件撰写']
  .every((sc) => svc.SUMMARY_TEMPLATES.filter((t) => t.scene === sc).length === 5));
check('getSummaryTemplate 往返', svc.getSummaryTemplate('M1')?.id === 'M1' && svc.getSummaryTemplate('W5')?.id === 'W5' && svc.getSummaryTemplate('nope') === null);
check('旧 ai-template-kit 模板 id 已移除', ['exec','weekly','kpt','star','minutes','chart','fishbone','mindmap'].every((id) => svc.getSummaryTemplate(id) === null));

console.log('— prompt 构建（zh） —');
// 每套专属正文首行角色名（来自 scenario-skills.md 各提示词第一句，非共享契约内容）
const ROLE = {
  M1: '会议纪要专家', M2: '嵌入式/硬件技术评审纪要员', M3: '项目同步纪要员', M4: '商务会议记录与跟进专家', M5: '引导式讨论整理师',
  D1: '日报撰写助手', D2: '周报撰写助手', D3: '固件/硬件测试工程日报员', D4: 'PM项目周报员', D5: '高管汇报撰稿人',
  T1: '行动项提取专家', T2: '研发工单转化员', T3: '沟通任务挖掘员', T4: '测试缺陷管理员', T5: 'GTD教练',
  E1: '邮件速读助手', E2: '邮件线程分析员', E3: '技术邮件分析员', E4: '收件箱分诊员', E5: '客户邮件分析员',
  W1: '商务邮件撰稿人', W2: '技术邮件撰稿人', W3: '邮件审查编辑', W4: '回复策略顾问', W5: '跨文化沟通撰稿人',
};
for (const t of svc.SUMMARY_TEMPLATES) {
  const p = svc.summaryTemplatePrompt(t.id, '中文');
  check(t.id + ' 含专属正文+契约+本任务说明', p.includes(ROLE[t.id]) && p.includes('【输出契约】') && p.includes('【本任务说明】'));
  check(t.id + ' 契约仅拼接一次', p.split('【输出契约】').length - 1 === 1);
  check(t.id + ' zh 输出语言规则（①-⑦ 清单）', p.includes('【输出语言】') && p.includes('一律用「中文」书写') && p.includes('⑦ 保真'));
  check(t.id + ' 注入通读优先', p.includes('通读优先'));
}
check('未知模板返回空串（回退默认 prompt）', svc.summaryTemplatePrompt('nope', '中文') === '');

console.log('— 时间轴骨架注入（references/timeline.md） —');
const TL_IDS = ['M1', 'M2', 'M3', 'M4', 'D2', 'D4', 'T3', 'E2'];
const TL_MARKS = ['时间轴视觉规范', 'tl-panel-light', 'tl-task', 'ph-blue', 'st-ip', '不要放进代码围栏'];
for (const id of TL_IDS) {
  const p = svc.summaryTemplatePrompt(id, '中文');
  check(id + ' 注入两套时间轴骨架', TL_MARKS.every((k) => p.includes(k)));
}
for (const id of ['D1', 'D3', 'D5', 'T1', 'T5', 'E1', 'E4', 'W1', 'W3']) {
  check(id + ' 不注入时间轴骨架', !svc.summaryTemplatePrompt(id, '中文').includes('tl-panel-light'));
}

console.log('— prompt 结构顺序与用户要求（v0.53.0） —');
const ordered = svc.summaryTemplatePrompt('M1', '简体中文', '重点提取风险与截止时间');
const idx = (s) => ordered.indexOf(s);
check('顺序：正文→G-SPEC→本任务说明→通读优先→用户额外要求→输出语言',
  idx(ROLE.M1) < idx('【输出契约】') && idx('【输出契约】') < idx('【本任务说明】')
  && idx('【本任务说明】') < idx('通读优先') && idx('通读优先') < idx('【用户额外要求】')
  && idx('【用户额外要求】') < idx('【输出语言】'));
check('用户要求原样注入', ordered.includes('【用户额外要求】重点提取风险与截止时间'));
check('语言指令收尾（防契约衰减）', ordered.endsWith('以本要求为准。'));
const autoTpl = svc.summaryTemplatePrompt('M1', '');
check('auto（空语言名）不注入语言指令', !autoTpl.includes('【输出语言】') && autoTpl.includes('写【待确认】'));
check('指定语言时占位符说明改用等义标记', svc.summaryTemplatePrompt('M1', 'English').includes('用输出语言的等义占位标记标注'));

console.log('— OUTPUT_LANGS（跟随原文 + 16 种，字面对齐参考项目） —');
check('共 17 项且首项 auto', svc.OUTPUT_LANGS.length === 17 && svc.OUTPUT_LANGS[0].code === 'auto' && svc.OUTPUT_LANGS[0].label === '跟随原文' && svc.OUTPUT_LANGS[0].name === '');
check('16 种语言 code 集合', JSON.stringify(svc.OUTPUT_LANGS.slice(1).map((l) => l.code))
  === JSON.stringify(['zh','zh-TW','en','ja','ko','fr','de','es','pt','it','ru','ar','hi','th','vi','id']));
check('name 与 label 一致（注入提示词用）', svc.OUTPUT_LANGS.slice(1).every((l) => l.name === l.label));
check('未知/缺省 code 回退 auto', svc.getOutputLang('nl').code === 'auto' && svc.getOutputLang(undefined).code === 'auto' && svc.getOutputLang('tr').name === '');

console.log('— freeSummaryPrompt（三页默认模式统一 G-SPEC） —');
const free = svc.freeSummaryPrompt('');
check('默认含角色+G-SPEC+通读优先+默认用户要求', free.includes('内容总结助手') && free.includes('【输出契约】')
  && free.includes('通读优先') && free.includes('【用户额外要求】请给出全面而精炼的总结'));
check('auto 不注入语言指令且占位写【待确认】', !free.includes('【输出语言】') && free.includes('缺失信息写【待确认】'));
const freeEn = svc.freeSummaryPrompt('English（英语）', '只列待办');
check('指定语言：①-⑦ 清单置最末', freeEn.includes('【输出语言】') && freeEn.includes('English（英语）')
  && freeEn.lastIndexOf('【输出语言】') > freeEn.lastIndexOf('通读优先') && freeEn.endsWith('以本要求为准。'));
check('用户要求覆盖默认要求', freeEn.includes('【用户额外要求】只列待办') && !freeEn.includes('请给出全面而精炼的总结'));
check('outputLangNote 空串返回空', svc.outputLangNote('') === '' && svc.outputLangNote(null) === '');
check('outputLangNote ①-⑦ 齐全', ['①','②','③','④','⑤','⑥','⑦'].every((n) => svc.outputLangNote('English').includes(n)));

console.log('— prompt 构建（非中文输出） —');
const enM1 = svc.summaryTemplatePrompt('M1', 'English');
check('en 输出语言覆盖段', enM1.includes('【输出语言】') && enM1.includes('English'));
check('OUTPUT_LANGS zh 名称注入', svc.summaryTemplatePrompt('M1', svc.getOutputLang('zh').name).includes('一律用「简体中文」书写'));
check('OUTPUT_LANGS en 名称注入', svc.summaryTemplatePrompt('M1', svc.getOutputLang('en').name).includes('一律用「English（英语）」书写'));

console.log('— analyzeContent / summarizeContent 接入（短文本） —');
svc.saveConfig({ baseUrl: 'https://api.example.com/v1', apiKey: 'sk-test', model: 'test-model' });
let calls = [];
let active = 0, maxActive = 0;
globalThis.fetch = async (reqUrl, options) => {
  const body = JSON.parse(options.body);
  active++; maxActive = Math.max(maxActive, active);
  await new Promise((r) => setTimeout(r, 5));
  active--;
  calls.push({ url: reqUrl, body });
  const isMap = body.messages[0].content === svc.MAP_SYSTEM;
  return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: isMap ? '- 片段要点' + calls.length : '# 总结OK' } }] }) };
};
await svc.analyzeContent({ instructions: '', content: '材料', email: true, lang: 'zh', template: 'M1' });
check('显式 template 走模板提示词', calls.at(-1)?.body?.messages?.[0]?.content?.includes('会议纪要专家'));
calls = [];
await svc.analyzeContent({ instructions: '', content: '材料', email: true, lang: 'zh', template: '' });
const sysDefault = calls.at(-1)?.body?.messages?.[0]?.content || '';
check('无 template 统一自由总结 + G-SPEC（旧邮件 playbook 已移除）',
  sysDefault.includes('内容总结助手') && sysDefault.includes('【输出契约】') && !sysDefault.includes('邮件线程详细总结'));
check('用户消息以全文分界开头', calls.at(-1)?.body?.messages?.[1]?.content?.startsWith('===== 全文内容 =====\n材料'));
check('最终阶段 temperature 0.3', calls.at(-1)?.body?.temperature === 0.3);
calls = [];
await svc.analyzeContent({ instructions: '重点提取风险', content: '材料', lang: 'en', template: '' });
const sysEn = calls.at(-1)?.body?.messages?.[0]?.content || '';
check('instructions → 【用户额外要求】；lang en → 语言指令', sysEn.includes('【用户额外要求】重点提取风险') && sysEn.includes('【输出语言】') && sysEn.includes('English（英语）'));
calls = []; maxActive = 0;
await svc.summarizeContent({ content: '短文', lang: 'auto', config: { baseUrl: 'https://page.example.com/v1', apiKey: 'sk-page', model: 'm' } });
check('页面级 config 透传（不读 translate_config）', calls.length === 1 && calls[0].url.startsWith('https://page.example.com'));
check('auto 短文本不注入语言指令', !calls[0].body.messages[0].content.includes('【输出语言】'));

console.log('— splitByParagraphs / map-reduce（超长输入） —');
check('MAP 参数对齐参考项目', svc.MAP_CHUNK_CHARS === 8000 && svc.MAP_THRESHOLD === 12000 && svc.MAP_MAX_CHUNKS === 120);
const paraText = Array.from({ length: 200 }, (_, i) => '段落' + i + '：' + '内容'.repeat(40)).join('\n');
const chunks = svc.splitByParagraphs(paraText, 8000);
check('按段落边界分块（≥2 块且每块 ≤8000）', chunks.length >= 2 && chunks.every((c) => c.length <= 8000));
check('分块无损重组', chunks.join('\n') === paraText);
const hard = svc.splitByParagraphs('x'.repeat(25000), 8000);
check('单行超长硬切兜底', JSON.stringify(hard.map((c) => c.length)) === JSON.stringify([8000, 8000, 8000, 1000]));

calls = []; maxActive = 0;
const prog = [];
const longText = paraText + '\n' + paraText; // >12000 字符
const longOut = await svc.summarizeContent({
  content: longText, lang: 'zh', userPrompt: '关注风险',
  onProgress: (stage, done, total) => prog.push([stage, done, total]),
});
const nChunks = svc.splitByParagraphs(longText, 8000).length;
check('map-reduce：N 块 map + 1 次最终总结', calls.length === nChunks + 1 && longOut === '# 总结OK');
check('map 阶段用 MAP_SYSTEM + maxTokens 800 + 片段编号', calls.slice(0, nChunks).every((c, i) =>
  c.body.messages[0].content === svc.MAP_SYSTEM && c.body.max_tokens === 800
  && c.body.messages[1].content.startsWith('【片段 ' + (i + 1) + '/' + nChunks + '】')));
check('map 并发上限 2', maxActive <= 2 && maxActive === 2);
const finalCall = calls.at(-1);
check('最终 system 含 G-SPEC+用户要求+语言指令', finalCall.body.messages[0].content.includes('【输出契约】')
  && finalCall.body.messages[0].content.includes('【用户额外要求】关注风险') && finalCall.body.messages[0].content.includes('【输出语言】'));
check('最终 user 为要点合集（保序拼接）', finalCall.body.messages[1].content.startsWith('===== 全文内容 =====\n以下是对全文各片段依次提取的要点合集')
  && finalCall.body.messages[1].content.includes('【片段 1 要点】') && finalCall.body.messages[1].content.includes('【片段 ' + nChunks + ' 要点】'));
check('onProgress：起始 0/N → 逐块 1..N → 生成总结 0/0', prog[0][1] === 0 && prog[0][2] === nChunks
  && JSON.stringify(prog.slice(1, -1).map((p) => p[1]).sort((a, b) => a - b)) === JSON.stringify(Array.from({ length: nChunks }, (_, i) => i + 1))
  && JSON.stringify(prog.at(-1)) === JSON.stringify(['生成总结', 0, 0]));

// 上限截断：121 块 → 仅分析前 120 块并注明
calls = [];
const hugeText = Array.from({ length: 121 }, () => 'y'.repeat(8000)).join('\n');
await svc.summarizeContent({ content: hugeText, lang: 'auto' });
check('超 120 块截断：120 次 map + 1 次最终', calls.length === 121);
check('截断注记进入最终材料', calls.at(-1).body.messages[1].content.includes('超出单次分析上限') && calls.at(-1).body.messages[1].content.includes('前 120 个片段'));

// 取消：已 abort 的 signal → AbortError
const ctrl = new AbortController();
ctrl.abort();
let abortName = '';
try { await svc.summarizeContent({ content: longText, lang: 'auto', signal: ctrl.signal }); }
catch (e) { abortName = e && e.name; }
check('已取消 signal → AbortError', abortName === 'AbortError');

// 取消快路径（v0.53.0）：预中止不发请求；运行中中止立即拒绝（不等桥接探测 1.5s）
calls = [];
let preAbortName = '';
try { await svc.summarizeContent({ content: '短文', lang: 'auto', signal: ctrl.signal }); }
catch (e) { preAbortName = e && e.name; }
check('预中止短文本 → AbortError 且零请求', preAbortName === 'AbortError' && calls.length === 0);
const ctrl2 = new AbortController();
const savedFetch = globalThis.fetch;
globalThis.fetch = async (reqUrl, options) => {
  await new Promise((r) => setTimeout(r, 30));
  if (options.signal && options.signal.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
  return savedFetch(reqUrl, options);
};
const t0 = Date.now();
setTimeout(() => ctrl2.abort(), 10);
let midName = '';
try { await svc.summarizeContent({ content: longText, lang: 'auto', signal: ctrl2.signal }); }
catch (e) { midName = e && e.name; }
const midMs = Date.now() - t0;
globalThis.fetch = savedFetch;
check('运行中 abort → AbortError', midName === 'AbortError');
check('运行中 abort 立即拒绝（<800ms，不走桥接探测）', midMs < 800);

console.log('— 双副本一致 —');
const svcExt = loadService('chrome_extension/ai-service.js');
check('扩展副本模板清单一致', JSON.stringify(svcExt.SUMMARY_TEMPLATES) === JSON.stringify(svc.SUMMARY_TEMPLATES));
check('扩展副本 prompt 一致', svcExt.summaryTemplatePrompt('D3', '日本語') === svc.summaryTemplatePrompt('D3', '日本語'));
check('扩展副本 OUTPUT_LANGS 一致', JSON.stringify(svcExt.OUTPUT_LANGS) === JSON.stringify(svc.OUTPUT_LANGS));
check('扩展副本 freeSummaryPrompt/outputLangNote 一致', svcExt.freeSummaryPrompt('English（英语）', 'x') === svc.freeSummaryPrompt('English（英语）', 'x')
  && svcExt.outputLangNote('日本語') === svc.outputLangNote('日本語'));
check('扩展副本 MAP 参数与编排入口一致', svcExt.MAP_CHUNK_CHARS === svc.MAP_CHUNK_CHARS && svcExt.MAP_THRESHOLD === svc.MAP_THRESHOLD
  && svcExt.MAP_MAX_CHUNKS === svc.MAP_MAX_CHUNKS && svcExt.MAP_SYSTEM === svc.MAP_SYSTEM && typeof svcExt.summarizeContent === 'function');
const rootSrc = fs.readFileSync(path.join(here, '..', 'ai-service.js'), 'utf8');
const extSrc = fs.readFileSync(path.join(here, '..', 'chrome_extension/ai-service.js'), 'utf8');
const ABORT_CHAT = "if (opts.signal && opts.signal.aborted) throw new DOMException('已取消', 'AbortError');";
const ABORT_PF = "if (options.signal && options.signal.aborted) throw new DOMException('已取消', 'AbortError');";
check('双副本 chat 取消快路径各 2 处', rootSrc.split(ABORT_CHAT).length - 1 === 2 && extSrc.split(ABORT_CHAT).length - 1 === 2);
check('双副本 proxyFetch 取消快路径', rootSrc.includes(ABORT_PF) && extSrc.includes(ABORT_PF));

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
