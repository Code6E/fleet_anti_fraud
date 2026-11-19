// Excel 读写（船舶险反欺诈查询格式，对齐中银保信真实规范）
//
// 上传（待查询）文件：Sheet 名「A01入参」，6 列：
//   序号 | 查询服务编号 | 船舶识别号 | IMO号 | 船舶中文名称 | 船舶英文名称
//   文件命名：船舶_{服务编号}_{YYYYMMDD}_{分公司名}.xlsx
//
// 结果文件（中银保信返回）：前 6 列基础上追加业务列（含换行表头），一船按险种小类拆多行：
//   险种小类 | 当年及过去3年满期赔付率（已决）/（已决+未决）| 近3年出险原因及数量 | 近3年赔案金额 |
//   近3年赔案区间及案件数量 | 近1年起保当月/2个月/3个月出险保单数量及占比 | 近3年保单涉及保险公司数量 |
//   最近保单涉及保险公司代码 | 近3年单均保额保费
//   文件命名：上传名 + _result（真实环境存在 _RESULT 大写、空格、双后缀、(1) 副本等脏数据）
import ExcelJS from 'exceljs';

// 服务配置（可由 .env 覆盖）
export const SERVICE_NAME = process.env.SERVICE_NAME || '船舶';
export const SERVICE_NO = process.env.SERVICE_NO || '000012';

export const SHIP_QUERY_HEADERS = ['序号', '查询服务编号', '船舶识别号', 'IMO号', '船舶中文名称', '船舶英文名称'];

function cellToString(v) {
  if (v == null) return '';
  if (typeof v === 'object') {
    if (v.text != null) return String(v.text);
    if (v.richText) return v.richText.map((t) => t.text).join('');
    if (v.result) return cellToString(v.result);
    if (v instanceof Date) return v.toISOString();
    return String(v);
  }
  if (typeof v === 'number') return String(v);
  return String(v).trim();
}

// 表头 normalize：去掉所有空白字符（结果文件表头内含换行，如「当年及过去3年\n满期赔付率\n（已决）」）
function normHeader(h) {
  return String(h || '').replace(/\s+/g, '');
}

// ====================== 待查询文件生成 ======================

// 由待查询行（船舶四要素）生成合规 xlsx 缓冲
export async function buildShipQueryExcel(rows) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('A01入参');
  ws.columns = SHIP_QUERY_HEADERS.map((h) => ({ header: h, width: 24 }));
  let seq = 0;
  for (const r of rows) {
    seq += 1;
    // 用数组按列序写入（避免依赖 columns 的 key 定义）
    ws.addRow([
      seq,
      SERVICE_NAME,
      r.ship_id_no || '',
      r.imo_no || '',
      r.name_cn || '',
      r.name_en || '',
    ]);
  }
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

// 生成合规上传文件名：船舶_{服务编号}_{YYYYMMDD}_{分公司名}.xlsx
export function buildQueryFileName(orgDisplayName, date = new Date()) {
  const ymd = date.toISOString().slice(0, 10).replace(/-/g, '');
  return `${SERVICE_NAME}_${SERVICE_NO}_${ymd}_${orgDisplayName}.xlsx`;
}

// 合规文件名校验（三重校验之一）
export function isValidQueryFileName(name) {
  return new RegExp(`^${SERVICE_NAME}_${SERVICE_NO}_\\d{8}_.+\\.xlsx$`).test(name);
}

// ====================== 待查询文件解析（模拟中银保信返回用） ======================

// 解析待查询文件（upload/ 中的 A01入参 格式），返回船舶四要素列表
// [{ ship_id_no, imo_no, name_cn, name_en }]
export async function parseShipQueryExcel(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  if (!ws) return [];
  // 表头定位
  const colMap = {};
  ws.getRow(1).eachCell((cell, colNumber) => {
    const h = normHeader(cellToString(cell.value));
    if (h.includes('船舶识别号')) colMap.ship_id_no = colNumber;
    else if (h.includes('IMO')) colMap.imo_no = colNumber;
    else if (h.includes('船舶中文名')) colMap.name_cn = colNumber;
    else if (h.includes('船舶英文名')) colMap.name_en = colNumber;
  });
  if (!colMap.name_cn && !colMap.ship_id_no && !colMap.imo_no) return [];
  const ships = [];
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const cell = (key) => (colMap[key] ? cellToString(row.getCell(colMap[key]).value) : '');
    const s = {
      ship_id_no: cell('ship_id_no'),
      imo_no: cell('imo_no'),
      name_cn: cell('name_cn'),
      name_en: cell('name_en'),
    };
    if (s.ship_id_no || s.imo_no || s.name_cn || s.name_en) ships.push(s);
  });
  return ships;
}

// ====================== 模拟中银保信返回结果文件生成 ======================

// 结果文件表头（含换行，与真实文件完全一致）
const RESULT_HEADERS = [
  '序号', '查询服务编号', '船舶识别号', 'IMO号', '船舶中文名', '船舶英文名',
  '险种小类',
  '当年及过去3年\n满期赔付率\n（已决）',
  '当年及过去3年\n满期赔付率\n（已决+未决）',
  '近3年出险原因及数量',
  '近3年赔案金额',
  '近3年赔案区间及案件数量',
  '近1年起保当月出\n险保单数量及占比',
  '近1年起保2个月出\n险保单数量及占比',
  '近1年起保3个月出\n险保单数量及占比',
  '近3年保单涉及\n保险公司数量',
  '最近保单涉及\n保险公司代码',
  '近3年单均保额保费',
];

// 风险场景模板（覆盖演示需要的典型场景）
// 每个模板返回该船各险种的数据行（18 列数组）
const RISK_TEMPLATES = {
  // 正常船舶：低赔付、无出险
  normal: [
    ['油污险', 'Z,0,0,0', 'Z,0,0,0', '(null)', '(null)', '(null)', '0,0.00%', '0,0.00%', '0,0.00%', 1, '000137', '18666667,9500'],
    ['船壳险', 'Z,0,0,0', 'Z,0,0,0', '(null)', '(null)', '(null)', '0,0.00%', '0,0.00%', '0,0.00%', 1, '000017', '1500000,6000'],
    ['保赔险', 'Z,0,0,0', 'Z,0,0,0', '(null)', '(null)', '(null)', '0,0.00%', '0,0.00%', '0,0.00%', 1, '000017', '800000,3200'],
  ],
  // 高赔付风险：满期赔付率连续超 100%
  high_loss_ratio: [
    ['油污险', '0,0,0,0', '0,0,0,0', '(null)', '(null)', '(null)', '0,0.00%', '0,0.00%', '0,0.00%', 1, '000137', '12000000,4800'],
    ['船壳险', '0,180,220,150', '0,200,250,180', '碰撞3次、搁浅1次', '850000,120000,300000,50000', '50万以下2件、50-100万2件', '1,8.33%', '2,16.67%', '0,0.00%', 3, '000017', '5000000,8000'],
    ['保赔险', '0,150,180,120', '0,170,200,140', '人员伤亡2次', '600000,400000', '50万以下1件、50-100万1件', '1,10.00%', '1,10.00%', '0,0.00%', 3, '000012', '3000000,5000'],
  ],
  // 倒签单嫌疑：起保当月出险占比极高
  early_claim: [
    ['油污险', 'Z,0,0,0', 'Z,0,0,0', '(null)', '(null)', '(null)', '0,0.00%', '0,0.00%', '0,0.00%', 1, '000137', '9000000,4500'],
    ['船壳险', '0,80,120,90', '0,100,140,110', '碰撞2次', '450000,200000', '50万以下1件、50-100万1件', '3,75.00%', '1,25.00%', '0,0.00%', 2, '000017', '1800000,7200'],
    ['保赔险', '0,60,80,50', '0,80,100,70', '搁浅1次', '150000', '50万以下1件', '2,66.67%', '0,0.00%', '0,0.00%', 2, '000046', '1500000,4500'],
  ],
  // 频繁转保：保险公司数量多
  frequent_switch: [
    ['油污险', '0,0,0,0', '0,0,0,0', '(null)', '(null)', '(null)', '0,0.00%', '0,0.00%', '0,0.00%', 1, '000137', '10000000,5000'],
    ['船壳险', '0,90,110,70', '0,110,130,90', '碰撞1次、搁浅1次', '300000,100000', '50万以下2件', '1,14.29%', '1,14.29%', '0,0.00%', 5, '000017', '2200000,6600'],
    ['保赔险', '0,70,90,60', '0,90,110,80', '人员伤亡1次', '350000', '50万以下1件', '1,16.67%', '0,0.00%', '0,0.00%', 5, '000002', '1800000,5400'],
  ],
  // 无承保记录：全部 Z
  no_record: [
    ['油污险', 'Z,Z,Z,Z', 'Z,Z,Z,Z', '(null)', '(null)', '(null)', '0,0.00%', '0,0.00%', '0,0.00%', 0, '(null)', '(null)'],
    ['船壳险', 'Z,Z,Z,Z', 'Z,Z,Z,Z', '(null)', '(null)', '(null)', '0,0.00%', '0,0.00%', '0,0.00%', 0, '(null)', '(null)'],
    ['保赔险', 'Z,Z,Z,Z', 'Z,Z,Z,Z', '(null)', '(null)', '(null)', '0,0.00%', '0,0.00%', '0,0.00%', 0, '(null)', '(null)'],
  ],
};

// 简单 hash：由船舶四要素选场景模板（保证同一艘船每次模拟结果一致）
function pickTemplate(ship) {
  const key = (ship.ship_id_no || '') + (ship.imo_no || '') + (ship.name_cn || '') + (ship.name_en || '');
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = ((hash << 5) - hash + key.charCodeAt(i)) | 0;
  const templates = ['normal', 'high_loss_ratio', 'early_claim', 'frequent_switch', 'no_record'];
  // 无承保记录场景概率降低（只占 1/7）
  const idx = Math.abs(hash) % 7;
  return templates[idx === 6 ? 0 : idx];
}

// 由船舶列表生成模拟中银保信返回的 result xlsx 缓冲
// 每条船舶按险种拆多行（油污险/船壳险/保赔险），18 列完整数据
export async function buildShipResultExcel(ships) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  ws.columns = RESULT_HEADERS.map((h) => ({ header: h, width: 18 }));
  let seq = 0;
  for (const s of ships) {
    seq += 1;
    const template = pickTemplate(s);
    const rows = RISK_TEMPLATES[template];
    for (const r of rows) {
      // 18 列：序号 + 查询服务编号 + 四要素 + 12 业务列
      ws.addRow([
        seq,
        SERVICE_NAME,
        s.ship_id_no || '',
        s.imo_no || '',
        s.name_cn || '',
        s.name_en || '',
        ...r,
      ]);
    }
  }
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

// ====================== 单船数据导出（v1.3g） ======================

// 由船舶的险种记录生成「中银保信返回数据」xlsx 缓冲（仅该船，保留原始返回的全部信息列）
// 优先用 raw_json 中的原始列（列名/顺序/换行与中银保信返回完全一致）；raw 缺失时退回结构化字段
export async function buildShipDataExcel(ship, policies) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');

  // 收集该船所有险种行的原始列（并集；首个 raw 的列顺序优先）
  const headers = [];
  const seen = new Set();
  for (const p of policies) {
    const raw = p.raw && typeof p.raw === 'object' ? p.raw : {};
    for (const h of Object.keys(raw)) {
      if (!seen.has(h)) { seen.add(h); headers.push(h); }
    }
  }

  let rows;
  if (headers.length) {
    // 原始列还原：每行按 raw 取值
    rows = policies.map((p) => {
      const raw = p.raw || {};
      return headers.map((h) => raw[h] ?? '');
    });
  } else {
    // 兜底：结构化字段 → 可读表头（复合值转回字符串）
    const fallbackHeaders = [
      '险种小类', '当年及过去3年满期赔付率（已决）', '当年及过去3年满期赔付率（已决+未决）',
      '近3年出险原因及数量', '近3年赔案金额', '近3年赔案区间及案件数量',
      '近1年起保当月出险保单数量及占比', '近1年起保2个月出险保单数量及占比', '近1年起保3个月出险保单数量及占比',
      '近3年保单涉及保险公司数量', '最近保单涉及保险公司代码', '近3年单均保额保费',
    ];
    headers.push(...fallbackHeaders);
    const j = (v) => (v == null ? '' : (typeof v === 'object' ? (v.raw ?? JSON.stringify(v)) : String(v)));
    rows = policies.map((p) => [
      p.insurance_subtype || '',
      j(p.loss_ratio_paid), j(p.loss_ratio_total),
      j(p.accident_causes), j(p.claim_amounts), j(p.claim_ranges),
      j(p.early_ratio_1m), j(p.early_ratio_2m), j(p.early_ratio_3m),
      p.insurer_count_3y ?? '',
      p.latest_insurer_code || '',
      j(p.avg_amount_premium),
    ]);
  }

  ws.columns = headers.map((h) => ({ header: h.replace(/\n/g, ''), width: 20 }));
  for (const r of rows) ws.addRow(r);

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

// ====================== 结果文件解析 ======================

// 复合值拆解 ---------------------------------------------------

// 赔付率 'Z,0,0,0' → ['Z','0','0','0']（Z=无承保记录；'(null)'→null；数值字符串保留原文）
function parseRatioYears(raw) {
  if (raw == null || raw === '' || raw === '(null)') return null;
  return String(raw).split(',').map((s) => s.trim());
}

// 数量及占比 '0,0.00%' → { count: 0, pct: 0 }
function parseCountPct(raw) {
  if (raw == null || raw === '' || raw === '(null)') return null;
  const m = String(raw).match(/^(\d+)\s*,\s*([\d.]+)%$/);
  if (!m) return { raw: String(raw) };
  return { count: Number(m[1]), pct: Number(m[2]) };
}

// 单均保额保费 '1500000,6000' → { amount: 1500000, premium: 6000 }
function parseAmountPremium(raw) {
  if (raw == null || raw === '' || raw === '(null)') return null;
  const parts = String(raw).split(',');
  if (parts.length === 2) {
    const a = Number(parts[0].trim());
    const b = Number(parts[1].trim());
    if (!Number.isNaN(a) && !Number.isNaN(b)) return { amount: a, premium: b };
  }
  return { raw: String(raw) };
}

// 出险原因及数量 '搁浅2次、碰撞1次' → { raw, items: [{cause, count}] }
function parseCauses(raw) {
  if (raw == null || raw === '' || raw === '(null)') return null;
  const s = String(raw);
  const items = [];
  for (const seg of s.split(/[,，、;；]/)) {
    const m = seg.trim().match(/^(.*?)(\d+)\s*次$/);
    if (m) items.push({ cause: m[1].trim(), count: Number(m[2]) });
  }
  return items.length ? { raw: s, items } : { raw: s };
}

// 列名 → 语义键映射（normalize 后关键词匹配；先长后短避免前缀歧义）
const COLUMN_MATCHERS = [
  ['ship_id_no', (h) => h.includes('船舶识别号')],
  ['imo_no', (h) => h.includes('IMO')],
  ['name_cn', (h) => h.includes('船舶中文名')],
  ['name_en', (h) => h.includes('船舶英文名')],
  ['insurance_subtype', (h) => h.includes('险种小类')],
  ['loss_ratio_total', (h) => h.includes('满期赔付率') && h.includes('已决') && h.includes('未决')],
  ['loss_ratio_paid', (h) => h.includes('满期赔付率') && h.includes('已决')],
  ['accident_causes', (h) => h.includes('出险原因')],
  ['claim_amounts', (h) => h.includes('赔案金额')],
  ['claim_ranges', (h) => h.includes('赔案区间')],
  ['early_ratio_1m', (h) => h.includes('起保当月')],
  ['early_ratio_2m', (h) => h.includes('起保2个月')],
  ['early_ratio_3m', (h) => h.includes('起保3个月')],
  ['insurer_count_3y', (h) => h.includes('保险公司数量')],
  ['latest_insurer_code', (h) => h.includes('保险公司代码')],
  ['avg_amount_premium', (h) => h.includes('单均保额')],
];

// 解析结果文件缓冲。返回：
// {
//   format: 'ship' | 'unknown',
//   ships: [{ conditions: {ship_id_no, imo_no, name_cn, name_en}, policies: [policy...] }]
// }
// policy 为结构化险种记录（复合值已拆解，raw 保留整行原文兜底）。
export async function parseShipResultExcel(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  if (!ws) return { format: 'unknown', ships: [] };

  // 表头 → 语义键
  const colMap = {};
  ws.getRow(1).eachCell((cell, colNumber) => {
    const h = normHeader(cellToString(cell.value));
    if (!h) return;
    for (const [key, match] of COLUMN_MATCHERS) {
      if (colMap[key]) continue; // 已映射（先长后短，首个命中优先）
      if (match(h)) { colMap[key] = colNumber; break; }
    }
  });

  // 船舶格式识别：必须同时具备船舶中文名与险种小类列（企业/货运格式不具备）
  if (!colMap.name_cn || !colMap.insurance_subtype) {
    return { format: 'unknown', ships: [] };
  }

  // 全部原始列（供 raw 兜底）
  const rawCols = {};
  ws.getRow(1).eachCell((cell, colNumber) => {
    rawCols[colNumber] = String(cellToString(cell.value));
  });

  const byShip = new Map(); // key=四要素拼接 → {conditions, policies}
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const cell = (key) => (colMap[key] ? cellToString(row.getCell(colMap[key]).value) : '');
    const conditions = {
      ship_id_no: cell('ship_id_no'),
      imo_no: cell('imo_no'),
      name_cn: cell('name_cn'),
      name_en: cell('name_en'),
    };
    // 四要素全空行跳过
    if (!conditions.ship_id_no && !conditions.imo_no && !conditions.name_cn && !conditions.name_en) return;

    const raw = {};
    for (const [colNum, h] of Object.entries(rawCols)) raw[h] = cellToString(row.getCell(Number(colNum)).value);

    const policy = {
      insurance_subtype: cell('insurance_subtype'),
      loss_ratio_paid: parseRatioYears(cell('loss_ratio_paid')),
      loss_ratio_total: parseRatioYears(cell('loss_ratio_total')),
      accident_causes: parseCauses(cell('accident_causes')),
      claim_amounts: cell('claim_amounts') === '(null)' || cell('claim_amounts') === '' ? null : { raw: cell('claim_amounts') },
      claim_ranges: cell('claim_ranges') === '(null)' || cell('claim_ranges') === '' ? null : { raw: cell('claim_ranges') },
      early_ratio_1m: parseCountPct(cell('early_ratio_1m')),
      early_ratio_2m: parseCountPct(cell('early_ratio_2m')),
      early_ratio_3m: parseCountPct(cell('early_ratio_3m')),
      insurer_count_3y: cell('insurer_count_3y') === '' || cell('insurer_count_3y') === '(null)'
        ? null : Number(cell('insurer_count_3y')),
      latest_insurer_code: cell('latest_insurer_code') === '(null)' ? '' : cell('latest_insurer_code'),
      avg_amount_premium: parseAmountPremium(cell('avg_amount_premium')),
      raw,
    };

    const key = [conditions.ship_id_no, conditions.imo_no, conditions.name_cn, conditions.name_en].join('|');
    if (!byShip.has(key)) byShip.set(key, { conditions, policies: [] });
    byShip.get(key).policies.push(policy);
  });

  return { format: 'ship', ships: [...byShip.values()] };
}

// ====================== 结果文件名容错解析 ======================

// 解析结果文件名（兼容真实脏数据：_RESULT 大写、空格、双后缀、(1) 副本、日期前缀等）
// 返回 { ok, service, serviceNo, date, orgName } 或 { ok: false, reason }
export function parseResultFileName(fileName) {
  let base = String(fileName || '').split('/').pop();

  // 容错预处理（按真实脏数据样例逐项归一化）
  base = base
    .replace(/\(\d+\)/g, '')                    // 副本号：福建分公司(1) → 福建分公司
    .replace(/\.xlsx_result\.xlsx$/i, '_result.xlsx') // 双后缀：辽宁分公司.xlsx_result.xlsx
    .replace(/\s*_result\s*/gi, '_result')      // 空格：上海分公司 _result.xlsx / 湖北_result .xlsx
    .replace(/^(\d+\.\d+)[-_]/, '');            // 日期前缀：12.10-A01_... → A01_...

  // 必须以 _result 结尾（大小写不敏感）
  const m = base.match(/^(船舶|A01)_(\d{6})_(\d{8})[-_ ]?(.+?)_result\.xlsx$/i);
  if (!m) {
    return { ok: false, reason: `文件名不符合「{服务}_{编号}_{YYYYMMDD}_{分公司}_result.xlsx」规范: ${base}` };
  }
  return {
    ok: true,
    service: m[1].toUpperCase() === 'A01' ? 'A01' : '船舶',
    serviceNo: m[2],
    date: m[3],
    orgName: m[4].trim(),
  };
}
