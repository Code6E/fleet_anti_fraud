// 登录与机构体系（v3.1：三级角色账号）
// 支持两种模式：
//  - 多用户模式：环境变量 USERS 为 JSON 数组 [{username,password,org,role,parent_org?}, ...]
//      role: 'org'=分公司账号（可见本分公司及其所属中支机构数据）
//           | 'sub_org'=中支机构账号（仅可见本中支数据，需配 parent_org 指向所属分公司 org）
//           | 'admin'=管理员账号（全局可见 + 运维功能）
//      parent_org: 仅 sub_org 有效，声明中支机构归属的分公司 org
//  - 单口令模式：仅配置 APP_PASSWORD，视为管理员
//  - 无鉴权模式：未配置任何口令，视为管理员（仅建议本地调试）
import crypto from 'crypto';

function parseUsers() {
  const raw = process.env.USERS;
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function secret() {
  return process.env.APP_PASSWORD || 'no-auth-secret';
}

// 角色归一化：admin / sub_org 之外一律视为 org（分公司）
function normalizeRole(r) {
  if (r === 'admin') return 'admin';
  if (r === 'sub_org') return 'sub_org';
  return 'org';
}

// ====================== 机构层级 helper（v3.1 三级账号） ======================

// 指定分公司的全部中支机构 org 列表（从 USERS 配置推导，去重）
export function orgChildren(branchOrg) {
  if (!branchOrg) return [];
  const subs = parseUsers()
    .filter((u) => u.parent_org === branchOrg)
    .map((u) => u.org);
  return [...new Set(subs)];
}

// 指定 org 的上级分公司 org（无上级返回 null；中支机构 → 所属分公司）
export function orgParent(org) {
  const u = parseUsers().find((x) => x.org === org && x.parent_org && x.parent_org !== org);
  return u ? u.parent_org : null;
}

// 机构家族：分公司 → [自己 + 全部中支]；中支 → [自己]（用于文件级汇总导出与结果回填匹配）
export function orgFamily(org) {
  if (!org) return [];
  const parent = orgParent(org);
  if (parent) return [org]; // 中支机构自成一家（汇总归入分公司由 branchOf 处理）
  return [org, ...orgChildren(org)];
}

// 汇总导出归属的分公司 org：中支 → 所属分公司；分公司/无层级 → 自身
export function branchOf(org) {
  return orgParent(org) || org;
}

// 用户可见 org 范围：admin → null（全部）；分公司 → [本分公司 + 所属中支]；中支 → [本中支]
export function visibleOrgs(user) {
  if (!user || user.role === 'admin') return null;
  if (user.role === 'sub_org') return [user.org];
  return orgFamily(user.org);
}

// 总公司 org：用于"全机构汇总成总公司单文件"上传（v1.3f）
// 优先取 USERS 中 role=admin 的 org；无 admin 账号时 fallback 到 DEFAULT_ORG / '总公司'
export function hqOrg() {
  const admin = parseUsers().find((u) => normalizeRole(u.role) === 'admin');
  return (admin && admin.org) || process.env.DEFAULT_ORG || '总公司';
}

export function authRequired() {
  const users = parseUsers();
  if (users.length) return true;
  return !!process.env.APP_PASSWORD;
}

function sign(payloadB64) {
  return crypto.createHmac('sha256', secret()).update(payloadB64).digest('base64url');
}

function makeToken(username, org, role, parentOrg = '') {
  const payload = Buffer.from(JSON.stringify({ username, org, role, parent_org: parentOrg, iat: Date.now() })).toString('base64url');
  return payload + '.' + sign(payload);
}

export function verifyToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [payloadB64, sig] = token.split('.');
  const expected = sign(payloadB64);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  if (!crypto.timingSafeEqual(a, b)) return null;
  try {
    return JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

// POST /api/auth/login
export function handleLogin(req, res) {
  const { username, password } = req.body || {};
  const users = parseUsers();

  if (users.length) {
    const u = users.find((x) => x.username === username && x.password === password);
    if (!u) return res.status(401).json({ status: 'error', message: '用户名或口令错误' });
    const role = normalizeRole(u.role);
    // 中支机构账号必须有上级分公司；缺失时拒绝登录（避免数据归属不明）
    if (role === 'sub_org' && !u.parent_org) {
      return res.status(400).json({ status: 'error', message: '该账号未配置所属分公司（parent_org），请联系管理员' });
    }
    const parentOrg = role === 'sub_org' ? u.parent_org : '';
    const token = makeToken(u.username, u.org, role, parentOrg);
    return res.json({ status: 'ok', token, username: u.username, org: u.org, role, parent_org: parentOrg, authRequired: true });
  }

  if (process.env.APP_PASSWORD) {
    if (password !== process.env.APP_PASSWORD) {
      return res.status(401).json({ status: 'error', message: '口令错误' });
    }
    const org = process.env.DEFAULT_ORG || 'DEFAULT';
    const token = makeToken('admin', org, 'admin');
    return res.json({ status: 'ok', token, username: 'admin', org, role: 'admin', authRequired: true });
  }

  // 无鉴权（本地调试）：管理员身份
  const token = makeToken('anonymous', 'DEFAULT', 'admin');
  return res.json({ status: 'ok', token, username: 'anonymous', org: 'DEFAULT', role: 'admin', authRequired: false });
}

export function handleAuthRequired(req, res) {
  res.json({ required: authRequired() });
}

export function authMiddleware(req, res, next) {
  if (!authRequired()) {
    req.user = { username: 'anonymous', org: 'DEFAULT', role: 'admin' };
    return next();
  }
  const h = req.headers['authorization'] || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  const payload = verifyToken(token);
  if (!payload) return res.status(401).json({ status: 'error', message: '未授权，请先登录' });
  req.user = {
    username: payload.username,
    org: payload.org,
    role: normalizeRole(payload.role),
    parent_org: payload.parent_org || '',
  };
  next();
}

// 路由守卫：仅管理员
export function adminOnly(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ status: 'error', message: '该操作仅管理员可执行' });
  }
  next();
}
