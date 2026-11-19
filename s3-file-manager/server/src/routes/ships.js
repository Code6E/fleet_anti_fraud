// 船舶险反欺诈查询路由（v3.1 三级账号）
// - 三段式查询：全量库命中弹窗确认（v1.4d：提示已查询时间，可选使用旧数据或重新查询）/ 未命中录入本机构待查询队列
// - 三级账号数据隔离：分公司可见本分公司+所属中支；中支仅可见本中支；管理员全局
//   （船舶风险数据为全量共享层，任何机构查询命中即可查看）
// - 管理员：全局列表、手动触发、机构配置、Agent 日志与统计
import express from 'express';
import { all, get, run, runReturnId } from '../db.js';
import { exportPendingAll, importResults, simulateReturn } from '../scheduler.js';
import { getAgentEnabled, setAgentEnabled, getUploadConfig, setUploadConfig } from '../cron.js';
import { loadRules, runInterpretForShip } from '../interpret.js';
import { buildReportPdf } from '../report-pdf.js';
import { buildShipDataExcel } from '../excel.js';
import { adminOnly, visibleOrgs } from '../auth.js';
import { fetchShipProfile, anlanEnabled } from '../anlan.js';

const router = express.Router();

// 机构范围 SQL 片段：admin 返回 null（不过滤）；否则生成 `col IN (?,?,...)`
function orgScope(user, col = 'org') {
  const orgs = visibleOrgs(user);
  if (!orgs) return null;
  return { sql: `${col} IN (${orgs.map(() => '?').join(',')})`, params: orgs };
}

function normalize(body = {}) {
  const trim = (v) => (typeof v === 'string' ? v.trim() : (v == null ? '' : String(v)));
  return {
    ship_id_no: trim(body.ship_id_no),
    imo_no: trim(body.imo_no),
    name_cn: trim(body.name_cn),
    name_en: trim(body.name_en),
  };
}

function shipDetail(shipId) {
  const ship = get('SELECT * FROM ships WHERE id=?', [shipId]);
  if (!ship) return null;
  const policies = all('SELECT * FROM ship_policy_results WHERE ship_id=? ORDER BY id', [shipId])
    .map((p) => ({
      insurance_subtype: p.insurance_subtype,
      loss_ratio_paid: p.loss_ratio_paid ? JSON.parse(p.loss_ratio_paid) : null,
      loss_ratio_total: p.loss_ratio_total ? JSON.parse(p.loss_ratio_total) : null,
      accident_causes: p.accident_causes ? JSON.parse(p.accident_causes) : null,
      claim_amounts: p.claim_amounts ? JSON.parse(p.claim_amounts) : null,
      claim_ranges: p.claim_ranges ? JSON.parse(p.claim_ranges) : null,
      early_ratio_1m: p.early_ratio_1m ? JSON.parse(p.early_ratio_1m) : null,
      early_ratio_2m: p.early_ratio_2m ? JSON.parse(p.early_ratio_2m) : null,
      early_ratio_3m: p.early_ratio_3m ? JSON.parse(p.early_ratio_3m) : null,
      insurer_count_3y: p.insurer_count_3y,
      latest_insurer_code: p.latest_insurer_code,
      avg_amount_premium: p.avg_amount_premium ? JSON.parse(p.avg_amount_premium) : null,
      returned_at: p.returned_at,
    }));
  const report = get('SELECT * FROM ai_reports WHERE ship_id=? ORDER BY id DESC LIMIT 1', [shipId]);
  const profile = get('SELECT * FROM ship_profiles WHERE ship_id=?', [shipId]);
  return {
    ship,
    policies,
    profile: profile || null,
    report: report ? {
      risk_level: report.risk_level,
      rule_hits: report.rule_hits_json ? JSON.parse(report.rule_hits_json) : [],
      report_md: report.report_md,
      model: report.model,
      generated_at: report.generated_at,
    } : null,
  };
}

// 全量库按四要素查找（提供的字段间为 AND；任一必填）
function findShips(c) {
  const clauses = [];
  const params = [];
  if (c.ship_id_no) { clauses.push('ship_id_no = ?'); params.push(c.ship_id_no); }
  if (c.imo_no) { clauses.push('imo_no = ?'); params.push(c.imo_no); }
  if (c.name_cn) { clauses.push('name_cn = ?'); params.push(c.name_cn); }
  if (c.name_en) { clauses.push('name_en = ?'); params.push(c.name_en); }
  if (!clauses.length) return [];
  return all(`SELECT * FROM ships WHERE ${clauses.join(' AND ')} ORDER BY id DESC LIMIT 20`, params);
}

// 记录本机构查询行为（hit 去重：同机构同船当日已有 hit 记录则不重复插）
function recordHit(org, by, shipId, hitType) {
  const today = new Date().toISOString().slice(0, 10);
  const dup = get(
    "SELECT id FROM pending_queries WHERE org=? AND ship_id=? AND status='hit' AND created_at LIKE ?",
    [org, shipId, today + '%'],
  );
  if (dup) return;
  runReturnId(
    `INSERT INTO pending_queries (org, requested_by, ship_id, status, hit_type, created_at)
     VALUES (?,?,?,'hit',?,?)`,
    [org, by, shipId, hitType, new Date().toISOString()],
  );
}

// ---- 1) 三段式查询 ----
// v1.4d：命中全量库不再直接返回并自动记 hit——先返回命中信息由前端弹窗确认
// 「使用旧数据」（POST /hit 记录命中行为）或「重新查询」（POST /pending 入队）
router.post('/query', (req, res) => {
  const c = normalize(req.body);
  if (!c.ship_id_no && !c.imo_no && !c.name_cn && !c.name_en) {
    return res.status(400).json({ status: 'error', message: '请至少填写一项查询条件（船舶识别号 / IMO号 / 船舶中文名称 / 船舶英文名称）' });
  }

  const results = findShips(c);
  if (results.length) {
    const ttlDays = loadRules().ttl_days || 90;
    const details = results.map((s) => {
      const last = s.last_query_time ? new Date(s.last_query_time) : null;
      const ageDays = last ? Math.floor((Date.now() - last.getTime()) / 86400000) : null;
      const expired = ageDays == null || ageDays > ttlDays;
      return { ...shipDetail(s.id), expired, age_days: ageDays, ttl_days: ttlDays };
    });
    const anyExpired = details.some((d) => d.expired);
    const lastTime = results
      .map((s) => s.last_query_time)
      .filter(Boolean)
      .sort()
      .pop();
    return res.json({
      status: 'ok', found: true, expired: anyExpired,
      last_query_time: lastTime || null,
      message: anyExpired
        ? `命中全量库 ${results.length} 条记录，但数据已超过 ${ttlDays} 天有效期，建议重新发起查询以获取最新数据`
        : `命中全量库 ${results.length} 条记录，该船舶已于 ${lastTime || '未知时间'} 查询过，在有效期内可直接复用（免 T+1）`,
      results: details,
    });
  }

  return res.json({
    status: 'ok', found: false, conditions: c,
    message: '全量库未找到该船舶。可确认向中银保信发起查询，查询结果将于次日（T+1）返回。',
  });
});

// ---- 1.2) 全量库未命中时调用智能航运风控平台（船讯网）船舶档案 ----
// 供前端弹出对话框展示四要素、人工确认是否回填到查询窗口（v1.8）
router.post('/profile', async (req, res) => {
  const c = normalize(req.body);
  if (!c.ship_id_no && !c.imo_no && !c.name_cn && !c.name_en) {
    return res.status(400).json({ status: 'error', message: '请至少填写一项查询条件' });
  }
  if (!anlanEnabled()) {
    return res.json({ status: 'ok', found: false, message: '智能航运风控平台未配置（缺少账号），无法获取船舶档案' });
  }
  try {
    const p = await fetchShipProfile(c);
    if (!p) {
      return res.json({ status: 'ok', found: false, message: '智能航运风控平台未查询到该船舶档案' });
    }
    // 仅回填四要素（船舶识别号/IMO号/中英文名），其余档案字段供展示参考
    // 平台无 IMO 时回传占位 "0"，视为空不回填
    const clean = (v) => { const s = String(v == null ? '' : v).trim(); return s === '0' ? '' : s; };
    const profile = {
      ship_id_no: p.regist_number || '',
      imo_no: clean(p.imo_no),
      name_cn: p.name_cn || '',
      name_en: p.name_en || '',
    };
    return res.json({
      status: 'ok', found: true, profile,
      extra: { ship_type: p.ship_type || '', gt: p.gt || '', ship_age: p.ship_age, mmsi: p.mmsi || '' },
    });
  } catch (e) {
    return res.json({ status: 'ok', found: false, message: `获取船舶档案失败：${e.message}` });
  }
});

// ---- 1.5) 命中全量库确认使用旧数据：记录本机构命中行为（v1.4d） ----
router.post('/hit', (req, res) => {
  const shipId = Number(req.body && req.body.ship_id);
  if (!shipId) {
    return res.status(400).json({ status: 'error', message: '缺少 ship_id' });
  }
  const ship = get('SELECT * FROM ships WHERE id=?', [shipId]);
  if (!ship) {
    return res.status(404).json({ status: 'error', message: '船舶不存在或已删除' });
  }
  const ttlDays = loadRules().ttl_days || 90;
  const last = ship.last_query_time ? new Date(ship.last_query_time) : null;
  const ageDays = last ? Math.floor((Date.now() - last.getTime()) / 86400000) : null;
  const expired = ageDays == null || ageDays > ttlDays;
  recordHit(req.user.org, req.user.username, shipId, expired ? 'expired_hit' : 'full_hit');
  return res.json({ status: 'ok', hit_type: expired ? 'expired_hit' : 'full_hit', last_query_time: ship.last_query_time });
});

// ---- 2) 确认新查询：录入本机构待查询队列 ----
router.post('/pending', (req, res) => {
  const c = normalize(req.body);
  if (!c.ship_id_no && !c.imo_no && !c.name_cn && !c.name_en) {
    return res.status(400).json({ status: 'error', message: '请至少填写一项查询条件' });
  }
  const org = req.user.org;
  const by = req.user.username;
  const existing = get(
    `SELECT id FROM pending_queries
     WHERE org=? AND status IN ('pending','exported')
       AND COALESCE(ship_id_no,'')=? AND COALESCE(imo_no,'')=?
       AND COALESCE(name_cn,'')=? AND COALESCE(name_en,'')=?`,
    [org, c.ship_id_no, c.imo_no, c.name_cn, c.name_en],
  );
  if (existing) {
    return res.json({ status: 'ok', id: existing.id, duplicated: true, message: '该船舶已在待查询队列中，无需重复提交' });
  }
  const id = runReturnId(
    `INSERT INTO pending_queries (org, requested_by, ship_id_no, imo_no, name_cn, name_en, status, created_at)
     VALUES (?,?,?,?,?,?,'pending',?)`,
    [org, by, c.ship_id_no, c.imo_no, c.name_cn, c.name_en, new Date().toISOString()],
  );
  // v1.3b：上传配置由管理员全局统一设置（manual / auto + UPLOAD_TIME）
  // v1.3f：所有机构查询统一汇总成总公司单文件上传（去重后一个文件）
  const cfg = getUploadConfig();
  const when = cfg.upload_mode === 'auto'
    ? `将于今日 ${cfg.upload_time} 自动汇总上传（全局配置）`
    : '将由管理员手动触发统一上传';
  const mergeNote = req.user.role !== 'admin'
    ? '（将随总公司汇总文件统一上传）'
    : '';
  return res.json({ status: 'ok', id, org, message: `已加入待查询队列（机构：${org}）${mergeNote}，${when}，中银保信 T+1 返回结果` });
});

// ---- 3) 我的查询列表（三级隔离：分公司=本分公司+所属中支；中支=本中支；admin 全量） ----
// days 参数：仅展示近 N 天记录（前端默认传 7；不传则不过滤时间，全量展示）
// v1.5a：新增 business/fraud 双维度等级筛选（高/中/低 多选，逗号分隔；两参数与其他条件 AND）
router.get('/pending', (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status : null;
  const days = req.query.days ? parseInt(req.query.days, 10) : null;
  // 命中全量库的记录仅存 ship_id（四要素列为空），需从关联 ships 回填船舶标识以便「我的查询」一眼看出是哪条船（v1.9）
  // eff_* 优先取本条查询入参（pending/exported/returned 记录），入参为空时回退到关联船舶的档案字段
  const base = `SELECT pq.*, s.latest_risk_level, s.latest_risk_types, s.last_query_time AS ship_last_query_time,
                       COALESCE(NULLIF(pq.name_cn,''), s.name_cn)        AS eff_name_cn,
                       COALESCE(NULLIF(pq.name_en,''), s.name_en)        AS eff_name_en,
                       COALESCE(NULLIF(pq.ship_id_no,''), s.ship_id_no)  AS eff_ship_id_no,
                       COALESCE(NULLIF(pq.imo_no,''), s.imo_no)          AS eff_imo_no
                FROM pending_queries pq LEFT JOIN ships s ON pq.ship_id = s.id`;
  let sql;
  const params = [];
  const conds = [];
  const scope = orgScope(req.user, 'pq.org');
  if (scope) { conds.push(scope.sql); params.push(...scope.params); }
  if (status) { conds.push('pq.status=?'); params.push(status); }
  if (days > 0) {
    conds.push('pq.created_at >= ?');
    params.push(new Date(Date.now() - days * 86400000).toISOString());
  }
  dimLevelConds(req.query.business, '业务品质风险', 's.latest_risk_types', 's.latest_risk_level', conds, params);
  dimLevelConds(req.query.fraud, '欺诈风险', 's.latest_risk_types', 's.latest_risk_level', conds, params);
  sql = conds.length ? `${base} WHERE ${conds.join(' AND ')}` : base;
  const rows = all(sql + ' ORDER BY pq.id DESC LIMIT 500', params);
  res.json({ status: 'ok', rows });
});

// ---- 4) 船舶列表（admin：全量库；分公司：本分公司+中支查询行为关联的船舶；中支：本中支） ----
// v1.3i 列筛选：船舶/识别号/IMO/首次查询机构输入模糊匹配，数据更新时间范围
// v1.5 风险筛选改为双维度 7 标签：「低风险」按等级匹配，6 个维度标签（业务品质风险·高/中/低、欺诈风险·高/中/低）按 latest_risk_types JSON 元素精确匹配（LIKE "\"标签\"" 带引号避免子串误命中）
// v1.7 新增「无数据」（整船双无数据、无投保记录，latest_risk_level='none'）与维度·无数据标签
const RISK_FILTER_VALUES = ['低风险', '无数据', '业务品质风险·高', '业务品质风险·中', '业务品质风险·低', '业务品质风险·无数据', '欺诈风险·高', '欺诈风险·中', '欺诈风险·低', '欺诈风险·无数据'];

// v1.5a：双维度等级筛选条件构造（列表风险列拆为业务品质/欺诈两列后，各自支持高/中/低多选；v1.7 增无数据）
// queryVal：逗号分隔的 high/medium/low/none（白名单过滤非法值）；prefix：维度标签前缀（业务品质风险/欺诈风险）
// 「高/中/无数据」按 latest_risk_types LIKE 精确匹配维度标签；「低」额外命中 latest_risk_level='low' 的双低船（此类船标签为「低风险」无维度标签）
// colTypes/colLevel 由调用方传入（/pending 为 JOIN 列需带 s. 前缀，/ 为裸列）
const DIM_LEVEL_TEXT = { high: '高', medium: '中', low: '低', none: '无数据' };
function dimLevelConds(queryVal, prefix, colTypes, colLevel, conds, params) {
  const levels = String(queryVal || '').split(',').map((s) => s.trim()).filter((l) => DIM_LEVEL_TEXT[l]);
  if (!levels.length) return;
  const parts = [];
  for (const lv of levels) {
    if (lv === 'low') {
      parts.push(`(${colTypes} LIKE ? OR ${colLevel}='low')`);
      params.push(`%"${prefix}·低"%`);
    } else if (lv === 'none') {
      // 该维度·无数据标签 + 整船精确「无数据」标签（双无数据船无维度标签）；
      // 不用 colLevel='none'——混合船（一维度低/中 + 一维度无数据）整船等级也为 none，会误命中
      parts.push(`(${colTypes} LIKE ? OR ${colTypes} LIKE ?)`);
      params.push(`%"${prefix}·无数据"%`, `%"无数据"%`);
    } else {
      parts.push(`${colTypes} LIKE ?`);
      params.push(`%"${prefix}·${DIM_LEVEL_TEXT[lv]}"%`);
    }
  }
  conds.push(`(${parts.join(' OR ')})`);
}

// v1.5：船舶库各风险标签船舶数统计（双维度体系；「低风险」按等级，其余按 latest_risk_types JSON 元素精确匹配；
// v1.7「无数据」按等级 none + 标签「无数据」双口径；一船可同时命中「业务品质风险·X」与「欺诈风险·Y」两个标签，各项之和不等于总数；countFn(whereSql, params) 由调用方适配是否带机构范围）
function riskTypeStats(countFn) {
  const out = {};
  for (const t of RISK_FILTER_VALUES) {
    if (t === '低风险') {
      out[t] = countFn("latest_risk_level='low'", []);
    } else if (t === '无数据') {
      // 纯双无数据（整行 null，无投保记录）按精确「无数据」标签；混合船（一维度低/中+一维度无数据）
      // 不算整船无数据，其无数据维度由「X风险·无数据」标签体现
      out[t] = countFn("latest_risk_types LIKE '%\"无数据\"%'", []);
    } else {
      out[t] = countFn('latest_risk_types LIKE ?', [`%"${t}"%`]);
    }
  }
  return out;
}

router.get('/', (req, res) => {
  const conds = [];
  const params = [];
  const like = (cols, val) => {
    if (!val) return;
    conds.push(cols.length === 1 ? `${cols[0]} LIKE ?` : `(${cols.map((c) => `${c} LIKE ?`).join(' OR ')})`);
    for (const c of cols) params.push(`%${val}%`);
  };
  like(['name_cn', 'name_en'], String(req.query.name || '').trim());
  like(['ship_id_no'], String(req.query.ship_id_no || '').trim());
  like(['imo_no'], String(req.query.imo_no || '').trim());
  like(['first_queried_org'], String(req.query.org || '').trim());
  // 风险筛选多选（逗号分隔，白名单过滤非法值；低风险按等级、无数据按等级+标签、风险类型按 latest_risk_types）
  const risks = String(req.query.risk || '').split(',').map((s) => s.trim()).filter((r) => RISK_FILTER_VALUES.includes(r));
  if (risks.length) {
    const parts = [];
    for (const r of risks) {
      if (r === '低风险') {
        parts.push("latest_risk_level='low'");
      } else if (r === '无数据') {
        // 纯双无数据船（整行 null，无投保记录）按精确「无数据」标签；混合船由维度·无数据标签匹配
        parts.push("latest_risk_types LIKE '%\"无数据\"%'");
      } else {
        parts.push('latest_risk_types LIKE ?');
        params.push(`%"${r}"%`);
      }
    }
    conds.push(`(${parts.join(' OR ')})`);
  }
  // v1.5a：双维度等级筛选（业务品质/欺诈各选高/中/低，与上述条件 AND 组合）
  dimLevelConds(req.query.business, '业务品质风险', 'latest_risk_types', 'latest_risk_level', conds, params);
  dimLevelConds(req.query.fraud, '欺诈风险', 'latest_risk_types', 'latest_risk_level', conds, params);
  // 数据更新时间范围（last_query_time 为 ISO 字符串，按日期前缀比较）
  const dateFrom = String(req.query.date_from || '').trim();
  const dateTo = String(req.query.date_to || '').trim();
  if (dateFrom) { conds.push('last_query_time >= ?'); params.push(dateFrom); }
  if (dateTo) { conds.push("substr(COALESCE(last_query_time,''),1,10) <= ?"); params.push(dateTo); }

  const scope = orgScope(req.user);
  let sql;
  let sqlParams;
  if (!scope) {
    sql = conds.length ? `SELECT * FROM ships WHERE ${conds.join(' AND ')}` : 'SELECT * FROM ships';
    sqlParams = params;
  } else {
    const allConds = [`id IN (SELECT DISTINCT ship_id FROM pending_queries WHERE ${scope.sql} AND ship_id IS NOT NULL)`, ...conds];
    sql = `SELECT DISTINCT * FROM ships WHERE ${allConds.join(' AND ')}`;
    sqlParams = [...scope.params, ...params];
  }
  const rows = all(sql + ' ORDER BY id DESC LIMIT 500', sqlParams);
  res.json({ status: 'ok', rows });
});

// ---- 4.5) 运行概览（分公司/中支账号：本机构范围内统计；admin 复用 admin/stats） ----
router.get('/overview', (req, res) => {
  const scope = orgScope(req.user);
  const orgCond = scope ? scope.sql : '1=1';
  const orgParams = scope ? scope.params : [];
  const shipScope = scope
    ? `id IN (SELECT DISTINCT ship_id FROM pending_queries WHERE ${orgCond} AND ship_id IS NOT NULL)`
    : '1=1';
  const shipParams = scope ? [...orgParams] : [];
  const stat = (sql, params = []) => (all(sql, params)[0] || {}).n || 0;
  const today = new Date().toISOString().slice(0, 10);
  const cfg = getUploadConfig();
  const stats = {
    total: stat(`SELECT COUNT(*) AS n FROM pending_queries WHERE ${orgCond}`, orgParams),
    pending: stat(`SELECT COUNT(*) AS n FROM pending_queries WHERE ${orgCond} AND status IN ('pending','exported')`, orgParams),
    today: stat(`SELECT COUNT(*) AS n FROM pending_queries WHERE ${orgCond} AND created_at LIKE ?`, [...orgParams, today + '%']),
    // v1.4e：命中复用改为只统计近半年内重复查询的船舶（按 ship_id 去重，口径与 GET /hit-reuse 一致）
    hit: stat(`SELECT COUNT(DISTINCT ship_id) AS n FROM pending_queries WHERE ${orgCond} AND status='hit' AND ship_id IS NOT NULL AND created_at >= datetime('now', '-180 days')`, orgParams),
    returned: stat(`SELECT COUNT(*) AS n FROM pending_queries WHERE ${orgCond} AND status IN ('returned','interpreted')`, orgParams),
    // v1.4c：高风险统计替换为各风险类型船舶数（本机构范围关联船舶）
    riskTypes: riskTypeStats((w, p) => stat(`SELECT COUNT(*) AS n FROM ships WHERE ${shipScope} AND ${w}`, [...shipParams, ...p])),
  };
  res.json({
    status: 'ok',
    role: req.user.role,
    org: req.user.org,
    parent_org: req.user.parent_org || '',
    scope_orgs: scope ? scope.params : 'all',
    stats,
    upload_mode: cfg.upload_mode,
    upload_time: cfg.upload_time,
  });
});

// ---- 4.6) 命中复用明细（v1.4e：近半年内命中复用的船舶 + 各船舶历史被哪些机构查询过） ----
// 权限：机构账号仅统计本机构范围内的复用行为；船舶的「查询过的机构」为全量库共享层信息（机构维度聚合，不暴露具体查询人）
router.get('/hit-reuse', (req, res) => {
  const days = Math.min(Math.max(Number(req.query.days) || 180, 1), 365);
  const scope = orgScope(req.user, 'pq.org');
  const orgCond = scope ? scope.sql : '1=1';
  const orgParams = scope ? scope.params : [];
  const rows = all(
    `SELECT pq.ship_id AS id, COUNT(*) AS hit_count, MAX(pq.created_at) AS last_hit_time
     FROM pending_queries pq
     WHERE pq.status='hit' AND pq.ship_id IS NOT NULL
       AND pq.created_at >= datetime('now', '-${days} days')
       AND ${orgCond}
     GROUP BY pq.ship_id ORDER BY last_hit_time DESC LIMIT 200`,
    orgParams,
  );
  const list = rows.map((r) => {
    const s = get('SELECT id, name_cn, name_en, ship_id_no, imo_no, latest_risk_level, latest_risk_types FROM ships WHERE id=?', [r.id]);
    const orgs = all(
      `SELECT org, COUNT(*) AS cnt, MAX(created_at) AS last_time
       FROM pending_queries WHERE ship_id=? AND COALESCE(org,'')!='' GROUP BY org ORDER BY last_time DESC`,
      [r.id],
    );
    return {
      ship: s || { id: r.id },
      hit_count: r.hit_count,
      last_hit_time: r.last_hit_time,
      queried_orgs: orgs.map((o) => ({ org: o.org, count: o.cnt, last_time: o.last_time })),
    };
  });
  res.json({ status: 'ok', days, total: list.length, rows: list });
});

// ---- 5) 船舶详情（险种结果 + 最新 AI 报告；数据共享层，命中即可查看） ----
router.get('/:id(\\d+)', (req, res) => {
  const detail = shipDetail(Number(req.params.id));
  if (!detail) return res.status(404).json({ status: 'error', message: '船舶不存在' });
  res.json({ status: 'ok', ...detail });
});

// 下载文件名安全化（去除文件系统非法字符）
function safeFileBase(s) {
  return String(s || '').replace(/[\\/:*?"<>|\r\n]/g, '').trim();
}

// ---- 6) 下载该船舶的中银保信返回数据 Excel（v1.3g：仅该船，保留原始返回的全部信息列） ----
router.get('/:id(\\d+)/export-data', async (req, res) => {
  try {
    const ship = get('SELECT * FROM ships WHERE id=?', [Number(req.params.id)]);
    if (!ship) return res.status(404).json({ status: 'error', message: '船舶不存在' });
    const policies = all('SELECT * FROM ship_policy_results WHERE ship_id=? ORDER BY id', [ship.id])
      .map((p) => ({
        insurance_subtype: p.insurance_subtype,
        loss_ratio_paid: p.loss_ratio_paid ? JSON.parse(p.loss_ratio_paid) : null,
        loss_ratio_total: p.loss_ratio_total ? JSON.parse(p.loss_ratio_total) : null,
        accident_causes: p.accident_causes ? JSON.parse(p.accident_causes) : null,
        claim_amounts: p.claim_amounts ? JSON.parse(p.claim_amounts) : null,
        claim_ranges: p.claim_ranges ? JSON.parse(p.claim_ranges) : null,
        early_ratio_1m: p.early_ratio_1m ? JSON.parse(p.early_ratio_1m) : null,
        early_ratio_2m: p.early_ratio_2m ? JSON.parse(p.early_ratio_2m) : null,
        early_ratio_3m: p.early_ratio_3m ? JSON.parse(p.early_ratio_3m) : null,
        insurer_count_3y: p.insurer_count_3y,
        latest_insurer_code: p.latest_insurer_code,
        avg_amount_premium: p.avg_amount_premium ? JSON.parse(p.avg_amount_premium) : null,
        raw: p.raw_json ? JSON.parse(p.raw_json) : {},
      }));
    const buf = await buildShipDataExcel(ship, policies);
    const name = `船舶数据_${safeFileBase(ship.name_cn || ship.name_en || ship.ship_id_no) || ship.id}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
    res.send(buf);
  } catch (e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// ---- 7) 下载 AI 解读报告（PDF，每页叠加斜向水印（机构 · 账号）；仅输出报告正文，不含元信息头） ----
router.get('/:id(\\d+)/export-report', async (req, res) => {
  const ship = get('SELECT * FROM ships WHERE id=?', [Number(req.params.id)]);
  if (!ship) return res.status(404).json({ status: 'error', message: '船舶不存在' });
  const report = get('SELECT * FROM ai_reports WHERE ship_id=? ORDER BY id DESC LIMIT 1', [ship.id]);
  if (!report) return res.status(404).json({ status: 'error', message: '该船舶暂无 AI 解读报告' });
  try {
    const viewer = req.user ? `${req.user.org || '-'} · ${req.user.username}` : '';
    const buf = await buildReportPdf({
      reportMd: report.report_md || '',
      watermarkText: viewer || '内部资料',
    });
    const name = `AI解读报告_${safeFileBase(ship.name_cn || ship.name_en || ship.ship_id_no) || ship.id}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
    res.send(buf);
  } catch (e) {
    res.status(500).json({ status: 'error', message: '生成 PDF 报告失败: ' + e.message });
  }
});

// ---- 8) AI 报告人工评价（v1.3g：星级评级 + 准确性 + 评语，用于反馈 AI 分析是否准确） ----
const ACCURACY_OPTIONS = ['准确', '部分准确', '不准确'];

router.get('/:id(\\d+)/feedback', (req, res) => {
  const shipId = Number(req.params.id);
  const agg = get('SELECT COUNT(*) AS cnt, AVG(rating) AS avg_rating FROM ai_feedback WHERE ship_id=?', [shipId]);
  const mine = get(
    'SELECT * FROM ai_feedback WHERE ship_id=? AND username=? ORDER BY id DESC LIMIT 1',
    [shipId, req.user.username],
  );
  res.json({
    status: 'ok',
    count: agg.cnt || 0,
    avgRating: agg.avg_rating != null ? Math.round(agg.avg_rating * 10) / 10 : null,
    mine: mine || null,
  });
});

router.post('/:id(\\d+)/feedback', (req, res) => {
  const shipId = Number(req.params.id);
  const ship = get('SELECT id FROM ships WHERE id=?', [shipId]);
  if (!ship) return res.status(404).json({ status: 'error', message: '船舶不存在' });
  const ratingNum = Number(req.body?.rating);
  if (!Number.isInteger(ratingNum) || ratingNum < 1 || ratingNum > 5) {
    return res.status(400).json({ status: 'error', message: '请先选择评级（1-5 星）' });
  }
  const rating = ratingNum;
  const accuracy = ACCURACY_OPTIONS.includes(req.body?.accuracy) ? req.body.accuracy : '';
  const comment = String(req.body?.comment || '').trim().slice(0, 500);
  const report = get('SELECT id FROM ai_reports WHERE ship_id=? ORDER BY id DESC LIMIT 1', [shipId]);
  // 同人同船保留最新一条评价
  run('DELETE FROM ai_feedback WHERE ship_id=? AND username=?', [shipId, req.user.username]);
  run(
    `INSERT INTO ai_feedback (ship_id, report_id, username, org, rating, accuracy, comment, created_at)
     VALUES (?,?,?,?,?,?,?,?)`,
    [shipId, report?.id || null, req.user.username, req.user.org || '', rating, accuracy, comment, new Date().toISOString()],
  );
  res.json({ status: 'ok', message: '评价已提交，感谢反馈' });
});

// ====================== 管理员接口 ======================

// 手动触发：汇总所有机构待查询成总公司单文件上传（v1.3f：不再按机构分组，去重后统一一个文件）
router.post('/admin/export-now', async (req, res) => {
  try {
    const r = await exportPendingAll(req.body?.date);
    res.json({ status: 'ok', ...r });
  } catch (e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// 手动触发：检索并导入返回结果（仅 admin）
router.post('/admin/import-now', adminOnly, async (req, res) => {
  try {
    const r = await importResults(req.body?.date || null);
    res.json({ status: 'ok', ...r });
  } catch (e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// v1.6：重新生成全部船舶的 AI 解读报告（仅 admin；报告格式变更/全量重算用）
router.post('/admin/regen-reports', adminOnly, async (req, res) => {
  const started = new Date().toISOString();
  let ok = 0;
  const errors = [];
  try {
    const ships = all('SELECT id FROM ships ORDER BY id');
    for (const { id } of ships) {
      try {
        await runInterpretForShip(id);
        ok += 1;
      } catch (e) {
        errors.push(`船舶 ${id}: ${e.message}`);
      }
    }
    logAdminAction('regen-reports', `重新生成 ${ok} 份报告${errors.length ? `，失败 ${errors.length} 份` : ''}`);
    res.json({ status: 'ok', reports: ok, failed: errors.length, errors: errors.slice(0, 10) });
  } catch (e) {
    logAdminAction('regen-reports', `失败: ${e.message}（已完成 ${ok}）`);
    res.status(500).json({ status: 'error', message: e.message });
  } finally {
    console.log(`[ships] regen-reports 耗时 ${((Date.now() - new Date(started).getTime()) / 1000).toFixed(1)}s`);
  }
});

// 模拟中银保信返回结果（v1.3d 演示用）
// 读取 upload/ 待查询文件 → 生成模拟 result 文件放入 download/ → 自动导入+解读
router.post('/admin/simulate-return', adminOnly, async (req, res) => {
  try {
    const r = await simulateReturn(req.body?.date || null);
    res.json({ status: 'ok', ...r });
  } catch (e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// Agent 运行日志（仅 admin）
router.get('/admin/logs', adminOnly, (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const rows = all('SELECT * FROM agent_task_logs ORDER BY id DESC LIMIT ?', [limit]);
  res.json({ status: 'ok', rows });
});

// 统计面板数据（仅 admin）
router.get('/admin/stats', adminOnly, (req, res) => {
  const stat = (sql, params = []) => (all(sql, params)[0] || {}).n || 0;
  res.json({
    status: 'ok',
    stats: {
      ships: stat('SELECT COUNT(*) AS n FROM ships'),
      policies: stat('SELECT COUNT(*) AS n FROM ship_policy_results'),
      reports: stat('SELECT COUNT(*) AS n FROM ai_reports'),
      // v1.4c：高风险统计替换为各风险类型船舶数（全量船舶库）
      riskTypes: riskTypeStats((w, p) => stat(`SELECT COUNT(*) AS n FROM ships WHERE ${w}`, p)),
      pending: stat("SELECT COUNT(*) AS n FROM pending_queries WHERE status IN ('pending','exported')"),
      todayQueries: stat("SELECT COUNT(*) AS n FROM pending_queries WHERE created_at LIKE '" + new Date().toISOString().slice(0, 10) + "%'"),
      // v1.4e：命中复用改为只统计近半年内重复查询的船舶（按 ship_id 去重，口径与 GET /hit-reuse 一致）
      hitQueries: stat("SELECT COUNT(DISTINCT ship_id) AS n FROM pending_queries WHERE status='hit' AND ship_id IS NOT NULL AND created_at >= datetime('now', '-180 days')"),
    },
  });
});

// 全局上传配置（v1.3b 新增；取代 org_settings.upload_mode/upload_time）
router.get('/admin/upload-config', adminOnly, (req, res) => {
  const cfg = getUploadConfig();
  res.json({ status: 'ok', ...cfg, agent_enabled: getAgentEnabled() });
});

router.post('/admin/upload-config', adminOnly, (req, res) => {
  try {
    const { mode, time } = req.body || {};
    const cfg = setUploadConfig({ mode, time });
    logAdminAction('upload-config', `设置全局上传：mode=${cfg.upload_mode}, time=${cfg.upload_time}`);
    res.json({ status: 'ok', ...cfg });
  } catch (e) {
    res.status(400).json({ status: 'error', message: e.message });
  }
});

// 管理员操作日志（写入 agent_task_logs）
function logAdminAction(action, detail) {
  run(
    'INSERT INTO agent_task_logs (task_type, org, biz_key, status, detail, started_at, finished_at) VALUES (?,?,?,?,?,?,?)',
    [action, '', action, 'ok', detail, new Date().toISOString(), new Date().toISOString()],
  );
}

// Agent 总开关（仅 admin）
router.get('/admin/agent-enabled', adminOnly, (req, res) => {
  res.json({ status: 'ok', enabled: getAgentEnabled() });
});

router.post('/admin/agent-enabled', adminOnly, (req, res) => {
  const enabled = !!(req.body || {}).enabled;
  setAgentEnabled(enabled);
  res.json({ status: 'ok', enabled: getAgentEnabled() });
});

export default router;
