// 汇总总公司单文件 + 三级账号体系冒烟测试（v1.3f / v1.3g）
// 验证点：
//  1. 三级数据隔离：分公司可见本分公司+所属中支；中支仅本中支；负向不见不到其他机构
//  2. 运行概览 /api/ships/overview 按可见范围统计
//  3. 汇总导出改为「总公司单文件」：所有机构去重后合并到一个文件，文件名含总公司名
//  4. 跨机构同船去重：gd 与 gzyx 同查"测试船X" → 文件中只 1 行；结果返回后两条 pending 都回填
//  5. 非管理员看不到文件管理（导航不渲染——由前端构建保证，本脚本聚焦后端逻辑）
//  6. v1.3g：单船中银保信数据 Excel 导出 / AI 报告 Markdown 下载 / 人工评价（提交+更新+聚合）
// 运行：node test_hierarchy.mjs（自动拉起独立服务实例，临时目录，零内网依赖）
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'hierarchy-test-'));
fs.mkdirSync(path.join(TMP, 'upload'), { recursive: true });
fs.mkdirSync(path.join(TMP, 'download'), { recursive: true });

const PORT = 3998;
const BASE = `http://127.0.0.1:${PORT}`;

const USERS = JSON.stringify([
  { username: 'admin', password: 'a123', org: '总公司', role: 'admin' },
  { username: 'gd', password: 'g123', org: '广东分公司', role: 'org' },
  { username: 'gzyx', password: 'y123', org: '广州市越秀支公司', role: 'sub_org', parent_org: '广东分公司' },
  { username: 'sh', password: 's123', org: '上海分公司', role: 'org' },
]);

const server = spawn(process.execPath, ['src/index.js'], {
  cwd: __dirname,
  env: {
    ...process.env,
    PORT: String(PORT),
    USERS,
    DB_PATH: path.join(TMP, 'app.db'),
    DEFAULT_SOURCE: 'local',
    LOCAL_DB_PATH: TMP,
    DEEPSEEK_API_KEY: '', // 强制规则版解读，离线可测
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stdout.on('data', (d) => process.stdout.write('[srv] ' + d));
server.stderr.on('data', (d) => process.stderr.write('[srv-err] ' + d));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitHealth(tries = 40) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return;
    } catch { /* not up yet */ }
    await sleep(250);
  }
  throw new Error('服务启动超时');
}

async function login(username, password) {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const d = await r.json();
  if (d.status !== 'ok') throw new Error(`登录失败 ${username}: ${d.message}`);
  return d.token;
}

async function call(token, method, url, body) {
  const r = await fetch(BASE + url, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: body ? JSON.stringify(body) : undefined,
  });
  const d = await r.json();
  if (!r.ok) throw new Error(`${method} ${url} -> HTTP ${r.status}: ${d.message}`);
  return d;
}

let passed = 0;
function assert(cond, label) {
  if (cond) { passed++; console.log(`  ✅ ${label}`); }
  else { console.error(`  ❌ ${label}`); failed.push(label); }
}
const failed = [];

async function main() {
  await waitHealth();
  console.log('== 服务已启动（临时目录隔离）==');

  const admin = await login('admin', 'a123');
  const gd = await login('gd', 'g123');
  const gzyx = await login('gzyx', 'y123');
  const sh = await login('sh', 's123');
  console.log('== 四账号登录成功 ==');

  // ---- 提交查询：gd 与 gzyx 同查"测试船X"（跨机构同船去重），sh 查"沪测船003" ----
  await call(gd, 'POST', '/api/ships/pending', { name_cn: '测试船X' });
  await call(gzyx, 'POST', '/api/ships/pending', { name_cn: '测试船X' });
  await call(sh, 'POST', '/api/ships/pending', { name_cn: '沪测船003' });
  console.log('== 三机构提交 3 条查询（gd 与 gzyx 同船）==');

  // ---- 三级数据隔离（导出前）----
  const gdRows0 = (await call(gd, 'GET', '/api/ships/pending')).rows;
  const gzyxRows0 = (await call(gzyx, 'GET', '/api/ships/pending')).rows;
  const shRows0 = (await call(sh, 'GET', '/api/ships/pending')).rows;
  assert(gdRows0.length === 2, `分公司(gd)可见 2 条（本分公司"测试船X" + 中支"测试船X"），实际 ${gdRows0.length}`);
  assert(gzyxRows0.length === 1, `中支(gzyx)可见本中支 1 条，实际 ${gzyxRows0.length}`);
  assert(shRows0.length === 1 && shRows0[0].name_cn === '沪测船003', '分公司(sh)仅本分公司 1 条');
  assert(!gdRows0.some((r) => r.name_cn === '沪测船003'), '分公司(gd)看不到其他分公司（上海）数据');

  // ---- 运行概览按范围统计 ----
  const ovGd = await call(gd, 'GET', '/api/ships/overview');
  const ovYx = await call(gzyx, 'GET', '/api/ships/overview');
  const ovAdmin = await call(admin, 'GET', '/api/ships/overview');
  assert(ovGd.stats.total === 2 && ovGd.stats.pending === 2, `分公司(gd)概览 total=2/pending=2，实际 ${ovGd.stats.total}/${ovGd.stats.pending}`);
  assert(ovYx.stats.total === 1, `中支(gzyx)概览 total=1，实际 ${ovYx.stats.total}`);
  assert(ovAdmin.scope_orgs === 'all' && ovAdmin.stats.total === 3, '管理员概览全量 total=3');

  // ---- 汇总导出：总公司单文件 + 跨机构同船去重 ----
  const exp = await call(admin, 'POST', '/api/ships/admin/export-now', {});
  const files = exp.files || [];
  assert(files.length === 1, `汇总成 1 个总公司文件（不再按分公司分组），实际 ${files.length}`);
  const hqFile = files[0];
  assert(!!hqFile && hqFile.count === 2, `总公司文件含 2 条（"测试船X"去重后 1 条 + "沪测船003" 1 条），实际 ${hqFile?.count}`);
  assert(!!hqFile && hqFile.fileName && hqFile.fileName.includes('总公司'),
    `文件名以总公司命名：${hqFile?.fileName}`);
  assert(exp.dedupCount === 1, `跨机构同船去重 1 条（gd 与 gzyx 同查"测试船X"），实际 ${exp.dedupCount}`);
  const uploaded = fs.readdirSync(path.join(TMP, 'upload')).filter((f) => f.endsWith('.xlsx'));
  assert(uploaded.length === 1, `upload/ 目录恰有 1 个 xlsx（总公司文件），实际 ${uploaded.length}`);

  // 导出后状态：主查询 exported；gzyx 的同船副本应标记 exported_dedup
  const gzyxAfterExport = (await call(gzyx, 'GET', '/api/ships/pending')).rows;
  assert(gzyxAfterExport[0].status === 'exported_dedup',
    `中支(gzyx)的同船查询被去重标记为 exported_dedup，实际 ${gzyxAfterExport[0].status}`);

  // ---- 模拟中银保信 T+1 返回 → 导入 → 全局回填 ----
  const sim = await call(admin, 'POST', '/api/ships/admin/simulate-return', {});
  assert((sim.generated || []).length === 1, `模拟返回生成 1 个总公司结果文件，实际 ${(sim.generated || []).length}`);

  const gdAfter = (await call(gd, 'GET', '/api/ships/pending')).rows;
  const gzyxAfter = (await call(gzyx, 'GET', '/api/ships/pending')).rows;
  const shAfter = (await call(sh, 'GET', '/api/ships/pending')).rows;
  const gdX = gdAfter.find((r) => r.name_cn === '测试船X');
  const yxX = gzyxAfter.find((r) => r.name_cn === '测试船X');
  const sh003 = shAfter.find((r) => r.name_cn === '沪测船003');
  assert(!!gdX && gdX.ship_id && ['returned', 'interpreted'].includes(gdX.status),
    `分公司(gd)主查询"测试船X"回填 ship_id + 推进状态，实际 ${gdX?.status}/${!!gdX?.ship_id}`);
  assert(!!yxX && yxX.ship_id && yxX.status === 'interpreted',
    `中支(gzyx)去重副本"测试船X"回填 ship_id + interpreted（跨机构回填），实际 ${yxX?.status}/${!!yxX?.ship_id}`);
  assert(!!sh003 && sh003.ship_id && ['returned', 'interpreted'].includes(sh003.status),
    `分公司(sh)"沪测船003"回填 ship_id + 推进状态，实际 ${sh003?.status}/${!!sh003?.ship_id}`);

  // ---- 概览随结果更新 ----
  const ovGd2 = await call(gd, 'GET', '/api/ships/overview');
  const ovYx2 = await call(gzyx, 'GET', '/api/ships/overview');
  assert(ovGd2.stats.returned === 2, `分公司(gd)概览 returned=2（本分公司主查询+中支副本），实际 ${ovGd2.stats.returned}`);
  assert(ovYx2.stats.returned === 1, `中支(gzyx)概览 returned=1（去重副本已回填），实际 ${ovYx2.stats.returned}`);

  // ---- 中支船舶列表：仅本中支查询关联的船舶 ----
  const yxShips = (await call(gzyx, 'GET', '/api/ships')).rows;
  assert(yxShips.length === 1, `中支(gzyx)船舶列表仅 1 艘（本中支查询关联），实际 ${yxShips.length}`);

  // ---- v1.3g：单船数据导出 / AI 报告下载 / 人工评价 ----
  const shipIdX = yxX?.ship_id;
  const raw = async (token, url) => {
    const r = await fetch(BASE + url, { headers: { Authorization: 'Bearer ' + token } });
    return { status: r.status, ct: r.headers.get('content-type') || '', cd: r.headers.get('content-disposition') || '', buf: Buffer.from(await r.arrayBuffer()) };
  };

  // 1) 中银保信返回数据 Excel（raw_json 原始列还原）
  const xlsxRes = await raw(gzyx, `/api/ships/${shipIdX}/export-data`);
  assert(xlsxRes.status === 200 && xlsxRes.ct.includes('spreadsheetml'),
    `导出返回数据为 xlsx（HTTP ${xlsxRes.status}，CT ${xlsxRes.ct.slice(0, 40)}）`);
  assert(xlsxRes.cd.includes("filename*=UTF-8''") && decodeURIComponent(xlsxRes.cd).includes('船舶数据_'),
    `Content-Disposition 含中文文件名：${decodeURIComponent(xlsxRes.cd).slice(0, 60)}`);
  const ExcelJS = (await import('exceljs')).default;
  const wb2 = new ExcelJS.Workbook();
  await wb2.xlsx.load(xlsxRes.buf);
  const ws2 = wb2.worksheets[0];
  const headers = (ws2.getRow(1).values || []).slice(1).map(String);
  const dataRows = [];
  ws2.eachRow((row, no) => { if (no > 1) dataRows.push(row.values.slice(1).map(String)); });
  assert(headers.some((h) => h.includes('险种小类')) && headers.some((h) => h.includes('满期赔付率')),
    `导出表头保留中银保信原始信息列（${headers.length} 列，含险种小类/满期赔付率）`);
  assert(dataRows.length >= 1 && dataRows.flat().some((v) => v.includes('测试船X')),
    `导出行属于该船舶（${dataRows.length} 行，含"测试船X"）`);

  // 2) AI 报告下载（Markdown）
  const mdRes = await raw(gd, `/api/ships/${shipIdX}/export-report`);
  const mdText = mdRes.buf.toString('utf8');
  assert(mdRes.status === 200 && mdText.includes('船舶险反欺诈 AI 解读报告') && mdText.includes('风险等级'),
    `AI 报告下载为 Markdown（${mdRes.buf.length} 字节，含标题与风险等级）`);
  const noReport = await raw(gd, '/api/ships/999999/export-report');
  assert(noReport.status === 404, '不存在的船舶报告下载返回 404');

  // 3) 人工评价：提交 → 读取 → 更新 → 聚合
  const fb1 = await call(gzyx, 'POST', `/api/ships/${shipIdX}/feedback`, { rating: 5, accuracy: '准确', comment: '分析到位' });
  assert(fb1.status === 'ok', '评价提交成功');
  const fbRead = await call(gzyx, 'GET', `/api/ships/${shipIdX}/feedback`);
  assert(fbRead.mine?.rating === 5 && fbRead.count === 1 && fbRead.avgRating === 5,
    `评价读取：mine.rating=5 / count=1 / avg=5，实际 ${fbRead.mine?.rating}/${fbRead.count}/${fbRead.avgRating}`);
  await call(gd, 'POST', `/api/ships/${shipIdX}/feedback`, { rating: 3, accuracy: '部分准确' });
  const fbRead2 = await call(admin, 'GET', `/api/ships/${shipIdX}/feedback`);
  assert(fbRead2.count === 2 && fbRead2.avgRating === 4, `双人评价聚合 count=2 / avg=4，实际 ${fbRead2.count}/${fbRead2.avgRating}`);
  const fbUpd = await call(gzyx, 'POST', `/api/ships/${shipIdX}/feedback`, { rating: 2, accuracy: '不准确', comment: '赔付率解读有偏差' });
  const fbRead3 = await call(gzyx, 'GET', `/api/ships/${shipIdX}/feedback`);
  assert(fbUpd.status === 'ok' && fbRead3.mine.rating === 2 && fbRead3.count === 2 && fbRead3.avgRating === 2.5,
    `同人同船更新评价（保留最新）：mine.rating=2 / avg=2.5，实际 ${fbRead3.mine.rating}/${fbRead3.avgRating}`);
  const fbBad = await fetch(`${BASE}/api/ships/${shipIdX}/feedback`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + gzyx },
    body: JSON.stringify({ rating: 0 }),
  });
  assert(fbBad.status === 400, '无星级评价返回 400');

  console.log(`\n== 冒烟结果：${passed} 通过 / ${failed.length} 失败 ==`);
  if (failed.length) {
    console.error('失败项：', failed);
    process.exitCode = 1;
  }
}

main()
  .catch((e) => { console.error('[fatal]', e); process.exitCode = 1; })
  .finally(() => {
    server.kill('SIGTERM');
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* ignore */ }
  });
