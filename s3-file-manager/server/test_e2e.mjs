// T8 端到端测试：收单 → 合规文件生成上传 → 模拟中银保信 T+1 返回 → 轮询导入 → AI 解读 → 全量库命中
// 完全离线（数据源=临时复制的本地S3数据库镜像），不触碰真实镜像目录与生产桶。
// 用法：DEFAULT_SOURCE=local DB_PATH=/tmp/e2e-ship.db node test_e2e.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIRROR = path.resolve(__dirname, '..', '..', '本地S3数据库');
const TMP = '/tmp/e2e-s3-mirror';

// 1) 准备干净的临时镜像
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });
for (const d of ['upload', 'download']) {
  fs.cpSync(path.join(MIRROR, d), path.join(TMP, d), { recursive: true });
}
process.env.LOCAL_DB_PATH = TMP;

const { initDb, all, get } = await import('./src/db.js');
await initDb();

// 2) 模拟「广东分公司」机构用户收单（两条待查询船舶）
const { exportPendingForOrg, importResults } = await import('./src/scheduler.js');
const { runReturnId } = await import('./src/db.js');
const now = new Date().toISOString();
for (const ship of [
  { ship_id_no: 'CN99990001', name_cn: '测试船舶001' },
  { ship_id_no: '', imo_no: 'IMO9999002', name_en: 'TEST SHIP 002' },
]) {
  runReturnId(
    `INSERT INTO pending_queries (org, requested_by, ship_id_no, imo_no, name_cn, name_en, status, created_at)
     VALUES (?,?,?,?,?,?,'pending',?)`,
    ['广东分公司', 'tester', ship.ship_id_no || '', ship.imo_no || '', ship.name_cn || '', ship.name_en || '', now],
  );
}
console.log('步骤1 收单：广东分公司录入 2 条待查询 ✓');

// 3) 触发该机构自动导出 → 生成合规文件上传 upload/
const exp = await exportPendingForOrg('广东分公司');
console.log('步骤2 汇总上传：', JSON.stringify(exp));
const uploaded = fs.readdirSync(path.join(TMP, 'upload')).filter((f) => f.includes('广东分公司') && f.includes('20260901'));
console.log(`  upload/ 中新生成文件: ${uploaded.join(', ') || '(无)'} ${uploaded.length ? '✓' : '✗'}`);

// 4) 模拟中银保信 T+1 返回：把生成的待查询文件改名 _result 并追加结果列（构造仿真返回数据）
//    另外直接保留镜像中已有的真实结果文件，一并验证轮询全量导入
if (uploaded.length) {
  const src = path.join(TMP, 'upload', uploaded[0]);
  const dst = path.join(TMP, 'download', uploaded[0].replace(/\.xlsx$/, '_result.xlsx'));
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(src);
  const ws = wb.getWorksheet('A01入参');
  // 追加结果列（仿真：含高风险特征——起保当月出险占比 50%、赔付率 120/150）
  ws.columns.forEach((c) => { /* noop */ });
  const headers = ['险种小类', '当年及过去3年满期赔付率\n（已决）', '当年及过去3年满期赔付率\n（已决+未决）', '近3年出险原因及数量', '近3年赔案金额', '近3年赔案区间及案件数量', '近1年起保当月出\n险保单数量及占比', '近1年起保2个月出\n险保单数量及占比', '近1年起保3个月出\n险保单数量及占比', '近3年保单涉及\n保险公司数量', '最近保单涉及\n保险公司代码', '近3年单均保额保费'];
  const hrow = ws.getRow(1);
  headers.forEach((h, i) => { hrow.getCell(7 + i).value = h; });
  hrow.commit();
  const r1 = ws.getRow(2);
  ['船壳险', 'Z,0,120,150', 'Z,0,120,150', '碰撞4次', '(null)', '(null)', '2,50.00%', '1,25.00%', '0,0.00%', '4', '000017', '5000000,30000']
    .forEach((v, i) => { r1.getCell(7 + i).value = v; });
  r1.commit();
  const r2 = ws.getRow(3);
  ['保赔险', 'Z,0,0,0', 'Z,0,0,0', '(null)', '(null)', '(null)', '0,0.00%', '0,0.00%', '0,0.00%', '4', '000017', '5000000,30000']
    .forEach((v, i) => { r2.getCell(7 + i).value = v; });
  r2.commit();
  await wb.xlsx.writeFile(dst);
  console.log(`步骤3 模拟返回：已生成仿真结果文件 download/${path.basename(dst)} ✓`);
}

// 5) Agent 轮询导入（全量扫描 download/：11 个真实结果 + 1 个仿真结果）
const imp = await importResults();
console.log(`步骤4 轮询导入：匹配 ${imp.matched} 个结果文件，成功导入 ${imp.imported.length} 个，跳过 ${imp.skipped.length} 个，失败 ${imp.failed.length} 个`);
for (const it of imp.imported) {
  console.log(`  - ${path.basename(it.key)}：${it.ships} 船 / ${it.policies} 险种 / 关联待查询 ${it.pending} 条`);
}
if (imp.failed.length) console.log('  失败明细：', JSON.stringify(imp.failed));

// 6) 验证全量库与 AI 报告
const ships = all('SELECT id, name_cn, ship_id_no, latest_risk_level FROM ships ORDER BY id');
console.log(`步骤5 全量库：共 ${ships.length} 船`);
const withReports = all('SELECT r.ship_id, r.risk_level, r.model, s.name_cn FROM ai_reports r JOIN ships s ON s.id=r.ship_id');
console.log(`步骤6 AI 报告：共 ${withReports.length} 份（模型分布：${[...new Set(withReports.map((r) => r.model))].join(', ')}）`);
for (const r of withReports.slice(0, 15)) {
  console.log(`  - ${r.name_cn || '(未命名)'} → ${r.risk_level}（${r.model}）`);
}
// 高风险船（仿真数据应命中 R1 倒签单 + R2 高赔付 + R3 频繁转保 → high）
const high = all("SELECT s.name_cn, r.rule_hits_json FROM ships s JOIN ai_reports r ON r.ship_id=s.id WHERE s.latest_risk_level='high'");
console.log(`步骤7 高风险船：${high.length} 艘`);
for (const h of high) {
  const hits = JSON.parse(h.rule_hits_json).map((x) => `${x.rule}${x.name}`).join('、');
  console.log(`  - ${h.name_cn}：${hits}`);
}

// 7) 验证待查询状态机（广东分公司的 2 条仿真单应已 interpreted）
const pq = all("SELECT status, COUNT(*) AS n FROM pending_queries WHERE org='广东分公司' GROUP BY status");
console.log('步骤8 待查询状态机（广东分公司）：', JSON.stringify(pq));
console.log('\n========== 端到端测试完成 ==========');
