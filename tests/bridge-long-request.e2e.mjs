/**
 * 实测依据：MV3 service worker 能在「长时间在途 fetch」下存活并完整回传 sendResponse。
 *
 * ai-service.js 的桥超时之所以能从 120s 放宽到 600s，前提就是 background SW 不会在
 * 长请求途中被 Chrome 终止。本脚本用真实 Chromium + 真实扩展验证该前提。
 *
 * 实测结论（Chrome for Testing 151 / playwright-core 1.62.1）：
 *   DELAY_MS = 45000 / 300000 / 420000 三档均 PASS，端点观测 aborted:false，
 *   即 SW 在 7 分钟的在途 fetch 下依然存活 —— 说明「SW 30s 空闲被杀」并非
 *   「桥接请求超时」的成因，真正的瓶颈是页面侧 120s 超时短于真实生成耗时。
 *
 * 被测链路：chrome.runtime.sendMessage({action:'linguaflow:proxyFetch'})
 *           → background.js 真实处理器 → SW 内 fetch 一个延迟响应的模拟端点。
 * 模拟端点故意不回 CORS 头，对齐阿里云 Token Plan（README.md:303）——
 * 这正是网页版必须走代理桥的原因。
 *
 * 运行（需本机存在 playwright chromium，会打开可见浏览器窗口）：
 *   node tests/bridge-long-request.e2e.mjs
 *   DELAY_MS=300000 DEADLINE_MS=330000 node tests/bridge-long-request.e2e.mjs
 */
import http from 'node:http';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXT_SRC = join(ROOT, 'chrome_extension');
const CHROME_EXE = process.env.CHROME_EXE
  || join(homedir(), 'AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe');

const DELAY_MS = Number(process.env.DELAY_MS || 45000);
const DEADLINE_MS = Number(process.env.DEADLINE_MS || DELAY_MS + 55000);
const API_PORT = 8812;
const API_URL = `http://127.0.0.1:${API_PORT}/v1/chat/completions`;

const tmpRoot = mkdtempSync(join(tmpdir(), 'bridge-long'));
const extDir = join(tmpRoot, 'ext');
cpSync(EXT_SRC, extDir, { recursive: true });
// 极简扩展页：提供一个稳定的 chrome-extension:// 上下文来驱动 background 处理器
writeFileSync(join(extDir, 'bridge_test.html'),
  '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>bridge test</body></html>');

console.log(`端点延迟=${DELAY_MS}ms  判定期限=${DEADLINE_MS}ms`);

/* ---------- 模拟大模型端点：不回 CORS 头 ---------- */
const apiHits = [];
const apiServer = http.createServer((req, res) => {
  const startedAt = Date.now();
  if (req.method === 'OPTIONS') {          // 预检立即失败，不浪费等待时间
    apiHits.push({ method: 'OPTIONS', elapsed: 0 });
    res.writeHead(204); res.end();
    return;
  }
  req.resume();
  req.on('end', () => {
    const timer = setTimeout(() => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: '慢速总结成功' } }] }));
      apiHits.push({ method: req.method, elapsed: Date.now() - startedAt, aborted: false });
    }, DELAY_MS);
    // 必须监听 res 的 close（连接真正关闭）；req 的 close 在请求体读完时就会触发，
    // 用它会把上面的定时器立刻清掉，导致端点永不响应。
    // SW 若在响应前被终止，其 fetch 连接会断开，据此可观测到。
    res.on('close', () => {
      if (!res.writableEnded) {
        clearTimeout(timer);
        apiHits.push({ method: req.method, elapsed: Date.now() - startedAt, aborted: true });
      }
    });
  });
});
await new Promise((r) => apiServer.listen(API_PORT, '127.0.0.1', r));

let outcome = 'DRIVER_ERROR';
let detail = '';
let context;
try {
  context = await chromium.launchPersistentContext(join(tmpRoot, 'profile'), {
    headless: false,                        // 加载扩展须有头模式
    executablePath: CHROME_EXE,
    args: [
      `--disable-extensions-except=${extDir}`,
      `--load-extension=${extDir}`,
      '--no-first-run',
      '--no-default-browser-check',
    ],
  });

  const sw = context.serviceWorkers()[0]
    || await context.waitForEvent('serviceworker', { timeout: 15000 });
  const extId = new URL(sw.url()).host;
  console.log('扩展 SW:', sw.url());

  const page = await context.newPage();
  page.setDefaultTimeout(DEADLINE_MS + 60000);
  await page.goto(`chrome-extension://${extId}/bridge_test.html`, { waitUntil: 'load' });

  const result = await page.evaluate(async ({ url, deadline }) => {
    const started = Date.now();
    const work = new Promise((resolve) => {
      chrome.runtime.sendMessage({
        action: 'linguaflow:proxyFetch', url, method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-key' },
        body: JSON.stringify({ model: 'qwen-test', messages: [{ role: 'user', content: 'x'.repeat(60000) }] }),
      }, (res) => {
        const le = chrome.runtime.lastError;
        resolve({ res: res || null, lastError: le ? String(le.message) : null });
      });
    });
    const cutoff = new Promise((r) => setTimeout(() => r({ deadlineHit: true }), deadline));
    const out = await Promise.race([work, cutoff]);
    return Object.assign({}, out, { ms: Date.now() - started });
  }, { url: API_URL, deadline: DEADLINE_MS });

  console.log(`\n结果（页面内计时 ${result.ms}ms）:`, JSON.stringify(result));
  console.log('端点观测:', JSON.stringify(apiHits));

  const text = result.res && result.res.text ? String(result.res.text) : '';
  const aborted = apiHits.find((h) => h.aborted);
  if (result.res && result.res.ok === true && /慢速总结成功/.test(text) && !aborted) {
    outcome = 'PASS';
    detail = `SW 在 ${DELAY_MS}ms 的在途 fetch 下存活并完整回传（连接未中断）`;
  } else if (aborted) {
    outcome = 'FAIL';
    detail = `SW 内 fetch 于 ${aborted.elapsed}ms 被终止（连接在响应完成前断开）`;
  } else {
    outcome = 'FAIL';
    detail = `未拿到完整应答: ${result.deadlineHit ? `超过 ${DEADLINE_MS}ms 期限` : result.lastError || JSON.stringify(result.res)}`;
  }
} catch (e) {
  outcome = 'DRIVER_ERROR';
  detail = `驱动异常: ${e.message.split('\n')[0]}`;
  console.log('端点观测:', JSON.stringify(apiHits));
} finally {
  if (context) await context.close().catch(() => {});
  apiServer.close();
  rmSync(tmpRoot, { recursive: true, force: true });
}

console.log(`\n=== ${outcome} ===\n${detail}`);
process.exit(outcome === 'PASS' ? 0 : 1);
