// 一次性诊断脚本：列出 S3 download/ 下 *20240603*_result.xlsx 的文件，下载到本地，
// 并尝试用项目自带的 parseResultExcel 解析，同时输出原始前 5 行供人工对照。
// 用法：cd server && "D:/Program Files/nodejs/node.exe" diag_download.mjs
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import ExcelJS from 'exceljs';
import { listObjects, getObject } from './src/s3.js';
import { parseResultExcel } from './src/excel.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env') });

const dateCompact = '20240603';
const prefix = (process.env.RESULT_S3_PREFIX || 'download/').replace(/^\/+|\/+$/g, '') + '/';
const outDir = path.join(__dirname, 'data', 'diag-download');

await fs.mkdir(outDir, { recursive: true });

function streamToBuffer(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (c) => chunks.push(c));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

async function dumpRaw(buffer, tag) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  if (!ws) { console.log(`  [${tag}] empty workbook`); return; }
  const headers = ws.getRow(1).values.slice(1).map((v) => v == null ? '' : String(v));
  console.log(`  [${tag}] sheet="${ws.name}" rows=${ws.rowCount} cols=${ws.columnCount}`);
  console.log(`  [${tag}] headers:`, headers);
  const limit = Math.min(5, ws.rowCount);
  for (let r = 2; r <= limit + 1; r++) {
    const row = ws.getRow(r);
    const vals = headers.map((_, i) => {
      const v = row.getCell(i + 1).value;
      if (v == null) return '';
      if (typeof v === 'object') {
        if (v.text != null) return String(v.text);
        if (v.richText) return v.richText.map((t) => t.text).join('');
        if (v.result != null) return String(v.result);
        return JSON.stringify(v);
      }
      return String(v);
    });
    console.log(`  [${tag}] R${r}:`, vals.join(' | '));
  }
}

console.log('--- CONFIG ---');
console.log('  BUCKET =', process.env.S3_BUCKET);
console.log('  RESULT_S3_PREFIX =', prefix);
console.log('  matching pattern = *_' + dateCompact + '*_result.xlsx');

const { files } = await listObjects(prefix);
const matched = files.filter((f) => /_result\.xlsx$/i.test(f.name) && f.name.includes('_' + dateCompact));
console.log(`--- matched ${matched.length} file(s) ---`);
for (const f of matched) console.log('  -', f.key);

for (let i = 0; i < matched.length; i++) {
  const f = matched[i];
  const tag = `#${i + 1}`;
  console.log(`\n=== ${tag} ${f.key} ===`);
  let buf;
  try {
    const obj = await getObject(f.key);
    if (obj.stream) buf = await streamToBuffer(obj.stream);
    else buf = Buffer.from(await obj.rawBody.transformToByteArray());
  } catch (e) {
    console.log(`  download error: ${e.message}`);
    continue;
  }
  console.log(`  size = ${buf.length} bytes`);
  const localPath = path.join(outDir, f.name);
  await fs.writeFile(localPath, buf);
  console.log(`  saved -> ${localPath}`);

  let parsed;
  try { parsed = await parseResultExcel(buf); }
  catch (e) { console.log(`  parseResultExcel error: ${e.message}`); parsed = []; }
  console.log(`  parseResultExcel -> ${parsed.length} row(s)`);
  if (parsed.length === 0) {
    console.log('  -> parse returned 0. dumping raw content for inspection:');
    await dumpRaw(buf, tag);
  } else if (parsed.length > 0) {
    console.log('  first parsed row:', JSON.stringify(parsed[0], null, 2));
  }
}
console.log('\n--- DONE ---');