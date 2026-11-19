// ---- token 管理 ----
let token = localStorage.getItem('s3fm_token') || '';

export function setToken(t) {
  token = t || '';
  if (token) localStorage.setItem('s3fm_token', token);
  else localStorage.removeItem('s3fm_token');
}

export function getToken() {
  return token;
}

// ---- 通用 fetch 封装 ----
async function request(url, options = {}) {
  const headers = { ...options.headers };
  if (token) headers['Authorization'] = 'Bearer ' + token;

  const res = await fetch(url, {
    ...options,
    headers,
  });

  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);
    return data;
  }
  // 非JSON（如文件下载流）
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res;
}

// ---- API ----
export const api = {
  health: () => request('/api/health').then((d) => d.status === 'ok'),

  authRequired: () =>
    request('/api/auth/required').then((d) => d.required),

  login: (username, password) =>
    request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    }),

  getConfig: () => request('/api/config'),

  // ---- 数据源切换（生产 S3 / 本地S3数据库） ----
  getSource: () => request('/api/source'),
  setSource: (source) =>
    request('/api/source', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source }),
    }),

  // ---- 文件管理 ----
  listFiles: (prefix = '') =>
    request('/api/files?prefix=' + encodeURIComponent(prefix)),

  downloadUrl: (key) => {
    const h = token ? { Authorization: 'Bearer ' + token } : {};
    return request('/api/files/download?key=' + encodeURIComponent(key), { headers: h });
  },

  upload: (prefix, files) => {
    const fd = new FormData();
    for (const f of files) fd.append('files', f);
    return request('/api/files/upload?prefix=' + encodeURIComponent(prefix), {
      method: 'POST',
      body: fd,
    });
  },

  remove: (key, type) =>
    request('/api/files', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, type }),
    }),

  rename: (from, to, type) =>
    request('/api/files/rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, type }),
    }),

  createFolder: (prefix, name) =>
    request('/api/files/folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix, name }),
    }),

  // ---- 当前登录人 / 机构 / 角色 ----
  me: () => request('/api/me'),

  // ---- 船舶查询（三段式：全量库命中弹窗确认（v1.4d） / 未命中新查询入队） ----
  shipQuery: (cond) =>
    request('/api/ships/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cond),
    }),

  shipPending: (cond) =>
    request('/api/ships/pending', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cond),
    }),

  // v1.8：全量库未命中时调用智能航运风控平台船舶档案，供弹窗确认回填
  shipProfile: (cond) =>
    request('/api/ships/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cond),
    }),

  // v1.4d：命中全量库后确认「使用旧数据」——记录本机构命中行为
  shipHit: (shipId) =>
    request('/api/ships/hit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ship_id: shipId }),
    }),

  // v1.4e：命中复用明细（近半年内命中复用的船舶 + 各船历史被哪些机构查询过）
  hitReuse: (days) => request('/api/ships/hit-reuse' + (days ? '?days=' + days : '')),

  // days：仅展示近 N 天记录（我的查询默认近 7 天）；不传则全量
  // v1.5a：filters 对象参数——status/days 沿用旧入参语义，新增 business/fraud 双维度等级筛选（数组多选）
  listShipPending: (filters = {}) => {
    const { status, days, business, fraud } = filters || {};
    const qs = new URLSearchParams();
    if (status) qs.set('status', status);
    if (days) qs.set('days', days);
    if (Array.isArray(business) && business.length) qs.set('business', business.join(','));
    if (Array.isArray(fraud) && fraud.length) qs.set('fraud', fraud.join(','));
    const s = qs.toString();
    return request('/api/ships/pending' + (s ? '?' + s : ''));
  },

  // v1.3i：filters 支持列筛选——name/ship_id_no/imo_no/org 模糊匹配，risk 数组多选，date_from/date_to 时间范围
  listShips: (filters = {}) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(filters || {})) {
      if (v == null || v === '' || (Array.isArray(v) && !v.length)) continue;
      qs.set(k, Array.isArray(v) ? v.join(',') : String(v));
    }
    const s = qs.toString();
    return request('/api/ships' + (s ? '?' + s : ''));
  },

  getShip: (id) => request('/api/ships/' + id),

  // v1.3e：机构运行概览（分公司=本分公司+所属中支；中支=本中支）
  shipOverview: () => request('/api/ships/overview'),

  // v1.3g：单船中银保信返回数据导出 / AI 报告下载 / 人工评价
  shipExportData: (id) => request(`/api/ships/${id}/export-data`),
  shipExportReport: (id) => request(`/api/ships/${id}/export-report`),
  shipFeedback: (id) => request(`/api/ships/${id}/feedback`),
  submitShipFeedback: (id, payload) =>
    request(`/api/ships/${id}/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),

  // ---- 管理员：手动触发 / 日志 / 统计 / 机构配置 / Agent 开关 ----
  exportNow: (org, date) =>
    request('/api/ships/admin/export-now', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ org, date }),
    }),

  importNow: (date) =>
    request('/api/ships/admin/import-now', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date }),
    }),

  // v1.3d：模拟中银保信返回结果（演示用）
  simulateReturn: (date) =>
    request('/api/ships/admin/simulate-return', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date }),
    }),

  adminLogs: (limit = 100) => request('/api/ships/admin/logs?limit=' + limit),
  adminStats: () => request('/api/ships/admin/stats'),
  // v1.3b：全局上传配置（取代机构级 upload_mode/upload_time）
  adminUploadConfig: () => request('/api/ships/admin/upload-config'),
  setAdminUploadConfig: (mode, time) =>
    request('/api/ships/admin/upload-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode, time }),
    }),
  agentEnabled: () => request('/api/ships/admin/agent-enabled'),
  setAgentEnabled: (enabled) =>
    request('/api/ships/admin/agent-enabled', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    }),
};

// ---- 工具 ----
export function formatSize(bytes) {
  if (!bytes || bytes === 0) return '-';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return n.toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
}

export function formatDate(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  return d.toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

export function basename(key) {
  if (!key) return '';
  return key.replace(/\/+$/, '').split('/').pop();
}

export function parentPrefix(prefix) {
  if (!prefix) return '';
  const p = prefix.replace(/\/+$/, '');
  const idx = p.lastIndexOf('/');
  if (idx < 0) return '';
  return p.slice(0, idx + 1);
}

// 风险等级 → 徽章样式
export function riskBadge(level) {
  return {
    high: { text: '高风险', cls: 'risk-high' },
    medium: { text: '中风险', cls: 'risk-medium' },
    review: { text: '需复核', cls: 'risk-review' },
    notice: { text: '提示', cls: 'risk-notice' },
    low: { text: '低风险', cls: 'risk-low' },
    none: { text: '无数据', cls: 'risk-none' },
    '': { text: '未评估', cls: 'risk-none' },
  }[level] || { text: level || '-', cls: 'risk-none' };
}

// 待查询状态 → 文案
export function statusLabel(s) {
  return {
    pending: '待提交',
    exported: '已上传',
    returned: '已返回',
    interpreted: '已解读',
    hit: '全量库命中',
  }[s] || s;
}

// 角色徽章文案（v1.3e 三级账号）
export function roleLabel(role) {
  return {
    admin: '管理员',
    org: '分公司',
    sub_org: '中支机构',
  }[role] || '机构';
}

// 下载响应流为本地文件（v1.3g：弹窗内 Excel/报告下载共用）
export async function saveResponse(res, filename) {
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
