/**
 * 守卫「桥接请求超时」的真实修复：页面侧桥超时必须容纳大模型长文档的真实生成耗时。
 *
 * 背景：阿里云 Token Plan 等端点无 CORS 头（README.md:303），网页版只能经扩展代理桥
 * 请求；桥超时原为 120s。PDF 邮件线程最多发送 6 万字符（email_summary.js:376），
 * 经慢网关非流式生成常需数分钟，于是 120s 会在正常返回前就误判超时。DeepSeek 等开放
 * 跨域的端点直连成功、根本不走桥，故不受影响。
 *
 * 用虚拟时钟在毫秒级验证数百秒的行为；沙箱内加载仓库真实的 ai-service.js。
 * 运行：node tests/bridge-timeout.test.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const SVC = process.env.SVC_PATH || join(dirname(fileURLToPath(import.meta.url)), '..', 'ai-service.js');
const URL_ = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
const OPTS = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"model":"qwen-test"}' };

/* ---------- 虚拟时钟 ---------- */
let vnow = 0;
const timers = new Map();
let timerSeq = 0;
function setTimeoutStub(fn, ms) { const id = ++timerSeq; timers.set(id, { at: vnow + (ms || 0), fn }); return id; }
function clearTimeoutStub(id) { timers.delete(id); }
function advance(ms) {
  const target = vnow + ms;
  for (;;) {
    let nextId = null;
    let nextAt = Infinity;
    for (const [id, t] of timers) {
      if (t.at <= target && t.at < nextAt) { nextAt = t.at; nextId = id; }
    }
    if (nextId === null) break;
    const t = timers.get(nextId);
    timers.delete(nextId);
    vnow = t.at;
    t.fn();
  }
  vnow = target;
}
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };

/* ---------- 假 window：同时充当 content.js 的角色 ---------- */
const listeners = {};
const sent = [];
function dispatch(data) { for (const fn of listeners.message || []) fn({ data }); }

const sandbox = {
  addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
  // 页面把桥消息发往 window.top；这里模拟 content.js：ping 立即应答，
  // bridge-fetch 只记录不自动回包，由测试在指定时刻手动投递。
  postMessage(msg) {
    sent.push(msg);
    if (msg && msg.type === 'bridge-ping') {
      dispatch({ source: 'linguaflow-extension', bridgeId: msg.bridgeId });
    }
  },
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  // 模拟无 CORS 头端点：页面直连必然被浏览器拦截，从而回落到代理桥
  fetch: async () => { throw new TypeError('Failed to fetch'); },
  setTimeout: setTimeoutStub,
  clearTimeout: clearTimeoutStub,
  // 桥接保活（v0.25.5）走虚拟时钟：ka 心跳在 advance 时触发，仅记录无害消息
  setInterval: (fn, ms) => setTimeoutStub(fn, ms),
  clearInterval: (id) => clearTimeoutStub(id),
  Promise, Date, JSON, Object, Array, String, Number, Math, RegExp, Error, console,
};
sandbox.window = sandbox;
sandbox.top = sandbox;
vm.createContext(sandbox);
vm.runInContext(readFileSync(SVC, 'utf8'), sandbox, { filename: 'ai-service.js' });

const AiService = sandbox.AiService;
assert.ok(AiService && typeof AiService.proxyFetch === 'function', 'AiService.proxyFetch 应可用');

const failures = [];
const test = async (label, fn) => {
  try { await fn(); console.log(`  ok   ${label}`); }
  catch (e) { failures.push(`${label}\n       ${e.message}`); console.log(`  FAIL ${label}`); }
};

const lastBridgeReq = () => sent.filter((m) => m.type === 'bridge-fetch').pop();

await test('300s 才返回的应答仍被接受（旧 120s 会在此误报超时）', async () => {
  const p = AiService.proxyFetch(URL_, OPTS);
  await flush();                                  // 等 ping 完成并进入 bridgeFetch
  const req = lastBridgeReq();
  assert.ok(req, '直连失败后应已发出桥请求');

  advance(300000);                                // 虚拟时钟前进 300 秒
  let settled = false;
  p.then(() => { settled = true; }, () => { settled = true; });
  await flush();
  assert.equal(settled, false, '300s 时不应已判定超时');

  dispatch({
    source: 'linguaflow-extension', bridgeId: req.bridgeId,
    ok: true, status: 200,
    text: JSON.stringify({ choices: [{ message: { content: '慢速总结成功' } }] }),
  });
  const res = await p;
  assert.equal(res.ok, true);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /慢速总结成功/);
});

await test('完全无应答时，恰在 600s 报「桥接请求超时」而非 120s', async () => {
  const p = AiService.proxyFetch(URL_, OPTS);
  await flush();
  assert.ok(lastBridgeReq(), '应已发出桥请求');

  let rejection = null;
  p.catch((e) => { rejection = e; });

  advance(599999);
  await flush();
  assert.equal(rejection, null, '599.999s 时不应超时');

  advance(1);
  await flush();
  assert.ok(rejection, '600s 时应超时');
  assert.match(rejection.message, /桥接请求超时/);
});

console.log('');
if (failures.length) {
  console.log(`${failures.length} 项失败：`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log('全部通过');
