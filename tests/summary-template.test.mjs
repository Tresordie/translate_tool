/**
 * summary-template.test.mjs — 总结模板（scenario-templates，v0.51.0）单元测试
 *
 * 覆盖:
 *   1. SUMMARY_TEMPLATES 清单（25 套 × 5 场景）与 getSummaryTemplate 往返
 *   2. summaryTemplatePrompt：25 套专属正文关键词 + 共享【输出契约】G-SPEC + 占位符说明 + zh/en 输出语言规则注入
 *   3. analyzeContent 显式 template 优先于邮件线程 playbook；无 template 回落原行为
 *   4. 根目录与 chrome_extension 双副本模板定义一致
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
  check(t.id + ' 含专属正文+契约+占位符说明', p.includes(ROLE[t.id]) && p.includes('【输出契约】') && p.includes('材料与占位符'));
  check(t.id + ' 契约仅拼接一次', p.split('【输出契约】').length - 1 === 1);
  check(t.id + ' zh 输出语言规则', p.includes('全文使用中文输出'));
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

console.log('— prompt 构建（非中文输出） —');
const enM1 = svc.summaryTemplatePrompt('M1', 'English');
check('en 输出语言覆盖段', enM1.includes('输出语言（最高优先级）') && enM1.includes('English'));
check('OUTPUT_LANGS zh 名称识别为中文', svc.summaryTemplatePrompt('M1', svc.getOutputLang('zh').name).includes('全文使用'));
check('OUTPUT_LANGS en 名称走英文规则', svc.summaryTemplatePrompt('M1', svc.getOutputLang('en').name).includes('最高优先级'));

console.log('— analyzeContent 接入 —');
svc.saveConfig({ baseUrl: 'https://api.example.com/v1', apiKey: 'sk-test', model: 'test-model' });
let captured = null;
globalThis.fetch = async (reqUrl, options) => {
  captured = JSON.parse(options.body);
  return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: 'OK' } }] }) };
};
await svc.analyzeContent({ instructions: '', content: '材料', email: true, lang: 'zh', template: 'M1' });
check('显式 template 优先于邮件 playbook', captured?.messages?.[0]?.content?.includes('会议纪要专家'));
await svc.analyzeContent({ instructions: '', content: '材料', email: true, lang: 'zh', template: '' });
check('无 template 回落邮件 playbook（原行为）', captured?.messages?.[0]?.content?.includes('邮件线程详细总结'));

console.log('— 双副本一致 —');
const svcExt = loadService('chrome_extension/ai-service.js');
check('扩展副本模板清单一致', JSON.stringify(svcExt.SUMMARY_TEMPLATES) === JSON.stringify(svc.SUMMARY_TEMPLATES));
check('扩展副本 prompt 一致', svcExt.summaryTemplatePrompt('D3', '日本語') === svc.summaryTemplatePrompt('D3', '日本語'));

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
