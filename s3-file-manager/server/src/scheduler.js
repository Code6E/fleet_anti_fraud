// Agent 调度核心：待查询汇总上传 + 结果文件轮询导入（船舶险反欺诈 v3，v1.3b 去重升级）
//  - dedupPending()：汇总前对所有机构 pending 按船舶四要素去重；同船只保留首条 pending，
//    其余重定向副本标记 exported_dedup + 主查询 id（每条中银保信返回 4 元成本，必减查询次数）
//  - exportPendingAll(date)：全局统一汇总 → dedupPending → 按机构生成合规文件 → 三重校验 → 上传
//  - importResults(date?)：全量扫描 download/ 的 _result 文件，逐文件去重导入、按险种解析入全量库、触发 AI 解读；
//    解析后将重定向副本状态回写（绑定 ship_id 并置 interpreted）
//  - 所有操作写 agent_task_logs；单文件失败跳过不阻塞其他机构
//  - 定时触发见 cron.js（全局时刻）；手动触发见 routes/ships.js 的 admin 接口
import path from 'path';
import { putObject, getObject, listObjects, ensureReady } from './storage.js';
import { all, get, run, runReturnId, persist } from './db.js';
import { buildShipQueryExcel, buildQueryFileName, isValidQueryFileName, parseShipResultExcel, parseResultFileName, parseShipQueryExcel, buildShipResultExcel } from './excel.js';
import { runInterpretForShip } from './interpret.js';
import { orgFamily, branchOf, hqOrg } from './auth.js';

// 上传/下载目录（对齐中银保信真实布局，可用环境变量覆盖）
const UPLOAD_PREFIX = (process.env.UPLOAD_S3_PREFIX || 'upload/').replace(/^\/+|\/+$/g, '') + '/';
const RESULT_PREFIX = (process.env.RESULT_S3_PREFIX || 'download/').replace(/^\/+|\/+$/g, '') + '/';

// Agent 任务日志
export function logTask(task_type, org, biz_key, status, detail, started_at) {
  run(
    'INSERT INTO agent_task_logs (task_type, org, biz_key, status, detail, started_at, finished_at) VALUES (?,?,?,?,?,?,?)',
    [task_type, org || '', biz_key || '', status, String(detail || '').slice(0, 2000), started_at || new Date().toISOString(), new Date().toISOString()],
  );
}

function dateStr(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

function streamToBuffer(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (c) => chunks.push(c));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

// 机构 display_name（文件名中的分公司名）；无 org_settings 记录时用 org 原值（org 可直接配为分公司名）
export function orgDisplayName(org) {
  const row = get('SELECT display_name FROM org_settings WHERE org=?', [org]);
  return row?.display_name || org;
}

// 由文件名中的分公司名反查 org code（用于结果归属）
function orgByDisplayName(displayName) {
  const row = get('SELECT org FROM org_settings WHERE display_name=?', [displayName]);
  return row?.org || displayName;
}

// ====================== 汇总前去重（v1.3b 新增） ======================

// 按船舶四要素生成标准化 key（去除空格、统一英文小写；任一字段非空即可构成 key）
function shipDedupKey(p) {
  const norm = (s) => (s || '').toString().trim().replace(/\s+/g, '').toLowerCase();
  const parts = [];
  if (p.ship_id_no) parts.push('id:' + norm(p.ship_id_no));
  if (p.imo_no) parts.push('imo:' + norm(p.imo_no));
  if (p.name_cn) parts.push('cn:' + norm(p.name_cn));
  if (p.name_en) parts.push('en:' + norm(p.name_en));
  return parts.join('|');
}

// 汇总前去重：所有机构 status=pending 的查询按船舶四要素去重
//  - 同船只保留首条 pending（按 id 升序）作为主查询
//  - 其余标记 status=exported_dedup + main_pending_id（指向主查询）
//  - 仅当 main_pending_id 已绑定 ship_id 后，重定向副本才会同步 ship_id 并置 interpreted
// 返回 { mainRows: 去重后保留的 pending 列表（含 org 与原四要素）, dedupCount: 重定向的副本数 }
export function dedupPending() {
  const allPending = all("SELECT * FROM pending_queries WHERE status='pending' ORDER BY id ASC");
  if (!allPending.length) return { mainRows: [], dedupCount: 0 };

  const seen = new Map();   // shipKey → 主 pending row
  const deduped = [];
  let dedupCount = 0;
  const now = new Date().toISOString();

  for (const p of allPending) {
    const key = shipDedupKey(p);
    if (!key) { deduped.push(p); continue; }  // 无任何字段不参与去重
    if (!seen.has(key)) {
      seen.set(key, p);
      deduped.push(p);
    } else {
      // 重定向副本：标记 exported_dedup + 指向主查询
      const main = seen.get(key);
      run(
        "UPDATE pending_queries SET status='exported_dedup', main_pending_id=?, exported_at=? WHERE id=?",
        [main.id, now, p.id],
      );
      dedupCount++;
    }
  }
  return { mainRows: deduped, dedupCount };
}

// 主查询被解析入库后，把指向它的重定向副本同步 ship_id 并置 interpreted
function linkDedupCopies(mainPendingId, shipId) {
  if (!mainPendingId) return 0;
  const copies = all(
    "SELECT id FROM pending_queries WHERE main_pending_id=? AND status='exported_dedup'",
    [mainPendingId],
  );
  if (!copies.length) return 0;
  const now = new Date().toISOString();
  for (const c of copies) {
    run(
      "UPDATE pending_queries SET status='interpreted', ship_id=?, result_at=?, result_file='(由主查询复用)' WHERE id=?",
      [shipId, now, c.id],
    );
  }
  return copies.length;
}

// ====================== 待查询汇总上传 ======================

// 按机构汇总未导出的待查询，生成合规文件上传 S3（自动/手动触发共用）
// v1.3b：可选传入 rows（已去重的主查询列表），避免重复查询
// v1.3f：汇总逻辑改为"全机构汇总成总公司单文件"——所有分公司/中支/总公司的待查询
//        去重后合并到一个文件，文件名以总公司 display_name 命名上传（exportPendingAll 调用）
//        org 参数语义=总公司 org；无 rows 时仅导出 org 自身的 pending（保留兼容）
export async function exportPendingForOrg(org, date = dateStr(), rows = null) {
  const started = new Date().toISOString();
  ensureReady();
  const displayName = orgDisplayName(org);
  const pending = rows || all("SELECT * FROM pending_queries WHERE org=? AND status='pending' ORDER BY id", [org]);
  if (!pending.length) return { org, skipped: true, message: '该机构当前没有待提交的查询' };

  const rowsData = pending.map((p) => ({
    ship_id_no: p.ship_id_no, imo_no: p.imo_no, name_cn: p.name_cn, name_en: p.name_en,
  }));

  // 生成合规文件（Sheet「A01入参」六列 + 序号自增 + 查询服务编号）
  const buf = await buildShipQueryExcel(rowsData);
  const fileName = buildQueryFileName(displayName, new Date(date + 'T00:00:00Z'));

  // 三重校验之一：命名正则（表头由生成函数固定保证；路径为约定 upload/ 前缀）
  if (!isValidQueryFileName(fileName)) {
    logTask('export', org, fileName, 'error', `文件名校验失败: ${fileName}`, started);
    throw new Error(`生成的文件名不符合中银保信规范: ${fileName}`);
  }

  const key = UPLOAD_PREFIX + fileName;
  await putObject(key, buf, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

  const now = new Date().toISOString();
  for (const p of pending) {
    run('UPDATE pending_queries SET status=?, exported_at=?, export_key=? WHERE id=?',
      ['exported', now, key, p.id]);
  }
  logTask('export', org, key, 'ok', `汇总 ${rowsData.length} 条待查询，生成并上传 ${fileName}`, started);
  persist();
  return { org, fileName, key, count: rowsData.length };
}

// 全部机构手动导出（管理员手动触发 / cron 全局自动上传）
// v1.3b：汇总前先 dedupPending()，同船只查询一次（每条返回 4 元成本）
// v1.3f：所有分公司/中支/总公司的待查询去重后汇总成**一个总公司查询文件**上传
//        （文件名以总公司 display_name 命名）；不再按分公司分组生成多个文件
export async function exportPendingAll(date = dateStr()) {
  const started = new Date().toISOString();
  const { mainRows, dedupCount } = dedupPending();
  if (dedupCount > 0) {
    logTask('dedup', '', '', 'ok', `汇总前去重：合并 ${dedupCount} 条跨机构/同机构重复查询（每条节省 4 元查询成本）`, started);
  }
  const hq = hqOrg();
  const files = [];
  const failed = [];
  if (!mainRows.length) {
    return { date, files, failed, dedupCount, org: hq };
  }
  try {
    const r = await exportPendingForOrg(hq, date, mainRows);
    if (!r.skipped) files.push(r);
  } catch (e) {
    logTask('export', hq, '', 'error', e.message);
    failed.push({ org: hq, error: e.message });
  }
  return { date, files, failed, dedupCount, org: hq };
}

// ====================== 结果文件轮询导入 ======================

// 按船舶四要素查找/创建全量库船舶记录，返回 ship_id
function upsertShip(conditions, orgFromFileName) {
  const c = {
    ship_id_no: (conditions.ship_id_no || '').trim(),
    imo_no: (conditions.imo_no || '').trim(),
    name_cn: (conditions.name_cn || '').trim(),
    name_en: (conditions.name_en || '').trim(),
  };
  let existing = null;
  if (c.ship_id_no) existing = get('SELECT * FROM ships WHERE ship_id_no=?', [c.ship_id_no]);
  if (!existing && c.imo_no) existing = get('SELECT * FROM ships WHERE imo_no=? AND imo_no!=""', [c.imo_no]);
  if (!existing && c.name_cn) existing = get('SELECT * FROM ships WHERE name_cn=?', [c.name_cn]);
  if (!existing && c.name_en) existing = get('SELECT * FROM ships WHERE name_en=?', [c.name_en]);

  const now = new Date().toISOString();
  if (existing) {
    run('UPDATE ships SET ship_id_no=?, imo_no=?, name_cn=?, name_en=?, last_query_time=? WHERE id=?', [
      c.ship_id_no || existing.ship_id_no, c.imo_no || existing.imo_no,
      c.name_cn || existing.name_cn, c.name_en || existing.name_en,
      now, existing.id,
    ]);
    return existing.id;
  }
  return runReturnId(
    `INSERT INTO ships (ship_id_no, imo_no, name_cn, name_en, first_queried_org, first_queried_at, last_query_time, created_at)
     VALUES (?,?,?,?,?,?,?,?)`,
    [c.ship_id_no, c.imo_no, c.name_cn, c.name_en, orgFromFileName || '', now, now, now],
  );
}

// 匹配待查询记录（用户填写的字段须与结果行一致；结果文件可能补齐留空字段）
// v1.3e：原按机构家族匹配；v1.3f：改为全局匹配——总公司单文件回填，dedupPending 已保证
//        同船仅一条主查询（其余为 exported_dedup 副本由 linkDedupCopies 统一回填）
function findPending(c) {
  const candidates = all("SELECT * FROM pending_queries WHERE status IN ('pending','exported')");
  const fields = ['ship_id_no', 'imo_no', 'name_cn', 'name_en'];
  for (const p of candidates) {
    let match = true;
    for (const f of fields) {
      const pv = (p[f] || '').trim();
      if (pv && (c[f] || '').trim() !== pv) { match = false; break; }
    }
    if (match) return p;
  }
  return null;
}

// 解析并入库单个结果文件内容（独立于 S3，便于测试）
export async function processResultBuffer(org, buffer, sourceKey = 'test.xlsx') {
  const started = new Date().toISOString();
  const parsed = await parseShipResultExcel(buffer);
  if (parsed.format !== 'ship') {
    return { format: parsed.format, ships: 0, policies: 0, pending: 0 };
  }
  let shipCount = 0;
  let pendingCount = 0;
  const now = new Date().toISOString();
  for (const item of parsed.ships) {
    const shipId = upsertShip(item.conditions, org);
    shipCount++;
    // 同船新结果：先删旧险种记录再插入（增量覆盖更新）
    run('DELETE FROM ship_policy_results WHERE ship_id=?', [shipId]);
    for (const p of item.policies) {
      run(
        `INSERT INTO ship_policy_results
         (ship_id, insurance_subtype, loss_ratio_paid, loss_ratio_total, accident_causes, claim_amounts,
          claim_ranges, early_ratio_1m, early_ratio_2m, early_ratio_3m, insurer_count_3y,
          latest_insurer_code, avg_amount_premium, raw_json, result_file, returned_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          shipId, p.insurance_subtype,
          p.loss_ratio_paid ? JSON.stringify(p.loss_ratio_paid) : '',
          p.loss_ratio_total ? JSON.stringify(p.loss_ratio_total) : '',
          p.accident_causes ? JSON.stringify(p.accident_causes) : '',
          p.claim_amounts ? JSON.stringify(p.claim_amounts) : '',
          p.claim_ranges ? JSON.stringify(p.claim_ranges) : '',
          p.early_ratio_1m ? JSON.stringify(p.early_ratio_1m) : '',
          p.early_ratio_2m ? JSON.stringify(p.early_ratio_2m) : '',
          p.early_ratio_3m ? JSON.stringify(p.early_ratio_3m) : '',
          p.insurer_count_3y,
          p.latest_insurer_code,
          p.avg_amount_premium ? JSON.stringify(p.avg_amount_premium) : '',
          JSON.stringify(p.raw || {}),
          sourceKey, now,
        ],
      );
    }
    // 关联待查询 → returned（v1.3f：全局匹配，覆盖所有提交过该船的机构）
    const pend = findPending(item.conditions);
    if (pend) {
      run('UPDATE pending_queries SET status=?, ship_id=?, result_file=?, result_at=? WHERE id=?',
        ['returned', shipId, sourceKey, now, pend.id]);
      pendingCount++;
      // v1.3b：把指向这条主查询的重定向副本绑定 ship_id 并置 interpreted
      const linkCount = linkDedupCopies(pend.id, shipId);
      if (linkCount > 0) {
        logTask('dedup', org, sourceKey, 'ok', `船舶 ${shipId} 返回，回填 ${linkCount} 条跨机构重定向副本`, started);
      }
    }
    // 触发 AI 解读 → interpreted
    try {
      await runInterpretForShip(shipId);
      if (pend) run("UPDATE pending_queries SET status='interpreted' WHERE id=?", [pend.id]);
    } catch (e) {
      logTask('interpret', org, sourceKey, 'error', `船舶 ${shipId} 解读失败: ${e.message}`);
    }
  }
  persist();
  return { format: 'ship', ships: shipCount, policies: parsed.ships.reduce((a, s) => a + s.policies.length, 0), pending: pendingCount };
}

// 全量扫描 download/ 的 _result 文件并导入（不传 date 时处理全部未处理文件，支持 T+2 补扫）
export async function importResults(date = null) {
  const started = new Date().toISOString();
  ensureReady();
  const { files } = await listObjects(RESULT_PREFIX);

  // 宽匹配结果文件（容错：_RESULT 大写、空格等由 parseResultFileName 归一化）
  const resultFiles = (files || []).filter((f) => /_result\s*\.xlsx$/i.test(f.name) || /_result\.xlsx$/i.test(f.name));
  if (!resultFiles.length) {
    return { matched: 0, imported: [], skipped: [], failed: [] };
  }

  const imported = [];
  const skipped = [];
  const failed = [];

  for (const f of resultFiles) {
    // 文件名解析（容错）
    const fn = parseResultFileName(f.name);
    if (!fn.ok) {
      skipped.push({ key: f.key, reason: fn.reason });
      continue;
    }
    // 企业格式（A01 旧测试数据）：跳过
    if (fn.service === 'A01') {
      skipped.push({ key: f.key, reason: '企业格式（A01）旧数据，不在船舶查询处理范围' });
      continue;
    }
    // 日期过滤（可选）
    if (date && fn.date !== date.replace(/-/g, '')) continue;

    // 去重：已处理过的文件跳过
    const done = get('SELECT key FROM processed_results WHERE key=?', [f.key]);
    if (done) {
      skipped.push({ key: f.key, reason: '该文件已导入过（去重）' });
      continue;
    }

    // 下载并导入；单文件失败跳过，不阻塞其他机构
    const fileStart = new Date().toISOString();
    try {
      const obj = await getObject(f.key);
      let buf;
      if (obj.stream) buf = await streamToBuffer(obj.stream);
      else buf = Buffer.from(await obj.rawBody.transformToByteArray());

      const org = orgByDisplayName(fn.orgName);
      const r = await processResultBuffer(org, buf, f.key);
      run('INSERT OR IGNORE INTO processed_results (key, processed_at, org, records, pending) VALUES (?,?,?,?,?)',
        [f.key, new Date().toISOString(), org, r.ships, r.pending]);
      logTask('import', org, f.key, 'ok', `导入 ${r.ships} 船 / ${r.policies} 险种记录 / 关联待查询 ${r.pending} 条`, fileStart);
      imported.push({ key: f.key, org, ...r });
    } catch (e) {
      logTask('import', fn.orgName, f.key, 'error', e.message, fileStart);
      failed.push({ key: f.key, error: e.message });
    }
  }
  persist();
  return { matched: resultFiles.length, imported, skipped, failed };
}

// ====================== 模拟中银保信返回结果（v1.3d 演示用） ======================

// 模拟中银保信 T+1 返回：读取 upload/ 已上传的待查询文件 → 解析船舶四要素
//   → 生成模拟 result 文件（18 列，5 种风险场景模板）→ 放入 download/
// 用于决赛演示：免内网依赖，点击即可模拟 T+1 返回并触发后续导入+解读
//
// 参数：
//   date?: YYYY-MM-DD，只处理该日期上传的文件；不传则处理 upload/ 全部
//   autoImport?: 生成后是否自动执行 importResults 导入+解读（默认 true）
export async function simulateReturn(date = null) {
  const started = new Date().toISOString();
  ensureReady();
  const { files } = await listObjects(UPLOAD_PREFIX);
  // 只处理合规命名的待查询文件（船舶_000012_YYYYMMDD_分公司.xlsx）
  const queryFiles = (files || []).filter((f) => {
    const base = String(f.name || '').split('/').pop();
    if (!isValidQueryFileName(base)) return false;
    if (date) {
      const m = base.match(/_(\d{8})_/);
      if (m && m[1] !== date.replace(/-/g, '')) return false;
    }
    return true;
  });
  if (!queryFiles.length) {
    return { matched: 0, generated: [], message: 'upload/ 目录没有可处理的待查询文件' };
  }

  const generated = [];
  const failed = [];
  for (const f of queryFiles) {
    const fileStart = new Date().toISOString();
    try {
      // 下载待查询文件
      const obj = await getObject(f.key);
      let buf;
      if (obj.stream) buf = await streamToBuffer(obj.stream);
      else buf = Buffer.from(await obj.rawBody.transformToByteArray());

      // 解析船舶四要素
      const ships = await parseShipQueryExcel(buf);
      if (!ships.length) {
        failed.push({ key: f.key, reason: '文件中未解析到船舶数据' });
        continue;
      }

      // 生成模拟 result 文件
      const resultBuf = await buildShipResultExcel(ships);
      // 结果文件名：原文件名去掉 .xlsx 追加 _result.xlsx
      const baseName = String(f.name || '').split('/').pop().replace(/\.xlsx$/i, '');
      const resultName = baseName + '_result.xlsx';
      const resultKey = RESULT_PREFIX + resultName;
      await putObject(resultKey, resultBuf, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

      // 从文件名提取机构
      const fn = parseResultFileName(resultName);
      const org = fn.ok ? orgByDisplayName(fn.orgName) : '';

      logTask('simulate_return', org, resultKey, 'ok',
        `模拟中银保信返回：${ships.length} 艘船 → ${resultName}（含 ${ships.length * 3} 条险种记录）`, fileStart);
      generated.push({ key: resultKey, org, shipCount: ships.length, fileName: resultName });
    } catch (e) {
      logTask('simulate_return', '', f.key, 'error', e.message, fileStart);
      failed.push({ key: f.key, error: e.message });
    }
  }

  logTask('simulate_return', '', '', 'ok',
    `模拟返回完成：处理 ${queryFiles.length} 个待查询文件，生成 ${generated.length} 个结果文件`, started);

  // 自动导入+解读
  let importResult = null;
  if (generated.length > 0) {
    try {
      importResult = await importResults(date);
    } catch (e) {
      logTask('simulate_return', '', '', 'error', `自动导入失败: ${e.message}`, started);
    }
  }

  persist();
  return { matched: queryFiles.length, generated, failed, importResult };
}
