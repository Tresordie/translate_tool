// 验证邮件总结的 PDF 解析管线：用页面同一份 pdf.min.js + 相同的提取逻辑解析样例 PDF
// 运行：node tests/pdf-parse.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const libPath = path.join(here, '..', 'pdf.min.js');

// pdf.js UMD 在 Node 下以 CommonJS 方式加载
const pdfjsLib = (await import(pathToFileURL(libPath).href)).default || globalThis.pdfjsLib;
if (!pdfjsLib) {
  console.error('FAIL: pdfjsLib 未加载');
  process.exit(1);
}
console.log('pdf.js version:', pdfjsLib.version);
// pdf.js 的 Node fake worker 走裸 require，只能给纯路径（不能是 file:// URL）
pdfjsLib.GlobalWorkerOptions.workerSrc = path.join(here, '..', 'pdf.worker.min.js');

// 与 email_summary.js extractPdfText 相同的行合并逻辑
async function extractPdfText(buffer) {
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
  let full = '';
  const maxPages = Math.min(doc.numPages, 500);
  for (let p = 1; p <= maxPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    let lastY = null;
    let line = '';
    for (const item of tc.items) {
      const y = item.transform && item.transform[5];
      if (lastY !== null && Math.abs(y - lastY) > 3) {
        full += line + '\n';
        line = '';
      }
      line += item.str;
      if (item.hasEOL) {
        full += line + '\n';
        line = '';
      }
      lastY = y;
    }
    full += line;
    page.cleanup();
  }
  return full;
}

const buf = fs.readFileSync(path.join(here, 'sample_email.pdf'));
const text = await extractPdfText(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
console.log('--- 提取文本 ---');
console.log(text.trim());
console.log('----------------');

const ok = /Maple packs/.test(text) && /8D report/.test(text);
console.log(ok ? 'PASS: PDF 文本提取正常' : 'FAIL: 提取内容不符合预期');
process.exit(ok ? 0 : 1);
