/**
 * v0.25.5 守卫测试：normalizeBaseUrl（URL 归一化）与 proxyFetchStream（流式通道）。
 *
 * 背景：
 * - normalizeBaseUrl 从 buildUrl 拆出，供 /models 等端点共用；行为必须与旧 buildUrl 完全一致。
 * - 流式通道（SSE）解决「6 万字符 + 慢网关非流式生成被当作空闲连接掐断/撞上总超时」；
 *   这里用沙箱模拟直连 SSE 端点、网关忽略 stream 的 JSON 回退、桥接流式分片与取消。
 *
 * 运行：node tests/stream-and-url.test.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const SVC = process.env.SVC_PATH || join(dirname(fileURLToPath(import.meta.url)), '..', 'ai-service.js');

/* ---------- 沙箱 ---------- */
const listeners = {};
const sent = [];
function dispatch(data) { for (const fn of listeners.message || []) fn({ data }); }

function makeSandbox(fetchImpl) {
  const sandbox = {
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    postMessage(msg) {
      sent.push(msg);
      // 模拟 content.js：bridge-ping 立即应答；bridge-fetch-stream 先回 ack（由测试手动继续）
      if (msg && msg.type === 'bridge-ping') {
        dispatch({ source: 'linguaflow-extension', bridgeId: msg.bridgeId });
      } else if (msg && msg.type === 'bridge-fetch-stream') {
        dispatch({ source: 'linguaflow-extension', bridgeId: msg.bridgeId, stream: true, event: 'ack' });
      }
    },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    fetch: fetchImpl,
    setTimeout, clearTimeout, setInterval, clearInterval,
    TextDecoder, AbortController,
    Promise, Date, JSON, Object, Array, String, Number, Math, RegExp, Error, console,
  };
  sandbox.window = sandbox;
  sandbox.top = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(SVC, 'utf8'), sandbox, { filename: 'ai-service.js' });
  return sandbox;
}

const failures = [];
const test = async (label, fn) => {
  try { await fn(); console.log(`  ok   ${label}`); }
  catch (e) { failures.push(`${label}\n       ${e.message}`); console.log(`  FAIL ${label}`); }
};

/* ---------- 1. normalizeBaseUrl / buildUrl ---------- */
await test('normalizeBaseUrl + buildUrl：智谱多级路径', () => {
  const sb = makeSandbox(async () => { throw new TypeError('no fetch'); });
  assert.equal(sb.AiService.normalizeBaseUrl('https://open.bigmodel.cn/api/paas/v4'), 'https://open.bigmodel.cn/api/paas/v4');
  assert.equal(sb.AiService.buildUrl('https://open.bigmodel.cn/api/paas/v4'), 'https://open.bigmodel.cn/api/paas/v4/chat/completions');
});

await test('normalizeBaseUrl：全角「：／」+ 空白 + 尾斜杠 + 误填重复端点', () => {
  const sb = makeSandbox(async () => { throw new TypeError('no fetch'); });
  assert.equal(sb.AiService.buildUrl('https://api.deepseek.com：443／v1／'), 'https://api.deepseek.com:443/v1/chat/completions');
  assert.equal(sb.AiService.buildUrl(' https://a.b/c/chat/completions '), 'https://a.b/c/chat/completions');
  assert.equal(sb.AiService.normalizeBaseUrl('https://a.b/c/'), 'https://a.b/c');
});

await test('buildUrl 幂等：对已拼好的端点重复调用不变形', () => {
  const sb = makeSandbox(async () => { throw new TypeError('no fetch'); });
  const once = sb.AiService.buildUrl('https://x.cn/api/paas/v4');
  assert.equal(sb.AiService.buildUrl(once), once);
});

/* ---------- 2. 直连 SSE 流式 ---------- */
function sseFetch(chunks, contentType = 'text/event-stream') {
  let i = 0;
  return async () => ({
    ok: true, status: 200,
    headers: { get: () => contentType },
    body: {
      getReader: () => ({
        read: async () => (i < chunks.length
          ? { done: false, value: Buffer.from(chunks[i++], 'utf8') }
          : { done: true }),
      }),
    },
  });
}
const sseLine = (delta) => 'data: ' + JSON.stringify({ choices: [{ delta: { content: delta } }] }) + '\n\n';
const sseReason = (r) => 'data: ' + JSON.stringify({ choices: [{ delta: { reasoning_content: r } }] }) + '\n\n';

await test('直连 SSE：分块截断/CRLF/[DONE]/reasoning_content 不进正文', async () => {
  const chunks = [
    'data: ' + JSON.stringify({ choices: [{ delta: { content: '你' } }] }) + '\r',   // 行被截断
    '\n' + sseReason('思考中') + sseLine('好') + 'data: [DONE]\n\n',
  ];
  const deltas = [];
  const sb = makeSandbox(sseFetch(chunks));
  const res = await sb.AiService.proxyFetchStream('https://api.deepseek.com/v1/chat/completions', { method: 'POST' }, (d) => deltas.push(d));
  assert.equal(res.ok, true);
  assert.equal(await res.text(), '你好');
  // reasoning_content 不进正文：只有两个 content delta（每个 SSE 事件回调一次）
  assert.deepEqual(deltas, ['你', '好']);
});

await test('网关忽略 stream:true → 整包 JSON 提取正文并整体回调一次', async () => {
  const full = JSON.stringify({ choices: [{ message: { content: '整包结果' } }] });
  let i = 0;
  const fetchImpl = async () => ({
    ok: true, status: 200,
    headers: { get: () => 'application/json' },
    text: async () => (i++ === 0 ? full : ''),
  });
  const deltas = [];
  const sb = makeSandbox(fetchImpl);
  const res = await sb.AiService.proxyFetchStream('https://gw.example/v1/chat/completions', { method: 'POST' }, (d) => deltas.push(d));
  assert.deepEqual(deltas, ['整包结果']);
  assert.equal(await res.text(), '整包结果');
});

await test('直连 HTTP 400 原样返回（!ok），调用方可据此做去 temperature 重试', async () => {
  const fetchImpl = async () => ({
    ok: false, status: 400,
    headers: { get: () => 'application/json' },
    text: async () => JSON.stringify({ error: { message: 'temperature not supported' } }),
  });
  const sb = makeSandbox(fetchImpl);
  const res = await sb.AiService.proxyFetchStream('https://api.example/v1/chat/completions', { method: 'POST' }, () => {});
  assert.equal(res.ok, false);
  assert.equal(res.status, 400);
  assert.match(await res.text(), /temperature not supported/);
});

/* ---------- 3. 桥接流式 ---------- */
await test('网页直连失败 → 桥接流式：ack/chunk/end 分片拼装正文', async () => {
  const sb = makeSandbox(async () => { throw new TypeError('Failed to fetch'); });   // 模拟无 CORS
  const deltas = [];
  const p = sb.AiService.proxyFetchStream('https://gw.example/v1/chat/completions', { method: 'POST' }, (d) => deltas.push(d));
  await new Promise((r) => setTimeout(r, 10));
  const streamReqs = sent.filter((m) => m.type === 'bridge-fetch-stream');
  assert.equal(streamReqs.length, 1, '应发出一条桥接流式请求');
  const id = streamReqs[0].bridgeId;
  dispatch({ source: 'linguaflow-extension', bridgeId: id, stream: true, event: 'chunk', text: sseLine('桥接') });
  dispatch({ source: 'linguaflow-extension', bridgeId: id, stream: true, event: 'chunk', text: sseLine('分片') });
  dispatch({ source: 'linguaflow-extension', bridgeId: id, stream: true, event: 'end', status: 200 });
  const res = await p;
  assert.equal(await res.text(), '桥接分片');
  assert.deepEqual(deltas, ['桥接', '分片']);
});

await test('桥接 http-error 事件 → 返回 !ok 响应（保留 status 供重试判断）', async () => {
  const sb = makeSandbox(async () => { throw new TypeError('Failed to fetch'); });
  const p = sb.AiService.proxyFetchStream('https://gw.example/v1/chat/completions', { method: 'POST' }, () => {});
  await new Promise((r) => setTimeout(r, 10));
  const id = sent.filter((m) => m.type === 'bridge-fetch-stream').pop().bridgeId;
  dispatch({ source: 'linguaflow-extension', bridgeId: id, stream: true, event: 'http-error', status: 401, text: '{"error":{"message":"bad key"}}' });
  const res = await p;
  assert.equal(res.ok, false);
  assert.equal(res.status, 401);
  assert.match(await res.text(), /bad key/);
});

await test('取消：signal 中止 → 发出 bridge-abort 并以「已取消」拒绝', async () => {
  const sb = makeSandbox(async () => { throw new TypeError('Failed to fetch'); });
  const ctrl = new AbortController();
  const p = sb.AiService.proxyFetchStream('https://gw.example/v1/chat/completions', { method: 'POST', signal: ctrl.signal }, () => {});
  await new Promise((r) => setTimeout(r, 10));
  ctrl.abort();
  await assert.rejects(p, /已取消/);
  assert.ok(sent.some((m) => m.type === 'bridge-abort'), '应发出 bridge-abort');
});

await test('旧版 content.js 无 ack → 5 秒后报通道无响应（可降级非流式）', async () => {
  // 不应答 ack 的沙箱
  const sb = makeSandbox(async () => { throw new TypeError('Failed to fetch'); });
  listeners.message = [];   // 去掉自动应答
  sb.addEventListener('message', () => {});   // 吞掉所有事件
  const p = sb.AiService.proxyFetchStream('https://gw.example/v1/chat/completions', { method: 'POST' }, () => {});
  // advance 不可用（真实定时器），直接等待 ack 超时窗口
  await assert.rejects(Promise.race([
    p,
    new Promise((resolve, reject) => setTimeout(() => reject(new Error('等待 ack 超时窗口过久')), 8000)),
  ]));
}, );

console.log('');
if (failures.length) {
  console.log(`${failures.length} 项失败：`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log('全部通过');
