// AI 解读引擎（规则先行、LLM 增强、离线兑底）
// - evaluateRiskDimensions()：双维度风险评估（业务品质/欺诈，v1.5 依据《风险评估维度.xlsx》），驱动风险标签与等级
//   v1.7：无投保记录 ≠ 低风险——双无数据整船标「无数据」（灰），混合时无数据维度出「X风险·无数据」标签
// - evaluate()：规则引擎（R1-R6，阈值读 config/interpret-rules.json），命中详情与软信号供报告解释
// - generateReport()：优先调用 DeepSeek 生成自然语言解读报告；未配置/失败/超时自动降级为规则版模板报告
//   v1.6：报告改为六节结构（船舶档案/业务品质分析/欺诈风险识别/单均保额保费/风险提示/核保建议），
//         第一节由船讯网（anlan.js）自动查询回填，格式对齐《船舶险智盾报告模板.docx》
//   v1.7：对齐业务老师 ship-zhidun-report skill——①档案查到就展示查不到不写提示语；②识别号另起一行；
//         ③船龄=当前年−识别号CN后四位；④费率推算（保赔/油污元/GT、其余‰）；⑤未决估损给绝对值禁倍数表述；
//         ⑥机构只写全称；⑦正文不写评级依据（第五节只给结果，评级词**加粗**供 Word 着色）；
//         ⑧公司数量解读与方案稳定性定性判断；⑨无数据船不能认定优质标的
// - runInterpretForShip()：档案拉取 + 入库 + 更新船舶最新风险等级与标签
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { all, get, run, persist } from './db.js';
import { anlanEnabled, fetchShipProfile } from './anlan.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RULES_PATH = path.resolve(__dirname, '../config/interpret-rules.json');
const FIELD_DICT_PATH = path.resolve(__dirname, '../config/field-dictionary.json');
const INSURER_CODES_PATH = path.resolve(__dirname, '../config/insurer-codes.json');
const CASE_EXAMPLE_PATH = path.resolve(__dirname, '../config/case-interpretation.md');

let cachedRules = null;
let rulesLoadedAt = 0;

export function loadRules(force = false) {
  const mtime = fs.existsSync(RULES_PATH) ? fs.statSync(RULES_PATH).mtimeMs : 0;
  if (!force && cachedRules && rulesLoadedAt === mtime) return cachedRules;
  cachedRules = JSON.parse(fs.readFileSync(RULES_PATH, 'utf-8'));
  rulesLoadedAt = mtime;
  return cachedRules;
}

// 字段字典（供 LLM 准确理解字段含义与取值语义）
let cachedFieldDict = null;
export function loadFieldDict() {
  if (cachedFieldDict) return cachedFieldDict;
  try { cachedFieldDict = JSON.parse(fs.readFileSync(FIELD_DICT_PATH, 'utf-8')); }
  catch { cachedFieldDict = { fields: [] }; }
  return cachedFieldDict;
}

// 保险公司代码 → 名称映射
let cachedInsurerCodes = null;
export function loadInsurerCodes() {
  if (cachedInsurerCodes) return cachedInsurerCodes;
  try { cachedInsurerCodes = JSON.parse(fs.readFileSync(INSURER_CODES_PATH, 'utf-8')); }
  catch { cachedInsurerCodes = {}; }
  return cachedInsurerCodes;
}

// 保险公司代码翻译为机构全称（v1.7 硕约束：报告正文不出现机构代码）
export function insurerName(code) {
  if (!code) return '';
  const map = loadInsurerCodes();
  return map[code] || code;
}

// 案例解读范例（供 LLM 对齐人工解读风格）
let cachedCase = '';
export function loadCaseExample() {
  if (cachedCase) return cachedCase;
  try { cachedCase = fs.readFileSync(CASE_EXAMPLE_PATH, 'utf-8'); }
  catch { cachedCase = ''; }
  return cachedCase;
}

// ====================== 软信号引擎（S1-S6，不改变等级评分，供报告综合研判引用） ======================

const YEAR_LABELS = ['当年', 'Y-1', 'Y-2', 'Y-3'];

function collectSoftSignals(policies, rules) {
  const SS = rules.soft_signals || {};
  const r1Pct = rules.rules.R1.threshold.min_pct;
  const signals = [];
  const add = (code, sub, detail) => {
    const meta = SS[code] || {};
    signals.push({ code, name: meta.name || code, subtype: sub, detail });
  };
  const num = (v) => { const n = Number(v); return Number.isNaN(n) ? null : n; };

  for (const p of policies || []) {
    const sub = p.insurance_subtype || '未知险种';
    const lp = Array.isArray(p.loss_ratio_paid) ? p.loss_ratio_paid : null;
    const lt = Array.isArray(p.loss_ratio_total) ? p.loss_ratio_total : null;

    // S1 未决赔案突出：某年度已决+未决 > 已决
    if (lp && lt) {
      for (let i = 0; i < Math.min(lp.length, lt.length); i++) {
        const a = num(lp[i]);
        const b = num(lt[i]);
        if (a != null && b != null && b > a) {
          const label = YEAR_LABELS[i] || `Y-${i}`;
          add('S1', sub, `${sub}：${label}年度已决赔付率 ${lp[i]}%、已决+未决 ${lt[i]}%，存在未决赔案`);
          break;
        }
      }
    }

    // S2 单年度赔付率畸高（不足 R2 的多年度条件）
    if (lt) {
      const ratio = SS.S2?.threshold?.ratio ?? 200;
      for (const v of lt) {
        const n = num(v);
        if (n != null && n >= ratio) {
          add('S2', sub, `${sub}：单年度已决+未决赔付率 ${v}%（≥${ratio}%，不足 R2 的多年度条件）`);
          break;
        }
      }
    }

    // S3 起保早期出险：当月/2个月/3个月有出险但当月占比未达 R1 阈值（R1 已命中则不再提示）
    const e1 = p.early_ratio_1m;
    const r1Hit = e1 && typeof e1.pct === 'number' && e1.pct >= r1Pct;
    if (!r1Hit) {
      const parts = [];
      for (const [key, label] of [['early_ratio_1m', '当月'], ['early_ratio_2m', '2个月'], ['early_ratio_3m', '3个月']]) {
        const e = p[key];
        if (e && typeof e.count === 'number' && e.count >= 1) parts.push(`起保${label}出险 ${e.count} 单/${e.pct}%`);
      }
      if (parts.length) add('S3', sub, `${sub}：${parts.join('、')}（当月占比未达 R1 阈值 ${r1Pct}%，存在倒签单嫌疑，需综合判断）`);
    }

    // S4 保额调整痕迹：单均保额非整万
    const ap = p.avg_amount_premium;
    const amt = ap ? num(ap.amount) : null;
    if (amt && amt % 10000 !== 0) add('S4', sub, `${sub}：单均保额 ${ap.amount} 数值零碎，保额曾调整，关注是否异常调整`);

    // S5 赔付率临界：已决+未决处于 [min, max) 区间
    if (lt) {
      const lo = SS.S5?.threshold?.min ?? 60;
      const hi = SS.S5?.threshold?.max ?? 100;
      for (const v of lt) {
        const n = num(v);
        if (n != null && n >= lo && n < hi) {
          add('S5', sub, `${sub}：已决+未决赔付率 ${v}% 处于 ${lo}%–${hi}% 临界区间，接近高赔付阈值`);
          break;
        }
      }
    }

    // S6 转保临界：2 家承保公司
    const cnt = SS.S6?.threshold?.count ?? 2;
    if (p.insurer_count_3y === cnt) add('S6', sub, `${sub}：近3年涉及 ${p.insurer_count_3y} 家保险公司，存在承保公司变更，需结合赔付情况关注`);
  }
  return signals;
}

// ====================== 风险维度评估（业务品质/欺诈双维度，依据《风险评估维度.xlsx》） ======================

const DIM_LEVEL_TEXT = { high: '高', medium: '中', low: '低' };

// ====================== 报告指标推算（v1.7，对齐业务老师 ship-zhidun-report skill） ======================

// 船龄 = 当前年份 − 识别号 CN 后四位建造年份（如 CN20102397742 → 2026−2010 = 16 年）；
// 识别号缺失/格式不符返回 null，不猜测
export function vesselAge(registNo, currentYear = new Date().getFullYear()) {
  const m = /^\s*CN\s*(\d{4})/i.exec(String(registNo || ''));
  if (!m) return null;
  const built = Number(m[1]);
  if (built < 1900 || built > currentYear) return null;
  return currentYear - built;
}

// 报告第一节船舶档案（v1.7：查到就展示、查不到就不展示，不写「请人工核实」类提示；识别号另起一行）
// 返回 { shipName, nameNote, registNumber, buildYear, shipAge, shipType, gt, dwt }，未命中字段为 null
export function buildArchive(ship, profile) {
  const shipName = ship.name_cn || ship.name_en || profile?.name_cn || profile?.name_en || ship.ship_id_no || '-';
  const profileName = profile ? (profile.name_cn || profile.name_en || '') : '';
  const nameNote = profileName && profileName !== shipName ? `（现名：${profileName}）` : '';
  const registNumber = profile?.regist_number || ship.ship_id_no || null;
  // 船龄优先用识别号推算（skill 权威口径，已用模板示例船验证）；识别号缺失时用船讯网建造年份兑底
  const shipAge = vesselAge(registNumber) ?? (profile?.ship_age != null ? profile.ship_age : null);
  const buildYear = profile?.build_year ?? (vesselAge(registNumber) != null ? new Date().getFullYear() - vesselAge(registNumber) : null);
  return {
    shipName, nameNote, registNumber,
    buildYear: buildYear ?? null,
    shipAge,
    shipType: profile?.ship_type || null,
    gt: profile?.gt || null,
    dwt: profile?.dwt || null,
  };
}

// 元 → 万元展示（整数万直接给整数，非整保留两位）
function wan(v) {
  if (v == null || Number.isNaN(Number(v))) return null;
  const w = Number(v) / 10000;
  return Math.abs(w - Math.round(w)) < 0.05 ? String(Math.round(w)) : w.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

// 险种费率推算：保赔险/油污险按总吨位计收（元/GT），其余按保额计（‰）；无对应基数返回 null
export function computeRate(subtype, amount, premium, gt) {
  const a = Number(amount);
  const p = Number(premium);
  if (!a || !p || Number.isNaN(a) || Number.isNaN(p)) return null;
  if (/保赔|油污/.test(String(subtype || ''))) {
    const g = Number(gt);
    if (!g || Number.isNaN(g)) return null;
    return { text: `${(p / g).toFixed(2)}元/GT`, gt: g };
  }
  return { text: `${((p / a) * 1000).toFixed(2)}‰` };
}

// 未决估损估算：(已决+未决 − 已决) 最大百分点 × 单均保费 ÷ 100，取整到万元；
// 硕约束：直接给绝对值（约X万元），禁止倍数换算表述，须标注估算值
export function estUnpaidLoss(p) {
  const lt = Array.isArray(p.loss_ratio_total) ? p.loss_ratio_total : [];
  const lp = Array.isArray(p.loss_ratio_paid) ? p.loss_ratio_paid : [];
  const prem = Number(p.avg_amount_premium?.premium);
  if (!prem || Number.isNaN(prem)) return null;
  let gap = 0;
  for (let i = 0; i < lt.length; i++) {
    const t = Number(lt[i]);
    if (Number.isNaN(t)) continue;
    const s = Number(lp[i]);
    gap = Math.max(gap, t - (!Number.isNaN(s) ? s : 0));
  }
  if (gap <= 0) return null;
  const est = Math.round((gap / 100) * prem / 10000) * 10000;
  // 取整到万元后为 0（保费过小）时不如不写，避免「约0万元」误导
  if (est < 10000) return null;
  return { est, text: `估损金额约${wan(est)}万元（估算值，仅供参考，实际以理赔系统立案估损为准）` };
}

// 承保方案稳定性定性判断（保额整万/保费整千 → 方案稳定；零头 → 可能微调；skill 要求标注非事实陈述）
export function schemeStability(policies) {
  const rows = (policies || []).filter((p) => {
    const a = Number(p.avg_amount_premium?.amount);
    const m = Number(p.avg_amount_premium?.premium);
    return a && m && !Number.isNaN(a) && !Number.isNaN(m);
  });
  if (!rows.length) return null;
  const sub = (p) => p.insurance_subtype || '未知险种';
  const segs = [];
  const wholeSi = rows.filter((p) => Number(p.avg_amount_premium.amount) % 10000 === 0);
  const wholePrem = rows.filter((p) => Number(p.avg_amount_premium.premium) % 1000 === 0);
  const oddPrem = rows.filter((p) => Number(p.avg_amount_premium.premium) % 1000 !== 0);
  if (wholeSi.length) {
    const vals = wholeSi.map((p) => `${wan(p.avg_amount_premium.amount)}万`).join('、');
    segs.push(`${wholeSi.map(sub).join('、')}的单均保额为完整整数（${vals}）`);
  }
  if (wholePrem.length) {
    const vals = wholePrem.map((p) => `${wan(p.avg_amount_premium.premium)}万`).join('、');
    segs.push(`${wholePrem.map(sub).join('、')}的单均保费亦为完整数值（${vals}），预计近3年承保方案基本保持稳定`);
  }
  for (const p of oddPrem) {
    segs.push(`${sub(p)}单均保费存在零头（${Number(p.avg_amount_premium.premium)}元），可能受保单数量或承保方案微调影响`);
  }
  return `结合单均保额保费数值，${segs.join('，')}。（本段为定性判断，非事实陈述）`;
}

// 保险公司数量解读（skill 口径：1 家稳定 / 2 家变更一次需关注 / 3 家及以上频繁变更重点关注）
export function insurerCountNote(count) {
  const n = Number(count);
  if (!n || Number.isNaN(n)) return null;
  if (n === 1) return '客户稳定性较高';
  if (n === 2) return '存在承保公司变更，需结合赔付情况关注';
  return '频繁变更承保公司，多为渠道业务或高赔付业务，重点关注';
}

// 近1年起保早期出险字段状态：none=无数据 / zero=0,0.00% / claim=有出险 / unknown=有值但格式异常
function earlyState(e) {
  if (!e) return 'none';
  if (typeof e.count === 'number') return e.count > 0 ? 'claim' : 'zero';
  return 'unknown';
}

// 双维度评估：返回 { business: {level, reasons[]}, fraud: {level, reasons[]} }
// - business：高风险任一条件命中；否则低风险三条件同时满足为低；剩余为中（规则定义“剩下都标为中风险”）
// - fraud：任一险种起保当月出险为高；全部为 0,0.00% 为低；当月为 0 但 2/3 个月有出险为中；无数据则不评级
export function evaluateRiskDimensions(policies, rules = loadRules()) {
  const RD = rules.risk_dimensions || {};
  const B = RD.business || {};
  const ps = policies || [];
  const num = (v) => { const n = Number(v); return Number.isNaN(n) ? null : n; };
  const sub = (p) => p.insurance_subtype || '未知险种';

  // ---------- 业务品质 ----------
  const bHigh = B.high || {};
  const bLow = B.low || {};
  const bReasons = [];
  // 高①：所有险种赔付率（已决+未决）中超过 ratio 的数值个数 ≥ over_ratio_count
  const ratioLimit = bHigh.ratio ?? 100;
  let overN = 0;
  for (const p of ps) {
    for (const v of (Array.isArray(p.loss_ratio_total) ? p.loss_ratio_total : [])) {
      const n = num(v);
      if (n != null && n > ratioLimit) overN += 1;
    }
  }
  if (overN >= (bHigh.over_ratio_count ?? 4)) {
    bReasons.push(`全部险种满期赔付率（已决+未决）中超过 ${ratioLimit}% 的数值共 ${overN} 个（≥${bHigh.over_ratio_count ?? 4} 个）`);
  }
  // 高②：任一险种前两个年度（当年/Y-1）赔付率任一超过 burst_ratio（出险转保可能）
  const burst = bHigh.burst_ratio ?? 500;
  outer:
  for (const p of ps) {
    const lt = Array.isArray(p.loss_ratio_total) ? p.loss_ratio_total : [];
    for (let i = 0; i < Math.min(2, lt.length); i++) {
      const n = num(lt[i]);
      if (n != null && n > burst) {
        bReasons.push(`${sub(p)}：${YEAR_LABELS[i] || `Y-${i}`} 赔付率（已决+未决）${lt[i]}%（>${burst}%，存在出险转保的可能性）`);
        break outer;
      }
    }
  }
  // 高③：任一出险原因数量超过 cause_count
  const causeLimit = bHigh.cause_count ?? 3;
  for (const p of ps) {
    for (const it of (p.accident_causes?.items || [])) {
      if (typeof it.count === 'number' && it.count > causeLimit) {
        bReasons.push(`${sub(p)}：出险原因「${it.cause}」数量 ${it.count}（超过 ${causeLimit}）`);
      }
    }
  }
  // 低风险三条件：①所有赔付率数值均低于 ratio；②出险原因合计数量 ≤ cause_total；③赔案金额合计 < claim_amount
  const lowRatio = bLow.ratio ?? 55;
  const allBelow = ps.every((p) =>
    (Array.isArray(p.loss_ratio_total) ? p.loss_ratio_total : []).every((v) => {
      const n = num(v);
      return n == null || n < lowRatio;
    }));
  const causeTotal = ps.reduce((n, p) =>
    n + (p.accident_causes?.items || []).reduce((m, it) => m + (it.count || 0), 0), 0);
  const claimTotal = ps.reduce((n, p) => {
    const m = String(p.claim_amounts?.raw || '').replace(/[,，\s]/g, '').match(/-?\d+(\.\d+)?/);
    return n + (m ? Number(m[0]) : 0);
  }, 0);
  const causeTotalLimit = bLow.cause_total ?? 1;
  const claimLimit = bLow.claim_amount ?? 100000;
  const lowOk = allBelow && causeTotal <= causeTotalLimit && claimTotal < claimLimit;

  const hasBizData = ps.some((p) => p.loss_ratio_total || p.accident_causes || p.claim_amounts);
  let business;
  if (bReasons.length) {
    business = { level: 'high', reasons: bReasons };
  } else if (!hasBizData) {
    business = { level: null, reasons: ['无承保理赔数据，业务品质无法评估'] };
  } else if (lowOk) {
    business = { level: 'low', reasons: [`赔付率数值均低于 ${lowRatio}%、出险原因合计 ${causeTotal}（≤${causeTotalLimit}）、赔案金额合计 ${claimTotal} 元（<${claimLimit} 元），同时满足低风险三条件`] };
  } else {
    business = { level: 'medium', reasons: [`未满足高风险条件，且不同时满足低风险三条件（赔付率均<${lowRatio}%：${allBelow ? '是' : '否'}；出险原因合计 ${causeTotal}≤${causeTotalLimit}：${causeTotal <= causeTotalLimit ? '是' : '否'}；赔案金额合计 ${claimTotal}元<${claimLimit}元：${claimTotal < claimLimit ? '是' : '否'}）`] };
  }

  // ---------- 欺诈风险（起保早期出险） ----------
  let any1mClaim = false;
  let any23mClaim = false;
  let hasEarlyData = false;
  for (const p of ps) {
    const s1 = earlyState(p.early_ratio_1m);
    const s2 = earlyState(p.early_ratio_2m);
    const s3 = earlyState(p.early_ratio_3m);
    if (s1 !== 'none' || s2 !== 'none' || s3 !== 'none') hasEarlyData = true;
    if (s1 === 'claim' || s1 === 'unknown') any1mClaim = true;
    if (s2 === 'claim' || s2 === 'unknown' || s3 === 'claim' || s3 === 'unknown') any23mClaim = true;
  }
  let fraud;
  if (any1mClaim) {
    const reasons = [];
    for (const p of ps) {
      const e1 = p.early_ratio_1m;
      if (e1 && (typeof e1.count !== 'number' || e1.count > 0)) {
        reasons.push(`${sub(p)}：近1年起保当月出险保单 ${e1.count ?? '?'} 单、占比 ${e1.pct ?? '?'}%（非 0,0.00%）`);
      }
    }
    fraud = { level: 'high', reasons };
  } else if (!hasEarlyData) {
    fraud = { level: null, reasons: ['近1年起保当月/2个月/3个月出险数据缺失，无法评估'] };
  } else if (any23mClaim) {
    const reasons = [];
    for (const p of ps) {
      const parts = [];
      for (const [key, label] of [['early_ratio_2m', '2个月'], ['early_ratio_3m', '3个月']]) {
        const e = p[key];
        if (e && (typeof e.count !== 'number' || e.count > 0)) parts.push(`起保${label}出险 ${e.count ?? '?'} 单/${e.pct ?? '?'}%`);
      }
      if (parts.length) reasons.push(`${sub(p)}：${parts.join('、')}（当月无出险，存在早期出险但未达当月出险程度）`);
    }
    fraud = { level: 'medium', reasons };
  } else {
    fraud = { level: 'low', reasons: ['所有险种近1年起保当月/2个月/3个月出险保单数量及占比均为 0,0.00%'] };
  }

  return { business, fraud };
}

// 维度→展示标签与风险等级（v1.7 对齐 skill：无投保记录 ≠ 低风险）
// - 双低 → 「低风险」（绿）
// - 双无数据 → 「无数据」（灰，过往3年无投保记录，不能据此认定为优质标的）
// - 混合（含无数据维度）→ 无数据维度出「X风险·无数据」标签，低维度也出「X风险·低」标签，整船等级取非无数据维度最高级
export function dimensionSummary(dim) {
  const bLv = dim?.business?.level || null;
  const fLv = dim?.fraud?.level || null;
  if (bLv === null && fLv === null) return { tags: ['无数据'], risk_level: 'none' };
  if (bLv === 'low' && fLv === 'low') return { tags: ['低风险'], risk_level: 'low' };
  const tags = [];
  for (const [lv, name] of [[bLv, '业务品质风险'], [fLv, '欺诈风险']]) {
    if (lv === null) tags.push(`${name}·无数据`);
    else tags.push(`${name}·${DIM_LEVEL_TEXT[lv]}`);
  }
  const levels = [bLv, fLv].filter((v) => v && v !== null);
  if (levels.includes('high')) return { tags, risk_level: 'high' };
  if (levels.includes('medium')) return { tags, risk_level: 'medium' };
  // 仅剩低与无数据组合：有无数据维度在，整船不能标低风险
  return { tags, risk_level: levels.every((v) => v === 'low') ? 'none' : 'low' };
}

// ====================== 规则引擎 ======================

// 规则→风险类型兜底映射（优先读 rules 配置的 risk_type，与《船舶险风险类型梳理.md》7 类体系一致）
const RISK_TYPE_FALLBACK = {
  R1: '欺诈风险', R2: '亏损风险', R3: '道德风险', R4: '风险集中',
  R5: '待核实风险', R6: '信息核实风险',
};
const SOFT_SIGNAL_RISK_TYPE = { S4: '保额异常风险' }; // 软信号→风险类型（仅 S4，其余软信号不改变风险类型展示）

// 赔付率数组（如 ["Z","0","109","Z"]）中数值型年度 >= ratio 的年数
function yearsOverRatio(arr, ratio) {
  if (!Array.isArray(arr)) return 0;
  return arr.filter((v) => {
    const n = Number(v);
    return !Number.isNaN(n) && n >= ratio;
  }).length;
}

function maxRatio(arr) {
  if (!Array.isArray(arr)) return null;
  const nums = arr.map((v) => Number(v)).filter((n) => !Number.isNaN(n));
  return nums.length ? Math.max(...nums) : null;
}

// 逐险种评估，输出命中规则明细
export function evaluate(policies, rules = loadRules()) {
  const hits = [];
  const R = rules.rules;

  for (const p of policies || []) {
    const sub = p.insurance_subtype || '未知险种';

    // R1 倒签单嫌疑：起保当月出险占比超阈值
    const e1 = p.early_ratio_1m;
    if (e1 && typeof e1.pct === 'number' && e1.pct >= R.R1.threshold.min_pct) {
      hits.push({
        rule: 'R1', name: R.R1.name, level: R.R1.level, risk_type: R.R1.risk_type || RISK_TYPE_FALLBACK.R1, subtype: sub,
        detail: `${sub}：近1年起保当月出险保单 ${e1.count} 单、占比 ${e1.pct}%（阈值 ${R.R1.threshold.min_pct}%）`,
      });
    }

    // R2 高赔付风险：满期赔付率（已决+未决）多个年度超阈值
    const y2 = yearsOverRatio(p.loss_ratio_total, R.R2.threshold.ratio);
    if (y2 >= R.R2.threshold.years) {
      hits.push({
        rule: 'R2', name: R.R2.name, level: R.R2.level, risk_type: R.R2.risk_type || RISK_TYPE_FALLBACK.R2, subtype: sub,
        detail: `${sub}：满期赔付率（已决+未决）有 ${y2} 个年度 ≥ ${R.R2.threshold.ratio}%（如 ${JSON.stringify(p.loss_ratio_total)}）`,
      });
    }

    // R3 频繁转保
    if (typeof p.insurer_count_3y === 'number' && p.insurer_count_3y >= R.R3.threshold.count) {
      hits.push({
        rule: 'R3', name: R.R3.name, level: R.R3.level, risk_type: R.R3.risk_type || RISK_TYPE_FALLBACK.R3, subtype: sub,
        detail: `${sub}：近3年保单涉及 ${p.insurer_count_3y} 家保险公司（阈值 ${R.R3.threshold.count} 家）`,
      });
    }

    // R4 出险原因集中
    const items = p.accident_causes?.items;
    if (Array.isArray(items)) {
      for (const it of items) {
        if (it.count >= R.R4.threshold.same_cause_count) {
          hits.push({
            rule: 'R4', name: R.R4.name, level: R.R4.level, risk_type: R.R4.risk_type || RISK_TYPE_FALLBACK.R4, subtype: sub,
            detail: `${sub}：出险原因「${it.cause}」近3年出现 ${it.count} 次`,
          });
        }
      }
    }

    // R5 赔案金额异常：存在赔案记录即提示人工复核
    if (p.claim_amounts || p.claim_ranges) {
      const amt = p.claim_amounts?.raw || '';
      const rng = p.claim_ranges?.raw || '';
      hits.push({
        rule: 'R5', name: R.R5.name, level: R.R5.level, risk_type: R.R5.risk_type || RISK_TYPE_FALLBACK.R5, subtype: sub,
        detail: `${sub}：存在赔案记录${amt ? `（赔案金额：${amt}）` : ''}${rng ? `（赔案区间：${rng}）` : ''}，建议人工复核明细`,
      });
    }
  }

  // R6 无行业承保记录：全部险种均无赔付率数据或全为 Z
  const ps = policies || [];
  if (ps.length && ps.every((p) => {
    const allZ = (a) => Array.isArray(a) && a.length > 0 && a.every((v) => v === 'Z');
    return (p.loss_ratio_paid == null && p.loss_ratio_total == null)
      || allZ(p.loss_ratio_paid) || allZ(p.loss_ratio_total);
  })) {
    hits.push({
      rule: 'R6', name: R.R6.name, level: R.R6.level, risk_type: R.R6.risk_type || RISK_TYPE_FALLBACK.R6, subtype: '全部险种',
      detail: '该船近3年无行业承保理赔记录（各险种赔付率均为 Z 或空），投保信息真实性需人工核实',
    });
  }

  // 风险等级聚合：high > medium > review > notice
  const levelOrder = ['high', 'medium', 'review', 'notice'];
  let riskLevel = 'low';
  for (const lv of levelOrder) {
    if (hits.some((h) => h.level === lv)) { riskLevel = lv; break; }
  }
  return { risk_level: riskLevel, hits, soft_signals: collectSoftSignals(policies || [], rules) };
}

// 风险类型归纳（旧 7 类体系，v1.5 起废弃；保留仅供历史 ai_report 解析兼容）
export function summarizeRiskTypes(evalResult) {
  const types = [];
  for (const h of evalResult?.hits || []) {
    const t = h.risk_type || RISK_TYPE_FALLBACK[h.rule];
    if (t && !types.includes(t)) types.push(t);
  }
  for (const s of evalResult?.soft_signals || []) {
    const t = SOFT_SIGNAL_RISK_TYPE[s.code];
    if (t && !types.includes(t)) types.push(t);
  }
  return types;
}

// ====================== 船讯网船舶档案（报告第一节，v1.6） ======================

const PROFILE_TTL_DAYS = 30; // 档案缓存有效期（天），过期后重新拉取

// 取船舶档案：优先读库缓存（TTL 内），未命中或过期时调船讯网拉取并入库
export async function getShipProfile(shipId, ship) {
  const cached = get('SELECT * FROM ship_profiles WHERE ship_id=?', [shipId]);
  if (cached && cached.fetched_at) {
    const ageDays = (Date.now() - new Date(cached.fetched_at).getTime()) / 86400000;
    if (ageDays < PROFILE_TTL_DAYS) return cached;
  }
  if (!anlanEnabled()) return cached || null;
  const p = await fetchShipProfile(ship);
  if (p) {
    run(
      `INSERT OR REPLACE INTO ship_profiles
       (ship_id, mmsi, name_cn, name_en, regist_number, build_year, ship_age, ship_type, gt, dwt, builder, shipowner, source, fetched_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [shipId, p.mmsi, p.name_cn, p.name_en, p.regist_number, p.build_year ?? null, p.ship_age ?? null,
        p.ship_type, p.gt != null ? String(p.gt) : '', p.dwt != null ? String(p.dwt) : '',
        p.builder, p.shipowner, p.source, p.fetched_at],
    );
    return get('SELECT * FROM ship_profiles WHERE ship_id=?', [shipId]);
  }
  return cached || null;
}

// ====================== LLM 报告生成（DeepSeek） ======================

function deepseekConfig() {
  return {
    apiKey: process.env.DEEPSEEK_API_KEY || '',
    baseUrl: (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/, ''),
    model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
  };
}

export function llmAvailable() {
  return !!deepseekConfig().apiKey;
}

function buildLlmPrompt(ship, policies, evalResult, profile, archive) {
  const arc = archive || buildArchive(ship, profile);
  const conditions = {
    船舶识别号: ship.ship_id_no, IMO号: ship.imo_no,
    船舶中文名称: ship.name_cn, 船舶英文名称: ship.name_en,
  };
  // 船舶档案：查到就展示（null 字段不传，指示 LLM 跳过该行）
  const 船舶档案 = {
    船舶名称: `${arc.shipName}${arc.nameNote}`,
    ...(arc.registNumber ? { 船舶识别号: arc.registNumber } : {}),
    ...(arc.buildYear != null ? { 建造年份: arc.buildYear } : {}),
    ...(arc.shipAge != null ? { 船龄: `${arc.shipAge}年` } : {}),
    ...(arc.shipType ? { 船舶类型: arc.shipType } : {}),
    ...(arc.gt ? { 总吨位GT: arc.gt } : {}),
  };
  const data = policies.map((p) => {
    const rate = computeRate(p.insurance_subtype, p.avg_amount_premium?.amount, p.avg_amount_premium?.premium, arc.gt);
    const est = estUnpaidLoss(p);
    return {
      险种小类: p.insurance_subtype,
      当年及过去3年满期赔付率_已决: p.loss_ratio_paid,
      当年及过去3年满期赔付率_已决未决: p.loss_ratio_total,
      近3年出险原因及数量: p.accident_causes?.raw ?? null,
      近3年赔案金额: p.claim_amounts?.raw ?? null,
      近3年赔案区间及案件数量: p.claim_ranges?.raw ?? null,
      近1年起保当月出险保单数量及占比: p.early_ratio_1m,
      近1年起保2个月出险保单数量及占比: p.early_ratio_2m,
      近1年起保3个月出险保单数量及占比: p.early_ratio_3m,
      近3年保单涉及保险公司数量: p.insurer_count_3y,
      最近保单承保公司全称: insurerName(p.latest_insurer_code) || null,
      近3年单均保额: p.avg_amount_premium?.amount ?? null,
      近3年单均保费: p.avg_amount_premium?.premium ?? null,
      ...(rate ? { 单均费率: rate.text } : {}),
      ...(est ? { 未决赔案估损: est.text } : {}),
    };
  });
  const 稳定性判断 = schemeStability(policies);
  return {
    船舶档案, 船舶信息: conditions, 分险种承保与赔付记录: data,
    ...(稳定性判断 ? { 承保方案稳定性参考: 稳定性判断 } : {}),
    规则引擎命中结果: evalResult,
  };
}

// 构造 LLM system prompt：注入字段字典 + 案例范例，让 AI 用专业定义解读、风格对齐人工
// v1.6：输出对齐《船舶险智盾报告模板.docx》六节结构
function buildSystemPrompt() {
  const dict = loadFieldDict();
  const fieldGuide = (dict.fields || [])
    .map((f) => `· ${f.name}：${f.interpretation || f.definition || ''}`)
    .join('\n');
  const caseExample = loadCaseExample().slice(0, 1500);
  return [
    '你是船舶保险反欺诈风控专家，为保险公司核保人生成风险解读报告。',
    '',
    '【字段含义与取值语义】务必按以下定义解读，不得臆测：',
    `统计区间：${dict.statistic_range || '当年及过去3年'}`,
    fieldGuide,
    '',
    '【解读思路参考】以下为人工核保人的解读案例，请对齐其专业风格与判断逻辑：',
    caseExample,
    '',
    '【硬性约束（核保人审阅意见，违反即返工）】',
    '① 禁用倍数换算表述：不得写「估损金额约为满期保费的X倍」，直接给绝对值（如「估损金额约44万元（估算值，仅供参考，实际以理赔系统立案估损为准）」）；',
    '② 正文不出现保险机构代码，只写机构全称（输入已译为全称，直接使用）；',
    '③ 正文不写评级依据，第五节只给评级结果（依据文字不得出现在任何章节）；',
    '④ 档案与各节字段查到就展示、查不到就不展示：输入中未提供的字段直接跳过不写，禁止写「请人工核实」「无数据」「待补充」等提示语；',
    '⑤ 不把 IMO 号缺失列为核保建议；',
    '⑥ 过往3年无投保记录的船不能认定为优质标的，需提示缺乏数据支撑、建议补充尽调；',
    '',
    '【输出要求】严格按以下六节结构输出 Markdown 报告（章节标题用「一、二、三…」，不额外增删章节）：',
    '「{查询船名}」智盾解读（标题，用船舶信息.船舶中文名称，非船讯网现名）',
    '一、船舶档案：逐行回填输入中的「船舶档案」字段——船舶名称一行、船舶识别号另起一行、船龄、船舶类型、总吨位（GT）；输入未提供的字段跳过该行（规则④）；',
    '二、业务品质分析：先一句概括过往3年投保险种；再逐险种用自然语言解读出险次数、出险原因、赔案金额、满期赔付率（Z=该年度无承保记录）；已决为0但已决+未决非0的年度，说明存在尚未结案的未决赔案，并直接引用输入的「未决赔案估损」；本节不出现评级结论与依据；',
    '三、欺诈风险识别：围绕起保早期出险（当月/2个月/3个月）分析；结合保险公司数量解读（1家=客户稳定性较高，2家=存在变更需结合赔付关注，3家及以上=频繁变更重点关注）与最近承保公司；本节不出现评级结论与依据；',
    '四、近3年单均保额保费：逐险种列出单均保额与单均保费（换算为万元），并直接引用输入的「单均费率」（保赔险/油污险为元/GT，其余为‰）；可直接采用输入的「承保方案稳定性参考」段（含定性判断标注，不得删去「非事实陈述」字样）；',
    '五、风险提示：两行固定格式——「业务品质评估：**高/中/低风险**」「欺诈风险评估：**高/中/低风险**」，评级词用**加粗**包裹（导出 Word 时着色）；评级必须严格取输入 evalResult.dimensions 中 business/fraud 的 level 映射（high=高风险/medium=中风险/low=低风险），level 为 null 时必须写「**无数据**」，禁止自行推断或改判任何风险等级；不写任何依据；',
    '六、核保建议：给出明确的承保动作建议（正常承保/加费/限制承保/实地调查/拒保建议）；有未决赔案的（已决为0且已决+未决≥100%）建议核实案情、立案时间、估损依据及处理进展；涉及2家及以上承保公司的建议核实转保原因；evalResult.soft_signals 为软信号（S1-S6），不改变等级评分，逐条融入二、三节分析；',
    '结尾两行：「报告生成日期：' + new Date().toISOString().slice(0, 10) + '」「注：本报告由AI生成，仅供内部参考，不作为最终核保依据。」',
    '语言专业、简洁，总长度 800 字以内。',
  ].join('\n');
}

async function callDeepSeek(ship, policies, evalResult, profile, archive) {
  const cfg = deepseekConfig();
  if (!cfg.apiKey) throw new Error('DEEPSEEK_API_KEY 未配置');

  const system = buildSystemPrompt();
  const user = '请解读以下船舶险反欺诈查询数据：\n' + JSON.stringify(buildLlmPrompt(ship, policies, evalResult, profile, archive), null, 2);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  try {
    const res = await fetch(cfg.baseUrl + '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + cfg.apiKey,
      },
      body: JSON.stringify({
        model: cfg.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0.3,
        max_tokens: 1500,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`DeepSeek HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    const data = await res.json();
    const md = data?.choices?.[0]?.message?.content?.trim();
    if (!md) throw new Error('DeepSeek 返回内容为空');
    return md;
  } finally {
    clearTimeout(timer);
  }
}

// 规则版模板报告（离线兜底，v1.7 全面对齐 ship-zhidun-report skill 文案规则）
// - 档案查到就展示（不写「请人工核实」）；识别号另起一行；船龄用识别号推算
// - 未决估损给绝对值（禁倍数）；机构只写全称；费率分险种口径；方案稳定性定性判断
// - 二/三节纯数据解读（评级结论只在第五节，依据不进正文）
function fallbackReport(ship, policies, evalResult, profile, archive) {
  const sub = (p) => p.insurance_subtype || '未知险种';
  const dim = evalResult.dimensions || {};
  const levelText = (d) => (d?.level ? `${DIM_LEVEL_TEXT[d.level]}风险` : '无数据');
  const ps = policies || [];
  const arc = archive || buildArchive(ship, profile);
  const shipName = arc.shipName;
  const lines = [];

  lines.push(`# 「${shipName}」智盾解读`);
  lines.push('');

  // 一、船舶档案：查到就展示、查不到就不展示（识别号另起一行，v1.7）
  lines.push('## 一、船舶档案');
  lines.push(`船舶名称：${shipName}${arc.nameNote}`);
  if (arc.registNumber) lines.push(`船舶识别号：${arc.registNumber}`);
  if (arc.shipAge != null) lines.push(`船龄：${arc.shipAge}年`);
  if (arc.shipType) lines.push(`船舶类型：${arc.shipType}`);
  if (arc.gt) lines.push(`总吨位（GT）：${arc.gt}`);
  lines.push('');

  // 二、业务品质分析（纯数据解读，无评级结论）
  lines.push('## 二、业务品质分析');
  if (!ps.length) {
    lines.push(`${shipName}过往3年无投保记录，无承保理赔数据可供业务品质分析。`);
  } else {
    lines.push(`过往3年投保的险种分别为${ps.map(sub).join('、')}。`);
    for (const p of ps) {
      const lt = Array.isArray(p.loss_ratio_total) ? p.loss_ratio_total : [];
      const lp = Array.isArray(p.loss_ratio_paid) ? p.loss_ratio_paid : [];
      const causes = p.accident_causes?.items || [];
      const causeN = causes.reduce((n, it) => n + (it.count || 0), 0);
      const parts = [];
      if (causeN) {
        const causeNames = causes.map((it) => it.cause).join('、');
        parts.push(`近3年共出险${causeN}次，出险原因为${causeNames}`);
        if (p.claim_amounts?.raw) parts.push(`累计赔案金额为${p.claim_amounts.raw}元`);
        if (p.claim_ranges?.raw) parts.push(`赔案分布：${p.claim_ranges.raw}`);
      } else {
        parts.push('近3年无出险记录');
      }
      // 逐年赔付率；已决为 0 但已决+未决非 0 → 未决赔案 + 估损绝对值
      const year = new Date().getFullYear();
      const yearLabels = [year, year - 1, year - 2, year - 3];
      for (let i = 0; i < lt.length; i++) {
        const t = Number(lt[i]);
        if (Number.isNaN(t) || lt[i] === 'Z') continue;
        const s = Number(lp[i]);
        const settled = !Number.isNaN(s) ? s : null;
        if (settled === 0 && t > 0) {
          parts.push(`${yearLabels[i]}年保单年度已决+未决满期赔付率为${t}%、已决赔付率为0，表明该年度存在尚未结案的未决赔案`);
          const est = estUnpaidLoss(p);
          if (est) parts.push(est.text);
        } else if (settled != null && t !== settled) {
          parts.push(`${yearLabels[i]}年保单年度已决满期赔付率为${settled}%、已决+未决为${t}%，约${Math.round(t - settled)}个百分点来自立案未决的估损`);
        } else if (settled != null && settled > 0) {
          parts.push(`${yearLabels[i]}年保单年度已决满期赔付率为${settled}%`);
        }
      }
      lines.push(`${sub(p)}：${parts.join('；')}。`);
    }
  }
  lines.push('');

  // 三、欺诈风险识别（起保早期出险 + 保险公司数量解读，无评级结论）
  lines.push('## 三、欺诈风险识别');
  if (!ps.length) {
    lines.push(`${shipName}过往3年无投保记录，无起保出险数据可供欺诈风险识别。`);
  } else {
    const eAllZero = ps.every((p) => {
      const zero = (e) => e && e.count === 0;
      return zero(p.early_ratio_1m) && zero(p.early_ratio_2m) && zero(p.early_ratio_3m);
    });
    if (eAllZero) {
      lines.push(`${shipName}近1年起保当月、起保2个月、起保3个月内出险保单数量及占比均为「0,0.00%」，即近1年起保的保单未在起保3个月内出险。`);
    } else {
      for (const p of ps) {
        const parts = [];
        for (const [key, label] of [['early_ratio_1m', '当月'], ['early_ratio_2m', '2个月'], ['early_ratio_3m', '3个月']]) {
          const e = p[key];
          if (e && e.count > 0) parts.push(`起保${label}出险${e.count}单、占比${e.pct}%`);
        }
        if (parts.length) lines.push(`${sub(p)}：近1年存在${parts.join('、')}的情形，需重点核查出险时点与起保时点的关系。`);
      }
    }
    for (const p of ps) {
      const cnt = Number(p.insurer_count_3y);
      if (cnt && !Number.isNaN(cnt)) {
        const note = insurerCountNote(cnt);
        const name = p.latest_insurer_code ? insurerName(p.latest_insurer_code) : '';
        lines.push(`近3年保单涉及保险公司数量为${cnt}家，${note}${name ? `，最近一张保单由${name}承保` : ''}。`);
      }
    }
  }
  lines.push('');

  // 四、近3年单均保额保费（含分险种费率 + 方案稳定性定性判断）
  lines.push('## 四、近3年单均保额保费');
  if (!ps.length) {
    lines.push(`${shipName}过往3年无投保记录，无单均保额保费数据。`);
  } else {
    for (const p of ps) {
      const ap = p.avg_amount_premium;
      const a = Number(ap?.amount);
      const m = Number(ap?.premium);
      if (!a || !m || Number.isNaN(a) || Number.isNaN(m)) {
        lines.push(`${sub(p)}：无单均保额保费数据。`);
        continue;
      }
      const rate = computeRate(p.insurance_subtype, a, m, arc.gt);
      let seg = `单均保额为${wan(a)}万，单均保费为${wan(m)}万`;
      if (rate) {
        seg += /保赔|油污/.test(sub(p)) ? `，按总吨位${arc.gt}GT计算，单均费率约为${rate.text}` : `，单均费率约为${rate.text}`;
      } else if (/保赔|油污/.test(sub(p))) {
        seg += '。因查询结果未返回总吨位（GT），暂无法计算「元/GT」口径费率';
      }
      lines.push(`${sub(p)}：${seg}。`);
    }
    const stability = schemeStability(ps);
    if (stability) lines.push(stability);
  }
  lines.push('');

  // 五、风险提示：只给评级结果（无数据 → 灰），不写依据
  lines.push('## 五、风险提示');
  lines.push(`业务品质评估：**${levelText(dim.business)}**`);
  lines.push(`欺诈风险评估：**${levelText(dim.fraud)}**`);
  lines.push('');

  // 六、核保建议（结构化：未决赔案核实 / 转保核实 / 无数据提示 / 按等级建议）
  lines.push('## 六、核保建议');
  const tips = [];
  let i = 0;
  for (const p of ps) {
    const lt = Array.isArray(p.loss_ratio_total) ? p.loss_ratio_total : [];
    const lp = Array.isArray(p.loss_ratio_paid) ? p.loss_ratio_paid : [];
    const year = new Date().getFullYear();
    for (let k = 0; k < lt.length; k++) {
      const t = Number(lt[k]);
      const s = Number(lp[k]);
      if (!Number.isNaN(t) && t >= 100 && (Number.isNaN(s) || s === 0)) {
        i += 1;
        tips.push(`${i}、${sub(p)}${[year, year - 1, year - 2, year - 3][k]}年保单年度存在${Math.round(t)}%的未决赔付率且已决为0，建议重点核实该未决赔案的案情、立案时间、估损依据及当前处理进展；`);
        break;
      }
    }
  }
  for (const p of ps) {
    const cnt = Number(p.insurer_count_3y);
    if (cnt >= 2) {
      i += 1;
      const name = p.latest_insurer_code ? `由${insurerName(p.latest_insurer_code)}承保` : '承保';
      tips.push(`${i}、该船近3年在${cnt}家保险公司投保，最近一张保单${name}，建议核实转保原因，关注是否存在出险后转保的情形；`);
      break;
    }
  }
  if (!ps.length) {
    i += 1;
    tips.push(`${i}、该船过往3年无投保记录，缺乏历史赔付与承保数据，不能据此认定为优质标的，建议通过船舶登记信息、船级社记录及客户访谈补充尽调后再作承保判断；`);
  }
  if (evalResult.risk_level === 'high') {
    i += 1;
    tips.push(`${i}、${shipName}存在高风险维度，建议先行实地调查或要求投保人补充佐证材料，必要时限制承保或拒保。`);
  } else if (evalResult.risk_level === 'medium') {
    i += 1;
    tips.push(`${i}、${shipName}存在中风险维度，建议加费承保或设置免赔/限制条件，并人工复核相关记录。`);
  } else if (!tips.length) {
    tips.push(`1、该船历史赔付表现良好，未见明显异常，建议按常规流程核保。`);
  }
  for (const t of tips) lines.push(t);
  lines.push('');

  lines.push(`报告生成日期：${new Date().toISOString().slice(0, 10)}`);
  lines.push('注：本报告由AI生成，仅供内部参考，不作为最终核保依据。');
  return lines.join('\n');
}

// 生成报告：LLM 优先，失败自动降级规则版
export async function generateReport(ship, policies, evalResult, profile = null) {
  const archive = buildArchive(ship, profile);
  let md = null;
  let model = 'rule-based';
  if (llmAvailable()) {
    try {
      md = await callDeepSeek(ship, policies, evalResult, profile, archive);
      model = deepseekConfig().model;
    } catch (e) {
      console.warn(`[interpret] LLM 生成失败，降级为规则版报告: ${e.message}`);
      md = null;
    }
  }
  if (!md) md = fallbackReport(ship, policies, evalResult, profile, archive);
  return { report_md: md, model };
}

// ====================== 入口：为指定船舶生成解读并落库 ======================

// 载入某船舶的全部险种记录（复合 JSON 字段已解析）
function loadPolicies(shipId) {
  return all('SELECT * FROM ship_policy_results WHERE ship_id=? ORDER BY id', [shipId])
    .map((p) => ({
      ...p,
      loss_ratio_paid: p.loss_ratio_paid ? JSON.parse(p.loss_ratio_paid) : null,
      loss_ratio_total: p.loss_ratio_total ? JSON.parse(p.loss_ratio_total) : null,
      accident_causes: p.accident_causes ? JSON.parse(p.accident_causes) : null,
      early_ratio_1m: p.early_ratio_1m ? JSON.parse(p.early_ratio_1m) : null,
      early_ratio_2m: p.early_ratio_2m ? JSON.parse(p.early_ratio_2m) : null,
      early_ratio_3m: p.early_ratio_3m ? JSON.parse(p.early_ratio_3m) : null,
      avg_amount_premium: p.avg_amount_premium ? JSON.parse(p.avg_amount_premium) : null,
      raw: p.raw_json ? JSON.parse(p.raw_json) : {},
    }));
}

export async function runInterpretForShip(shipId) {
  const ship = get('SELECT * FROM ships WHERE id=?', [shipId]);
  if (!ship) throw new Error(`船舶不存在: ${shipId}`);
  const policies = loadPolicies(shipId);

  // v1.5：双维度评估（业务品质/欺诈）驱动风险标签与等级；R1-R6 规则命中与软信号保留供报告解释
  const dim = evaluateRiskDimensions(policies);
  const ds = dimensionSummary(dim);
  const base = evaluate(policies);
  const evalResult = { ...base, risk_level: ds.risk_level, tags: ds.tags, dimensions: dim };
  // v1.6：第一节船舶档案（船讯网，带库缓存）
  const profile = await getShipProfile(shipId, ship);
  const { report_md, model } = await generateReport(ship, policies, evalResult, profile);
  const now = new Date().toISOString();

  run(
    `INSERT INTO ai_reports (ship_id, risk_level, rule_hits_json, report_md, report_json, model, generated_at)
     VALUES (?,?,?,?,?,?,?)`,
    [shipId, ds.risk_level, JSON.stringify(evalResult.hits), report_md,
      JSON.stringify({ summary: base, risk_types: ds.tags, dimensions: dim }), model, now],
  );
  run('UPDATE ships SET latest_risk_level=?, latest_risk_types=? WHERE id=?',
    [ds.risk_level, JSON.stringify(ds.tags), shipId]);
  return { shipId, risk_level: ds.risk_level, risk_types: ds.tags, dimensions: dim, hits: evalResult.hits, model };
}

// v1.5：全量重算风险维度标签（风险类型体系切换后历史数据迁移；幂等，每次启动执行，纯读库计算）
export function recomputeRiskDimensions() {
  const rows = all('SELECT id FROM ships');
  let n = 0;
  for (const { id } of rows) {
    const policies = loadPolicies(id);
    const ds = dimensionSummary(evaluateRiskDimensions(policies));
    run('UPDATE ships SET latest_risk_level=?, latest_risk_types=? WHERE id=?',
      [ds.risk_level, JSON.stringify(ds.tags), id]);
    n += 1;
  }
  if (n) console.log(`[interpret] 已按双维度体系重算 ${n} 艘船舶的风险标签`);
  return n;
}
