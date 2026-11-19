// 船讯网（安岚科技 cic.anlantech.cn）客户端
// 用于报告第一节「船舶档案」：登录后按船名/MMSI/IMO 搜索船舶，取船舶基本信息
// （船舶识别号 / 船龄 / 船舶类型 / 总吨位）。
// - 会话为 Cookie（SESSION），内存缓存，失效（403）自动重登一次
// - 密码按站点前端逻辑 SHA-512 后提交，账号密码经环境变量注入（.env）
// - 接口为逆向非公开 API，任何失败均返回 null（不抛错），报告降级为「未获取档案」
import crypto from 'crypto';

const BASE_URL = (process.env.ANLAN_BASE_URL || 'https://cic.anlantech.cn').replace(/\/+$/, '');
const TIMEOUT_MS = 15000;

let sessionCookie = null; // "SESSION=xxx"

export function anlanEnabled() {
  return !!(process.env.ANLAN_USERNAME && process.env.ANLAN_PASSWORD);
}

function sha512(s) {
  return crypto.createHash('sha512').update(s, 'utf8').digest('hex');
}

async function apiFetch(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    if (sessionCookie) headers.Cookie = sessionCookie;
    const res = await fetch(BASE_URL + path, {
      ...options,
      headers,
      credentials: 'include',
      signal: controller.signal,
    });
    // 捕获 Set-Cookie 维持会话
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) {
      const m = setCookie.match(/SESSION=[^;]+/);
      if (m) sessionCookie = m[0];
    }
    return res;
  } finally {
    clearTimeout(timer);
  }
}

// 登录：成功后 sessionCookie 已更新
async function login() {
  const res = await apiFetch('/api/login', {
    method: 'POST',
    body: JSON.stringify({
      username: process.env.ANLAN_USERNAME,
      password: sha512(process.env.ANLAN_PASSWORD),
    }),
  });
  if (!res.ok) throw new Error(`login HTTP ${res.status}`);
  const data = await res.json().catch(() => null);
  if (!data || data.status !== 0) {
    throw new Error(`login 失败: ${data?.message || '未知错误'}`);
  }
  return true;
}

// 带会话的 GET：403（AuthorizationRequire）时重登一次再试
async function authedGet(path, retried = false) {
  if (!sessionCookie) await login();
  const res = await apiFetch(path);
  if (res.status === 403 && !retried) {
    sessionCookie = null;
    await login();
    return authedGet(path, true);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json().catch(() => null);
  if (!data || data.status !== 0) {
    throw new Error(data?.message || '接口返回异常');
  }
  return data;
}

// 搜索船舶（支持船名/MMSI/IMO/港口名统一关键词）
async function searchShip(keyword) {
  const data = await authedGet(`/api/datacenter/standard/ship/search?keyword=${encodeURIComponent(keyword)}`);
  return data.data || [];
}

// 船舶全量档案
async function getShipInfo(mmsi) {
  const data = await authedGet(`/api/datacenter/standard/ship/info/all?mmsi=${encodeURIComponent(mmsi)}`);
  return data.data || {};
}

// 龙骨日期（unix 秒）→ 船龄（按年粗算）
function keelToAge(ts) {
  if (!ts || typeof ts !== 'number') return null;
  const year = new Date(ts * 1000).getFullYear();
  if (!year || year < 1900) return null;
  const age = new Date().getFullYear() - year;
  return age >= 0 ? age : null;
}

function pickNum(...vals) {
  for (const v of vals) {
    const n = Number(v);
    if (v != null && !Number.isNaN(n) && n > 0) return n;
  }
  return null;
}

// 搜索结果里挑最匹配的一条：优先识别号精确匹配，其次船名匹配，最后第一条
function bestMatch(results, cond) {
  if (!results.length) return null;
  const idNo = (cond.ship_id_no || '').trim();
  const nameCn = (cond.name_cn || '').trim();
  if (idNo) {
    const hit = results.find((r) => (r.registNumber || '').toUpperCase() === idNo.toUpperCase());
    if (hit) return hit;
  }
  if (nameCn) {
    const hit = results.find((r) => (r.nameCn || '') === nameCn || (r.name_cn || '') === nameCn);
    if (hit) return hit;
  }
  return results[0];
}

// 主入口：按船舶四要素查询船讯网档案。任一步失败返回 null（调用方降级处理）。
export async function fetchShipProfile(cond) {
  if (!anlanEnabled()) return null;
  // 关键词优先级：识别号 > IMO > 中文名 > 英文名
  const keyword = (cond.ship_id_no || '').trim()
    || (cond.imo_no && cond.imo_no !== '0' ? cond.imo_no.trim() : '')
    || (cond.name_cn || '').trim()
    || (cond.name_en || '').trim();
  if (!keyword) return null;
  try {
    const results = await searchShip(keyword);
    const matched = bestMatch(results, cond);
    if (!matched || !matched.mmsi) return null;
    const info = await getShipInfo(matched.mmsi);
    const keelTs = Number(info.date_keel_laid) || Number(matched.date_keel_laid) || 0;
    const buildYear = keelTs ? new Date(keelTs * 1000).getFullYear() : null;
    return {
      mmsi: String(matched.mmsi),
      name_cn: info.name_cn || matched.nameCn || matched.name || '',
      name_en: info.name_en || matched.name_en_used || matched.name || '',
      regist_number: info.regist_number || matched.registNumber || '',
      // IMO 号（智能航运风控平台若提供则回填，缺失留空由调用方降级）
      imo_no: String(info.imo || matched.imo || '').trim(),
      build_year: buildYear,
      ship_age: keelToAge(keelTs),
      ship_type: info.pa_subclass || matched.bigTypeName || matched.tinyTypeName || matched.shipTypeOthers || '',
      gt: pickNum(info.gt_final, info.gt, matched.gt),
      dwt: pickNum(info.dwt, matched.dwt),
      builder: info.builder || '',
      shipowner: info.shipowner || matched.shipowner || '',
      source: 'anlan',
      fetched_at: new Date().toISOString(),
    };
  } catch (e) {
    console.warn(`[anlan] 船讯网档案查询失败（${keyword}）: ${e.message}`);
    return null;
  }
}
