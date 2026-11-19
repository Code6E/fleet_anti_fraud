// T2 解析回归测试：对「本地S3数据库/download/」全部结果文件做
// 文件名容错解析 + 内容解析（一船多险种），输出统计与失败清单。
// 用法：node test_parse_all.js [download目录路径]
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseShipResultExcel, parseResultFileName } from './src/excel.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dir = process.argv[2] || path.resolve(__dirname, '..', '..', '本地S3数据库', 'download');

const files = fs.readdirSync(dir).filter((f) => /\.xlsx$/i.test(f));
let okName = 0, badName = 0, shipFiles = 0, unknownFormat = 0, errFiles = 0;
let totalShips = 0, totalPolicies = 0;
const badNames = [], unknowns = [], errors = [];

for (const f of files) {
  // 1) 文件名解析
  const fn = parseResultFileName(f);
  if (fn.ok) { okName++; if (fn.service === 'A01') { /* 企业格式：跳过内容解析 */ } }
  else { badName++; badNames.push(`${f}  →  ${fn.reason}`); }

  // 2) 内容解析（仅船舶格式）
  try {
    const buf = fs.readFileSync(path.join(dir, f));
    const parsed = await parseShipResultExcel(buf);
    if (parsed.format === 'ship') {
      shipFiles++;
      totalShips += parsed.ships.length;
      totalPolicies += parsed.ships.reduce((a, s) => a + s.policies.length, 0);
      // 抽样打印第一条结构化结果
      const first = parsed.ships[0];
      const p0 = first.policies[0];
      console.log(`[ship] ${f}`);
      console.log(`   船: ${first.conditions.name_cn || first.conditions.ship_id_no || first.conditions.name_en} × ${first.policies.length} 险种`);
      console.log(`   首险种: ${p0.insurance_subtype} | 赔付率(已决+未决)=${JSON.stringify(p0.loss_ratio_total)} | 起保当月=${JSON.stringify(p0.early_ratio_1m)} | 保险公司数=${p0.insurer_count_3y} | 单均保额保费=${JSON.stringify(p0.avg_amount_premium)}`);
    } else {
      unknownFormat++;
      unknowns.push(f);
    }
  } catch (e) {
    errFiles++;
    errors.push(`${f}  →  ${e.message}`);
  }
}

console.log('\n========== 解析回归报告 ==========');
console.log(`文件总数: ${files.length}`);
console.log(`文件名解析: 成功 ${okName} / 失败 ${badName}（企业格式与船舶格式合计）`);
console.log(`内容解析: 船舶格式 ${shipFiles} 个（船 ${totalShips} 条 × 险种记录 ${totalPolicies} 行）/ 非船舶格式(企业/货运) ${unknownFormat} 个 / 解析异常 ${errFiles} 个`);
if (badNames.length) { console.log('\n-- 文件名未识别（待人工处理）--'); badNames.forEach((x) => console.log('  ' + x)); }
if (unknowns.length) { console.log('\n-- 非船舶格式（企业旧数据，正常跳过）--'); unknowns.forEach((x) => console.log('  ' + x)); }
if (errors.length) { console.log('\n-- 解析异常 --'); errors.forEach((x) => console.log('  ' + x)); }
