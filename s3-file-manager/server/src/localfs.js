// 本地文件系统存储后端：与 s3.js 提供完全相同的接口。
// 用途：脱离公司内网时，用「本地S3数据库」（从生产桶拉取的离线镜像）调试整个应用。
// 目录布局镜像 S3 桶：upload/、download/、root/（root/ 对应 S3 根目录散落的文件）。
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { pipeline } from 'stream/promises';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 根目录：默认 <工作区>/本地S3数据库（server/src 上三级），可用 LOCAL_DB_PATH 覆盖（相对路径按启动目录解析）
const configured = (process.env.LOCAL_DB_PATH || '').trim();
export const LOCAL_ROOT = configured
  ? path.resolve(process.cwd(), configured)
  : path.resolve(__dirname, '..', '..', '..', '本地S3数据库');

const MIME = {
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.pdf': 'application/pdf',
};

// 该后端是否可用（根目录存在）
export function isAvailable() {
  try {
    return fs.statSync(LOCAL_ROOT).isDirectory();
  } catch {
    return false;
  }
}

// S3 key（posix 风格）→ 本地绝对路径，并做越界（路径穿越）保护
function toAbs(key) {
  const rel = String(key || '').replace(/^\/+/, '');
  const abs = path.resolve(LOCAL_ROOT, rel);
  if (abs !== LOCAL_ROOT && !abs.startsWith(LOCAL_ROOT + path.sep)) {
    throw new Error('非法路径：' + key);
  }
  return abs;
}

function contentTypeOf(key) {
  return MIME[path.extname(String(key)).toLowerCase()] || 'application/octet-stream';
}

// 列出某前缀下的"当前层级"内容：目录折叠为 folder（key 带尾斜杠，与 S3 语义一致）
export async function listObjects(prefix = '') {
  const p = prefix.endsWith('/') || prefix === '' ? prefix : prefix + '/';
  const abs = toAbs(p);
  let entries;
  try {
    entries = await fsp.readdir(abs, { withFileTypes: true });
  } catch (e) {
    if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return { prefix: p, folders: [], files: [] };
    throw e;
  }
  const folders = [];
  const files = [];
  for (const e of entries) {
    if (e.isDirectory()) {
      folders.push({
        type: 'folder',
        key: p + e.name + '/',
        name: e.name,
      });
    } else if (e.isFile()) {
      const st = await fsp.stat(path.join(abs, e.name));
      files.push({
        type: 'file',
        key: p + e.name,
        name: e.name,
        size: st.size,
        lastModified: st.mtime.toISOString(),
      });
    }
  }
  folders.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  files.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  return { prefix: p, folders, files };
}

// 递归列出某前缀下所有"文件"的 key（不含目录；用于文件夹删除/重命名）
export async function listAllKeys(prefix) {
  const keys = [];
  async function walk(dirAbs, relPrefix) {
    let entries;
    try {
      entries = await fsp.readdir(dirAbs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        await walk(path.join(dirAbs, e.name), relPrefix + e.name + '/');
      } else if (e.isFile()) {
        keys.push(relPrefix + e.name);
      }
    }
  }
  await walk(toAbs(prefix), String(prefix || '').replace(/^\/+/, ''));
  return keys;
}

// 下载：返回 fs ReadStream（有 .pipe，与 s3.js 的 stream 分支一致）
export async function getObject(key) {
  const abs = toAbs(key);
  let st;
  try {
    st = await fsp.stat(abs);
  } catch {
    const e = new Error('The specified key does not exist.');
    e.name = 'NoSuchKey';
    throw e;
  }
  if (!st.isFile()) {
    const e = new Error('The specified key does not exist.');
    e.name = 'NoSuchKey';
    throw e;
  }
  return {
    stream: fs.createReadStream(abs),
    rawBody: null,
    contentType: contentTypeOf(key),
    contentLength: st.size,
    fileName: path.basename(String(key)),
  };
}

// 上传：Buffer/字符串直接写；空内容视为"目录占位"（等价 S3 的 key 以 / 结尾的空对象）
export async function putObject(key, body, _contentType) {
  const abs = toAbs(key);
  if (body == null || body === '') {
    await fsp.mkdir(abs, { recursive: true });
    return;
  }
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  if (Buffer.isBuffer(body) || typeof body === 'string' || body instanceof Uint8Array) {
    await fsp.writeFile(abs, body);
  } else {
    // 流式写入（与 s3.js 一样接受任意 Body）
    await pipeline(body, fs.createWriteStream(abs));
  }
}

export async function deleteObject(key) {
  const abs = toAbs(key);
  try {
    if (String(key).endsWith('/')) {
      await fsp.rmdir(abs); // 目录占位：仅当为空目录时删除（S3 同样只删占位对象）
    } else {
      await fsp.unlink(abs);
    }
  } catch (e) {
    if (e.code !== 'ENOENT' && e.code !== 'ENOTEMPTY' && e.code !== 'EPERM' && e.code !== 'EEXIST') throw e;
  }
}

// 删除文件夹：递归删除，返回删除的文件数（与 s3.js 返回口径一致）
export async function deleteFolder(prefix) {
  const abs = toAbs(prefix);
  let count = 0;
  try {
    count = (await listAllKeys(String(prefix || '').replace(/^\/+/, ''))).length;
  } catch { /* 目录不存在则计 0 */ }
  try {
    await fsp.rm(abs, { recursive: true, force: true });
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  return count;
}

export async function copyObject(srcKey, destKey) {
  const src = toAbs(srcKey);
  const dest = toAbs(destKey);
  if (String(srcKey).endsWith('/')) {
    await fsp.mkdir(dest, { recursive: true }); // 文件夹占位的复制 = 建目录
    return;
  }
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  await fsp.copyFile(src, dest);
}

// 新建文件夹：本地直接 mkdir（无需占位对象）
export async function createFolder(prefix, name) {
  const base = prefix.endsWith('/') ? prefix : (prefix ? prefix + '/' : '');
  const key = base + name.replace(/\/+$/, '') + '/';
  await fsp.mkdir(toAbs(key), { recursive: true });
  return key;
}
