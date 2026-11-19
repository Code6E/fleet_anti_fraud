// 一次性脚本：删除「我的查询」中状态为【待返回】的查询记录
// 口径：status IN ('pending','exported','exported_dedup')，即尚未拿到中银保信结果的记录
// 用法：先停止 server（sql.js 内存态会回写覆盖文件），再 node cleanup_pending_queries.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import initSqlJs from 'sql.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, 'data', 'app.db');
const BAK = path.join(__dirname, 'data', 'app.db.bak-delpending');
const WHERE = "status IN ('pending','exported','exported_dedup')";

const SQL = await initSqlJs();
const db = new SQL.Database(new Uint8Array(fs.readFileSync(DB_PATH)));
fs.copyFileSync(DB_PATH, BAK);
process.stdout.write('[bak] 已备份 -> ' + BAK + '\n');

const q = (sql) => {
  const r = db.exec(sql);
  return r.length ? r[0].values : [];
};
const count = (sql) => (q(sql)[0] || [0])[0];

const before = q(`SELECT status, COUNT(*) FROM pending_queries GROUP BY status`);
process.stdout.write('[before] pending_queries 总数 = ' + count('SELECT COUNT(*) FROM pending_queries')
  + '，状态分布 = ' + JSON.stringify(before) + '\n');
process.stdout.write('[待删明细] ' + JSON.stringify(q(
  `SELECT id, org, requested_by, status, COALESCE(name_cn,'') , COALESCE(ship_id_no,''), COALESCE(export_key,'')
     FROM pending_queries WHERE ${WHERE} ORDER BY id`)) + '\n');

db.run(`DELETE FROM pending_queries WHERE ${WHERE}`);
const changed = count("SELECT changes()");
process.stdout.write('[del] 影响行数 = ' + changed + '\n');

process.stdout.write('[after ] pending_queries 总数 = ' + count('SELECT COUNT(*) FROM pending_queries')
  + '，状态分布 = ' + JSON.stringify(q('SELECT status, COUNT(*) FROM pending_queries GROUP BY status')) + '\n');
process.stdout.write('[after ] 仍无 ship_id 的记录数 = '
  + count('SELECT COUNT(*) FROM pending_queries WHERE ship_id IS NULL')
  + '（前端「待返回」应为 0）\n');

fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
db.close();
process.stdout.write('[done] 已写回 ' + DB_PATH + '\n');
