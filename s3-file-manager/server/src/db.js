// SQLite 封装（基于 sql.js，纯 WASM，无需原生编译）
// 数据库以文件形式持久化到 server/data/app.db
//
// Schema 版本（PRAGMA user_version）：
//   v1: 船舶查询（ships + pending_queries 船舶四要素）——已弃用
//   v2: 货运企业查询（companies + ...）——已弃用
//   v3: 船舶险反欺诈查询智能体（当前）：
//       ships                全量船舶主记录（任何机构查询命中即可复用）
//       ship_policy_results  险种粒度结果（一船 × 多险种，17 列结构化）
//       pending_queries      查询行为记录（机构隔离；status: pending/exported/exported_dedup/returned/interpreted/hit）
//       org_settings         机构配置（display_name + enabled；上传模式已迁至 server_settings 全局配置，org_settings.upload_mode/upload_time 字段保留兼容但不再使用）
//       ai_reports           AI 解读报告（挂船舶维度，全量复用）
//       agent_task_logs      Agent 任务执行日志
//       server_settings      系统键值（AGENT_ENABLED / UPLOAD_MODE / UPLOAD_TIME / POLL_TIMES 等）
//       processed_results    结果文件去重
//       ship_profiles        船讯网船舶档案缓存（报告第一节，v1.6）
// 升级时做一次性 .bak 备份并重建，旧版数据视为已弃用。
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import initSqlJs from 'sql.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '../data');
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'app.db');
const SCHEMA_VERSION = 5;

let SQL = null;
let db = null;

export async function initDb() {
  if (db) return db;
  SQL = await initSqlJs();
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(DB_PATH)) {
    const file = fs.readFileSync(DB_PATH);
    db = new SQL.Database(new Uint8Array(file));
  } else {
    db = new SQL.Database();
  }
  createSchema();
  persist();
  return db;
}

function getSchemaVersion() {
  const r = db.exec('PRAGMA user_version');
  return r.length ? r[0].values[0][0] : 0;
}

function createSchema() {
  const current = getSchemaVersion();

  if (current < 3 && current >= 1 && fs.existsSync(DB_PATH)) {
    const bak = DB_PATH + `.bak-v${current}`;
    if (!fs.existsSync(bak)) {
      try { fs.copyFileSync(DB_PATH, bak); } catch { /* 备份失败不阻塞 */ }
    }
  }
  if (current < 3) {
    db.run('DROP TABLE IF EXISTS ships');
    db.run('DROP TABLE IF EXISTS companies');
    db.run('DROP TABLE IF EXISTS pending_queries');
    db.run('DROP TABLE IF EXISTS processed_results');
  }

  // 全量船舶主记录（数据共享层：任何机构查过即可复用）
  db.run(`
    CREATE TABLE IF NOT EXISTS ships (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ship_id_no TEXT DEFAULT '',
      imo_no TEXT DEFAULT '',
      name_cn TEXT DEFAULT '',
      name_en TEXT DEFAULT '',
      latest_risk_level TEXT DEFAULT '',
      latest_risk_types TEXT DEFAULT '',
      first_queried_org TEXT DEFAULT '',
      first_queried_at TEXT,
      last_query_time TEXT,
      created_at TEXT
    );
  `);
  db.run('CREATE INDEX IF NOT EXISTS idx_ships_idno ON ships(ship_id_no);');
  db.run('CREATE INDEX IF NOT EXISTS idx_ships_imo ON ships(imo_no);');
  db.run('CREATE INDEX IF NOT EXISTS idx_ships_namecn ON ships(name_cn);');
  db.run('CREATE INDEX IF NOT EXISTS idx_ships_nameen ON ships(name_en);');
  // 兼容老库（v1.4a 之前的 ships 无 latest_risk_types 列，风险类型 JSON 数组文本）
  try {
    db.run("ALTER TABLE ships ADD COLUMN latest_risk_types TEXT DEFAULT ''");
  } catch { /* 列已存在则忽略 */ }

  // 险种粒度结果（一船 × 多险种；复合值拆解后存 JSON 文本，raw_json 兜底）
  db.run(`
    CREATE TABLE IF NOT EXISTS ship_policy_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ship_id INTEGER NOT NULL,
      insurance_subtype TEXT DEFAULT '',
      loss_ratio_paid TEXT DEFAULT '',
      loss_ratio_total TEXT DEFAULT '',
      accident_causes TEXT DEFAULT '',
      claim_amounts TEXT DEFAULT '',
      claim_ranges TEXT DEFAULT '',
      early_ratio_1m TEXT DEFAULT '',
      early_ratio_2m TEXT DEFAULT '',
      early_ratio_3m TEXT DEFAULT '',
      insurer_count_3y INTEGER,
      latest_insurer_code TEXT DEFAULT '',
      avg_amount_premium TEXT DEFAULT '',
      raw_json TEXT DEFAULT '{}',
      result_file TEXT DEFAULT '',
      returned_at TEXT
    );
  `);
  db.run('CREATE INDEX IF NOT EXISTS idx_spr_ship ON ship_policy_results(ship_id);');

  // 查询行为记录（机构隔离层；hit=全量库秒回命中；exported_dedup=同船跨机构去重重定向副本，v1.3b 新增）
  db.run(`
    CREATE TABLE IF NOT EXISTS pending_queries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      org TEXT NOT NULL,
      requested_by TEXT,
      ship_id_no TEXT DEFAULT '',
      imo_no TEXT DEFAULT '',
      name_cn TEXT DEFAULT '',
      name_en TEXT DEFAULT '',
      ship_id INTEGER,
      status TEXT DEFAULT 'pending',
      hit_type TEXT DEFAULT '',
      created_at TEXT,
      exported_at TEXT,
      export_key TEXT,
      result_file TEXT,
      result_at TEXT,
      main_pending_id INTEGER
    );
  `);
  // 兼容老库（v1.3 之前的 pending_queries 无 main_pending_id 列）
  try {
    db.run("ALTER TABLE pending_queries ADD COLUMN main_pending_id INTEGER");
  } catch { /* 列已存在则忽略 */ }
  db.run('CREATE INDEX IF NOT EXISTS idx_pq_org ON pending_queries(org, status);');
  db.run('CREATE INDEX IF NOT EXISTS idx_pq_main ON pending_queries(main_pending_id);');

  // 机构配置
  db.run(`
    CREATE TABLE IF NOT EXISTS org_settings (
      org TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      upload_mode TEXT DEFAULT 'manual',
      upload_time TEXT DEFAULT '14:30',
      enabled INTEGER DEFAULT 1,
      updated_by TEXT DEFAULT '',
      updated_at TEXT
    );
  `);

  // AI 解读报告（挂船舶维度，全量复用）
  db.run(`
    CREATE TABLE IF NOT EXISTS ai_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ship_id INTEGER NOT NULL,
      risk_level TEXT DEFAULT '',
      rule_hits_json TEXT DEFAULT '[]',
      report_md TEXT DEFAULT '',
      report_json TEXT DEFAULT '{}',
      model TEXT DEFAULT '',
      generated_at TEXT
    );
  `);
  db.run('CREATE INDEX IF NOT EXISTS idx_reports_ship ON ai_reports(ship_id);');

  // Agent 任务执行日志
  db.run(`
    CREATE TABLE IF NOT EXISTS agent_task_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_type TEXT NOT NULL,
      org TEXT DEFAULT '',
      biz_key TEXT DEFAULT '',
      status TEXT DEFAULT 'ok',
      detail TEXT DEFAULT '',
      started_at TEXT,
      finished_at TEXT
    );
  `);

  // 系统键值（AGENT_ENABLED / UPLOAD_MODE / UPLOAD_TIME 等）
  db.run(`
    CREATE TABLE IF NOT EXISTS server_settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);
  // v1.3b：全局上传配置默认值（取代 org_settings 中的上传模式/时刻）
  const defaults = [
    ['AGENT_ENABLED', 'true'],
    ['UPLOAD_MODE', 'manual'],     // manual | auto
    ['UPLOAD_TIME', '14:30'],      // HH:MM，限 12:00-14:50（中银保信 15:00 截单）
  ];
  for (const [k, v] of defaults) {
    db.run(`INSERT OR IGNORE INTO server_settings (key, value) VALUES (?, ?)`, [k, v]);
  }

  // 已处理结果文件去重
  db.run(`
    CREATE TABLE IF NOT EXISTS processed_results (
      key TEXT PRIMARY KEY,
      processed_at TEXT,
      org TEXT,
      records INTEGER,
      pending INTEGER
    );
  `);

  // v1.3g：AI 报告人工评价（评级 1-5 星 + 准确性标签 + 评语；同人同船保留最新一条）
  db.run(`
    CREATE TABLE IF NOT EXISTS ai_feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ship_id INTEGER NOT NULL,
      report_id INTEGER,
      username TEXT NOT NULL,
      org TEXT DEFAULT '',
      rating INTEGER DEFAULT 0,
      accuracy TEXT DEFAULT '',
      comment TEXT DEFAULT '',
      created_at TEXT
    );
  `);
  db.run('CREATE INDEX IF NOT EXISTS idx_feedback_ship ON ai_feedback(ship_id);');

  // v1.6：船讯网船舶档案缓存（报告第一节「船舶档案」；挂船舶维度，全量复用，TTL 失效后重拉）
  db.run(`
    CREATE TABLE IF NOT EXISTS ship_profiles (
      ship_id INTEGER PRIMARY KEY,
      mmsi TEXT DEFAULT '',
      name_cn TEXT DEFAULT '',
      name_en TEXT DEFAULT '',
      regist_number TEXT DEFAULT '',
      build_year INTEGER,
      ship_age INTEGER,
      ship_type TEXT DEFAULT '',
      gt TEXT DEFAULT '',
      dwt TEXT DEFAULT '',
      builder TEXT DEFAULT '',
      shipowner TEXT DEFAULT '',
      source TEXT DEFAULT '',
      fetched_at TEXT
    );
  `);

  db.run(`PRAGMA user_version = ${SCHEMA_VERSION}`);
}

export function persist() {
  if (!db) return;
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

export function all(sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length) stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

export function get(sql, params = []) {
  return all(sql, params)[0] || null;
}

export function run(sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length) stmt.bind(params);
  stmt.step();
  stmt.free();
  persist();
}

export function runReturnId(sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length) stmt.bind(params);
  stmt.step();
  stmt.free();
  const row = get('SELECT last_insert_rowid() AS id');
  persist();
  return row ? row.id : null;
}

export function getDb() {
  return db;
}
