/**
 * summary-template.test.mjs — 总结模板（ai-template-kit，v0.49.0）单元测试
 *
 * 覆盖:
 *   1. SUMMARY_TEMPLATES 清单与 getSummaryTemplate 往返
 *   2. summaryTemplatePrompt：8 套模板结构关键词 + 通用铁律 + zh/en 输出语言规则注入
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
check('共 8 套模板', svc.SUMMARY_TEMPLATES.length === 8);
check('每套模板 label/hint 齐全', svc.SUMMARY_TEMPLATES.every((t) => t.id && t.label && t.hint));
check('getSummaryTemplate 往返', svc.getSummaryTemplate('exec')?.id === 'exec' && svc.getSummaryTemplate('nope') === null);

console.log('— prompt 构建（zh） —');
const KEYWORDS = {
  exec: ['一页纸高管摘要', '行动表', '结论式标题'],
  weekly: ['五段式日/周报', 'TL;DR', '风险与所需支持'],
  kpt: ['复盘 KPT', 'Keep', 'Try'],
  star: ['STAR 成果总结', '情境', '可复用性'],
  minutes: ['会议纪要（7 段式）', '一句话结论', '待办清单'],
  chart: ['图表数据总结', '核心指标卡', '三条洞察'],
  fishbone: ['鱼骨图根因分析', '6M', '验证计划表'],
  mindmap: ['思维导图大纲', 'MECE', '本周动作'],
};
for (const t of svc.SUMMARY_TEMPLATES) {
  const p = svc.summaryTemplatePrompt(t.id, '中文');
  check(t.id + ' 含铁律+结构关键词', p.includes('通用铁律') && KEYWORDS[t.id].every((k) => p.includes(k)));
  check(t.id + ' zh 输出语言规则', p.includes('全文使用中文输出'));
}
check('未知模板返回空串（回退默认 prompt）', svc.summaryTemplatePrompt('nope', '中文') === '');

console.log('— prompt 构建（非中文输出） —');
const enExec = svc.summaryTemplatePrompt('exec', 'English');
check('en 输出语言覆盖段', enExec.includes('输出语言（最高优先级）') && enExec.includes('English'));
check('OUTPUT_LANGS zh 名称识别为中文', svc.summaryTemplatePrompt('exec', svc.getOutputLang('zh').name).includes('全文使用'));
check('OUTPUT_LANGS en 名称走英文规则', svc.summaryTemplatePrompt('exec', svc.getOutputLang('en').name).includes('最高优先级'));

console.log('— analyzeContent 接入 —');
svc.saveConfig({ baseUrl: 'https://api.example.com/v1', apiKey: 'sk-test', model: 'test-model' });
let captured = null;
globalThis.fetch = async (reqUrl, options) => {
  captured = JSON.parse(options.body);
  return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: 'OK' } }] }) };
};
await svc.analyzeContent({ instructions: '', content: '材料', email: true, lang: 'zh', template: 'exec' });
check('显式 template 优先于邮件 playbook', captured?.messages?.[0]?.content?.includes('一页纸高管摘要'));
await svc.analyzeContent({ instructions: '', content: '材料', email: true, lang: 'zh', template: '' });
check('无 template 回落邮件 playbook（原行为）', captured?.messages?.[0]?.content?.includes('邮件线程详细总结'));

console.log('— 双副本一致 —');
const svcExt = loadService('chrome_extension/ai-service.js');
check('扩展副本模板清单一致', JSON.stringify(svcExt.SUMMARY_TEMPLATES) === JSON.stringify(svc.SUMMARY_TEMPLATES));
check('扩展副本 prompt 一致', svcExt.summaryTemplatePrompt('weekly', '日本語') === svc.summaryTemplatePrompt('weekly', '日本語'));

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
