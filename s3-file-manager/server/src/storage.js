// 存储门面：在「生产 S3」与「本地S3数据库」两个后端之间运行时切换。
// 所有业务代码（routes/files.js、scheduler.js 等）统一从这里导入存储函数，
// 切换后即刻生效，无需重启服务。
import * as s3 from './s3.js';
import * as localfs from './localfs.js';

const BACKENDS = {
  s3: {
    id: 's3',
    label: '生产 S3',
    available: () => !!s3.BUCKET,
    detail: () => (s3.BUCKET
      ? `${s3.BUCKET} @ ${process.env.S3_ENDPOINT || 'AWS S3'}`
      : 'S3_BUCKET 未配置'),
    api: s3,
  },
  local: {
    id: 'local',
    label: '本地数据库',
    available: () => localfs.isAvailable(),
    detail: () => localfs.LOCAL_ROOT,
    api: localfs,
  },
};

// 启动默认数据源（.env DEFAULT_SOURCE=local 时启动即离线模式），默认生产 S3
let current = process.env.DEFAULT_SOURCE === 'local' ? 'local' : 's3';

export function getSource() {
  return current;
}

// 供前端展示：当前源 + 全部可选源及可用性
export function getSourceInfo() {
  return {
    source: current,
    sources: Object.values(BACKENDS).map((b) => ({
      id: b.id,
      label: b.label,
      available: b.available(),
      detail: b.detail(),
    })),
  };
}

// 切换数据源（运行时生效）
export function setSource(id) {
  const b = BACKENDS[id];
  if (!b) {
    throw new Error(`未知数据源：${id}（可选：${Object.keys(BACKENDS).join(' / ')}）`);
  }
  if (!b.available()) {
    throw new Error(`数据源「${b.label}」不可用：${b.detail()}`);
  }
  current = id;
  return getSourceInfo();
}

// 导出/导入前的就绪检查（scheduler 用）：按当前源校验配置
export function ensureReady() {
  const b = BACKENDS[current];
  if (!b.available()) {
    throw new Error(`当前数据源「${b.label}」不可用：${b.detail()}`);
  }
}

function backend() {
  return BACKENDS[current].api;
}

// 兼容旧引用（如 config 展示桶名）
export const BUCKET = s3.BUCKET;

// ---- 统一代理到当前后端 ----
export const listObjects = (...args) => backend().listObjects(...args);
export const listAllKeys = (...args) => backend().listAllKeys(...args);
export const getObject = (...args) => backend().getObject(...args);
export const putObject = (...args) => backend().putObject(...args);
export const deleteObject = (...args) => backend().deleteObject(...args);
export const deleteFolder = (...args) => backend().deleteFolder(...args);
export const copyObject = (...args) => backend().copyObject(...args);
export const createFolder = (...args) => backend().createFolder(...args);
