// 验证 DeepSeek LLM 真实接入：对 /tmp/e2e-ship.db 中的一条船重新生成 LLM 报告
// 用法：node test_llm.mjs
import 'dotenv/config';
import fs from 'fs';
fs.copyFileSync('/tmp/e2e-ship.db', '/tmp/llm-ship.db');
process.env.DB_PATH = '/tmp/llm-ship.db';

const { initDb, all } = await import('./src/db.js');
await initDb();
const { runInterpretForShip } = await import('./src/interpret.js');
const { llmAvailable } = await import('./src/interpret.js');

console.log('LLM 可用:', llmAvailable(), '| model:', process.env.DEEPSEEK_MODEL);

// 取仿真高风险船「测试船舶001」
const ship = all("SELECT id, name_cn FROM ships WHERE name_cn='测试船舶001'")[0]
  || all('SELECT id, name_cn FROM ships LIMIT 1')[0];
console.log('目标船舶:', ship);

const t0 = Date.now();
const r = await runInterpretForShip(ship.id);
console.log(`耗时: ${((Date.now() - t0) / 1000).toFixed(1)}s | 风险等级: ${r.risk_level} | 模型: ${r.model}`);
console.log('命中规则:', r.hits.map((h) => `${h.rule}${h.name}`).join('、'));

const { get } = await import('./src/db.js');
const rep = get('SELECT report_md FROM ai_reports WHERE ship_id=? ORDER BY id DESC LIMIT 1', [ship.id]);
console.log('\n========== LLM 生成的解读报告 ==========');
console.log(rep.report_md);
