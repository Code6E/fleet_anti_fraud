// 一次性脚本：清除 agent_task_logs 中 status='error' 的记录
// 用法：先停止 server（内存态 SQLite 会回写覆盖文件），再 node cleanup_error_logs.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import initSqlJs from 'sql.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, 'data', 'app.db');
const BAK = path.join(__dirname, 'data', 'app.db.bak-cleanelogs');

const SQL = await initSqlJs();
const db = new SQL.Database(new Uint8Array(fs.readFileSync(DB_PATH)));
fs.copyFileSync(DB_PATH, BAK);
console.log('[bak] 已备份 ->', BAK);

const count = (sql) => {
  const r = db.exec(sql);
  return r.length ? r[0].values[0][0] : 0;
};
console.log('[before] 日志总数 =', count('SELECT COUNT(*) FROM agent_task_logs'),
  '| error 条数 =', count("SELECT COUNT(*) FROM agent_task_logs WHERE status='error'"));

db.run("DELETE FROM agent_task_logs WHERE status='error'");

console.log('[after ] 日志总数 =', count('SELECT COUNT(*) FROM agent_task_logs'),
  '| error 条数 =', count("SELECT COUNT(*) FROM agent_task_logs WHERE status='error'"));
console.log('[after ] 状态分布 =', JSON.stringify(db.exec("SELECT status, COUNT(*) FROM agent_task_logs GROUP BY status")[0]?.values || []));

fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
db.close();
console.log('[done] 已写回', DB_PATH);
