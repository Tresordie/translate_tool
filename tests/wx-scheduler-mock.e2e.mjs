// ================================================================
// wechat_scheduler 服务 mock 模式端到端测试（无需微信环境）
// 运行：node tests/wx-scheduler-mock.e2e.mjs
// Python 定位：环境变量 WX_SCHED_PY > python/py/py -3；都找不到则 SKIP 退出码 0。
// 覆盖：状态/联系人/任务 CRUD/参数校验/到点定时发送/手动立即发送/开机补发（重启服务）/静态托管
// ================================================================
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER = path.join(ROOT, 'wechat_scheduler', 'server.py');
const PORT = 18799;
const BASE = `http://127.0.0.1:${PORT}`;
const dataDir = mkdtempSync(path.join(os.tmpdir(), 'wxsched-'));

function findPython() {
  const env = process.env.WX_SCHED_PY;
  if (env && existsSync(env)) return [env, []];
  for (const [cmd, args] of [['python', []], ['py', ['-3']]]) {
    const r = spawnSync(cmd, [...args, '--version'], { encoding: 'utf8' });
    if (!r.error && /Python 3/.test(r.stdout || '')) return [cmd, args];
  }
  return null;
}

const py = findPython();
if (!py) {
  console.log('SKIPPED: 未找到 Python 3（设置 WX_SCHED_PY 指向 python.exe 后重试）');
  process.exit(0);
}

let server = null;
const started = [];
function startServer() {
  server = spawn(py[0], [...py[1], SERVER, '--mock', '--port', String(PORT), '--data-dir', dataDir, '--static-dir', ROOT], {
    cwd: path.dirname(SERVER), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  server.stdout.on('data', (d) => process.env.VERBOSE && process.stdout.write('[srv] ' + d));
  server.stderr.on('data', (d) => process.env.VERBOSE && process.stderr.write('[srv-err] ' + d));
  started.push(server);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function api(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.clone().json(); } catch { data = await res.text(); }
  return { status: res.status, data };
}
async function waitUp(timeoutMs = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try { const r = await api('GET', '/api/status'); if (r.data && r.data.ok) return r.data; } catch {}
    await sleep(200);
  }
  throw new Error('服务未在预期时间内就绪');
}
let passed = 0;
function assert(cond, msg) {
  if (!cond) { console.error('FAIL: ' + msg); cleanup(1); } else { passed++; console.log('PASS: ' + msg); }
}
function cleanup(code) {
  for (const p of started) { try { p.kill(); } catch {} }
  process.exit(code);
}

startServer();
const st = await waitUp();
assert(st.service === 'linguaflow-wx-scheduler' && st.wechat.mock === true, '/api/status 返回 mock 服务状态');

const contacts = await api('GET', '/api/contacts');
assert(contacts.data.ok && contacts.data.contacts.length === 3, '/api/contacts 返回 mock 联系人');

// 非法调度 → 400
const bad = await api('POST', '/api/tasks', { receiver: { wxid: 'filehelper' }, content: 'x', schedule: { type: 'weekly', time: '25:00', weekdays: [1] } });
assert(bad.status === 400 && bad.data.ok === false, '非法时间被拒绝（400 + 中文错误）');

// 正常创建每日任务
const daily = await api('POST', '/api/tasks', {
  name: '喝水提醒', receiver: { wxid: 'filehelper', name: '文件传输助手' },
  content: '该喝水了 💧', schedule: { type: 'daily', time: '18:30' },
});
assert(daily.data.ok && /^\d{2}:\d{2}$/.test(daily.data.task.schedule.time) && daily.data.task.next_fire, '创建每日任务并算出 next_fire');

// 一次性任务：4 秒后触发 → 轮询历史验证定时发送
const at = new Date(Date.now() + 4000);
const iso = at.toISOString().slice(0, 19); // 本地时间由服务器按本地时区解析——用本地格式字符串
const local = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}T${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}:${String(at.getSeconds()).padStart(2, '0')}`;
void iso;
const once = await api('POST', '/api/tasks', {
  receiver: { wxid: 'wxid_mock_friend_01', name: '测试好友' }, content: '一次性测试消息', schedule: { type: 'once', at: local },
});
assert(once.data.ok, '创建一次性任务（4 秒后）');

let hist = null;
for (let i = 0; i < 60; i++) {
  await sleep(500);
  hist = await api('GET', '/api/history');
  const hit = hist.data.entries.find((e) => e.task_id === once.data.task.id);
  if (hit) break;
}
const onceEntry = hist.data.entries.find((e) => e.task_id === once.data.task.id);
assert(onceEntry && onceEntry.ok === true && onceEntry.catchup === false && onceEntry.manual === false, '一次性任务到点自动发送并写入历史');
const tList = await api('GET', '/api/tasks');
const doneOnce = tList.data.tasks.find((t) => t.id === once.data.task.id);
assert(doneOnce.enabled === false && doneOnce.next_fire === null, '一次性任务发送后自动停用');

// 立即发送
const run = await api('POST', `/api/tasks/${daily.data.task.id}/run`);
assert(run.data.ok === true, '手动立即发送成功');
hist = await api('GET', '/api/history');
assert(hist.data.entries.some((e) => e.task_id === daily.data.task.id && e.manual === true), '历史记录标记手动发送');

// 停用任务
const off = await api('PUT', `/api/tasks/${daily.data.task.id}`, { enabled: false });
assert(off.data.ok && off.data.task.enabled === false, 'PUT 停用任务');

// ===== 开机补发：模拟「关机期间错过」→ 改存储文件 → 重启服务 =====
// 另建一条超窗任务（next_fire 远早于补发窗口）验证「放弃补发」留痕
server.kill();
await sleep(500);
const tasksFile = path.join(dataDir, 'tasks.json');
const saved = JSON.parse(readFileSync(tasksFile, 'utf8'));
const fmtLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
const target = saved.tasks.find((t) => t.id === daily.data.task.id);
target.enabled = true;
target.next_fire = fmtLocal(new Date(Date.now() - 5 * 60 * 1000)); // 滞后 5 分钟，在 240 分钟窗口内 → 补发
const stale = saved.tasks.find((t) => t.id === once.data.task.id);
stale.enabled = true;
stale.next_fire = fmtLocal(new Date(Date.now() - 6 * 3600 * 1000)); // 滞后 6 小时，超窗 → 放弃
writeFileSync(tasksFile, JSON.stringify(saved, null, 1));
startServer();
await waitUp();
let catchupEntry = null, skipEntry = null;
for (let i = 0; i < 40; i++) {
  await sleep(300);
  hist = await api('GET', '/api/history');
  catchupEntry = hist.data.entries.find((e) => e.task_id === daily.data.task.id && e.catchup === true && e.manual === false);
  skipEntry = hist.data.entries.find((e) => e.task_id === stale.id && e.skipped === true);
  if (catchupEntry && skipEntry) break;
}
assert(catchupEntry && catchupEntry.content.startsWith('【补发】'), '窗口内过期任务自动补发（带【补发】前缀）');
const after = (await api('GET', '/api/tasks')).data.tasks.find((t) => t.id === daily.data.task.id);
assert(after.next_fire > catchupEntry.time.slice(0, 10) && after.enabled === true, '补发后周期任务时间滚到下一次且仍启用');
assert(skipEntry && /放弃补发/.test(skipEntry.error || ''), '超补发窗口的任务放弃并留痕（不轰炸收件人）');
const afterStale = (await api('GET', '/api/tasks')).data.tasks.find((t) => t.id === stale.id);
assert(afterStale.enabled === false, '一次性任务放弃后自动停用');

// 演练（mock 通道无 dry_run 能力，应 400 明确提示）
const dry = await api('POST', `/api/tasks/${daily.data.task.id}/dryrun`);
assert(dry.status === 400 || dry.data.ok === false, '演练接口对不支持的通道明确拒绝');

// 删除
const del = await api('DELETE', `/api/tasks/${daily.data.task.id}`);
assert(del.data.ok, '删除任务');
assert((await api('GET', '/api/tasks')).data.tasks.every((t) => t.id !== daily.data.task.id), '任务列表中已无该任务');

// 历史单条删除 + 清空全部
hist = await api('GET', '/api/history');
const someEntry = hist.data.entries[0];
assert(someEntry && someEntry.id, '历史条目带 id（旧数据自动迁移）');
const delH = await api('DELETE', `/api/history/${someEntry.id}`);
assert(delH.data.ok, '删除单条历史');
const afterDel = await api('GET', '/api/history');
assert(!afterDel.data.entries.some((e) => e.id === someEntry.id) && afterDel.data.entries.length === hist.data.entries.length - 1, '单条删除后列表正确缩短');
const clearH = await api('DELETE', '/api/history');
assert(clearH.data.ok, '清空全部历史');
assert((await api('GET', '/api/history')).data.entries.length === 0, '清空后历史为空');

// 聊天记录读取：mock 环境通常无 wechatauto-replica → 必须返回清晰中文错误而非 500
const msgs = await api('GET', '/api/messages?target=filehelper&hours=24');
assert(msgs.status === 502 ? msgs.data.ok === false && /wechatauto|微信/.test(msgs.data.error) : msgs.data.ok === true,
  '/api/messages 无依赖时返回可行动错误（或真机可读时返回数据）');
const msgsBad = await api('GET', '/api/messages?target=x&start=bad');
assert(msgsBad.status === 400 && !msgsBad.data.ok, '非法时间参数被拒绝');
// 自定义起止时间（回归：end 参数曾因 parse_qs 列表未取 [0] 恒 400）
const now2 = new Date();
const fmtQ = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const msgsRange = await api('GET', `/api/messages?target=filehelper&start=${encodeURIComponent(fmtQ(new Date(now2 - 86400000)))}&end=${encodeURIComponent(fmtQ(now2))}`);
assert(msgsRange.status !== 400, '合法 start&end 不再误报时间格式错误（502=缺依赖可行动错误）');

// 总结记录 CRUD
const sum1 = await api('POST', '/api/summaries', { display: '测试会话', window: 'w', count: 5, result: '## 📌 内容重点\n- x' });
assert(sum1.data.ok && sum1.data.item.id, '保存总结记录');
const sumList = await api('GET', '/api/summaries');
assert(sumList.data.items.length === 1 && sumList.data.items[0].result.includes('内容重点'), '总结列表返回（新→旧）');
const sumDel = await api('DELETE', `/api/summaries/${sum1.data.item.id}`);
assert(sumDel.data.ok && (await api('GET', '/api/summaries')).data.items.length === 0, '删除单条总结');
const sumEmpty = await api('POST', '/api/summaries', { display: 'x', result: '  ' });
assert(sumEmpty.status === 400, '空总结结果被拒绝');

// 静态托管
const res = await fetch(`${BASE}/index.html`);
const html = await res.text();
assert(res.status === 200 && html.includes('AI Tool Box'), '静态托管 index.html 可访问');
const badPath = await fetch(`${BASE}/..%2f..%2fWindows/win.ini`);
assert(badPath.status >= 400, '路径穿越被拒绝');

// ===== 数据与云同步 =====
const driveDir = mkdtempSync(path.join(os.tmpdir(), 'wxdrive-'));
const setOk = await api('PUT', '/api/settings', { drive_path: driveDir.replace(/\\/g, '/') });
assert(setOk.data.ok && setOk.data.settings.drive_path, '设置 Drive 路径成功');
const setBad = await api('PUT', '/api/settings', { drive_path: 'Z:/definitely/not/here' });
assert(setBad.status === 400 && !setBad.data.ok, '无效 Drive 路径被拒绝');

// 浏览器数据推送：apiKey/token 服务端强制剥离
await api('POST', '/api/browser-data', { state: {
  translate_config: JSON.stringify({ baseUrl: 'https://api.demo', apiKey: 'sk-SUPER-SECRET', model: 'm1' }),
  ws_api_token: 'tok-secret', translate_history: '[{"q":"a"}]', linguaflow_theme: '"lf-graphite"',
} });
const bd = await api('GET', '/api/browser-data');
assert(bd.data.state.translate_config.includes('"apiKey": ""') || bd.data.state.translate_config.includes('"apiKey":""'), 'translate_config.apiKey 已剥离');
assert(bd.data.state.ws_api_token === undefined, 'ws_api_token 整键剔除');
assert(bd.data.state.translate_history === '[{"q":"a"}]', '普通数据原样保留');

// 立即备份 → 文件落盘且零密钥泄露
const bk = await api('POST', '/api/backup');
assert(bk.data.ok && !bk.data.error, '立即备份成功');
const latestPath = path.join(driveDir, 'LinguaFlow', 'latest.json');
assert(existsSync(latestPath), 'latest.json 已写入 Drive 目录');
const bundleText = readFileSync(latestPath, 'utf8');
assert(!bundleText.includes('sk-SUPER-SECRET') && !bundleText.includes('tok-secret'), '备份包零密钥泄露');
assert(JSON.parse(bundleText).wechat && JSON.parse(bundleText).browser_state, '备份包含 wechat + browser_state 段');

// 备份→删任务→恢复：数据回滚
const tForBk = await api('POST', '/api/tasks', { receiver: { wxid: 'filehelper', name: 'fh' }, content: '备份恢复验证', schedule: { type: 'daily', time: '07:00' } });
await api('POST', '/api/backup');
await api('DELETE', `/api/tasks/${tForBk.data.task.id}`);
assert(!(await api('GET', '/api/tasks')).data.tasks.some((t) => t.id === tForBk.data.task.id), '任务已删除');
const rs = await api('POST', '/api/restore', { name: 'latest.json' });
assert(rs.data.ok && (await api('GET', '/api/tasks')).data.tasks.some((t) => t.id === tForBk.data.task.id), '从 Drive 备份恢复后任务回归');
const snaps = (await api('GET', '/api/backup/status')).data.snapshots;
assert(snaps.some((s) => s.name === 'latest.json') && snaps.some((s) => /^backup-\d{4}-\d{2}-\d{2}\.json$/.test(s.name)), '快照列表含 latest + 日期快照');

// 开机自启状态查询（不实际注册）
const as = await api('GET', '/api/autostart');
assert(as.data.ok && typeof as.data.registered === 'boolean', 'autostart 状态可查');

// 内嵌目录浏览器
const ldRoot = await api('GET', '/api/listdir');
assert(ldRoot.data.ok && Array.isArray(ldRoot.data.dirs) && ldRoot.data.dirs.length > 0, 'listdir 返回盘符列表');
const ldSub = await api('GET', '/api/listdir?path=' + encodeURIComponent(ldRoot.data.dirs[0]));
assert(ldSub.data.ok && typeof ldSub.data.parent === 'string', 'listdir 可下钻且有上级');

console.log(`\nALL PASS (${passed} checks)`);
cleanup(0);
