import express from 'express';
import multer from 'multer';
import {
  BUCKET, listObjects, getObject, putObject,
  deleteObject, deleteFolder, copyObject, createFolder, listAllKeys,
  getSourceInfo, setSource,
} from '../storage.js';
import { get } from '../db.js';
import { adminOnly } from '../auth.js';

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1024 * 1024 * 500, files: 50 }, // 单文件 500MB，最多 50 个
});

// 机构账号数据隔离：文件按「文件名含本机构分公司名」过滤（数据共享、行为隔离）
// 机构 display_name 取自 org_settings；无配置时用 org 原值兜底
function orgDisplayName(org) {
  const row = get('SELECT display_name FROM org_settings WHERE org=?', [org]);
  return row?.display_name || org;
}

function visibleToOrg(itemName, displayName) {
  return String(itemName || '').includes(displayName);
}

// 配置信息（不含任何密钥）
router.get('/config', (req, res) => {
  res.json({
    status: 'ok',
    bucket: BUCKET,
    endpoint: process.env.S3_ENDPOINT || '(AWS S3)',
    region: process.env.S3_REGION || 'us-east-1',
    authRequired: !!process.env.APP_PASSWORD,
    ...getSourceInfo(),
  });
});

// 数据源：查询当前可选项 / 运行时切换（生产 S3 ↔ 本地S3数据库）——仅管理员
router.get('/source', (req, res) => {
  res.json({ status: 'ok', ...getSourceInfo() });
});

router.post('/source', adminOnly, (req, res) => {
  try {
    const info = setSource((req.body || {}).source);
    res.json({ status: 'ok', ...info });
  } catch (e) {
    res.status(400).json({ status: 'error', message: e.message });
  }
});

// 列表（机构账号：仅见文件名含本机构名的文件；目录结构保留以便导航）
router.get('/files', async (req, res) => {
  try {
    const prefix = typeof req.query.prefix === 'string' ? req.query.prefix : '';
    const data = await listObjects(prefix);
    if (req.user?.role === 'admin') {
      return res.json({ status: 'ok', ...data });
    }
    const dn = orgDisplayName(req.user?.org || '');
    const files = (data.files || []).filter((f) => visibleToOrg(f.name, dn));
    res.json({ status: 'ok', ...data, files, filtered: true, orgFilter: dn });
  } catch (e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// 下载（机构账号：仅可下载文件名含本机构名的文件）
router.get('/files/download', async (req, res) => {
  try {
    const key = req.query.key;
    if (!key) return res.status(400).json({ status: 'error', message: '缺少 key' });
    if (req.user?.role !== 'admin') {
      const dn = orgDisplayName(req.user?.org || '');
      const name = String(key).split('/').pop();
      if (!visibleToOrg(name, dn)) {
        return res.status(403).json({ status: 'error', message: '无权访问其他机构的文件' });
      }
    }
    const { stream, rawBody, contentType, contentLength, fileName } = await getObject(key);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    if (contentLength) res.setHeader('Content-Length', String(contentLength));
    if (stream) return stream.pipe(res);
    const buf = await rawBody.transformToByteArray();
    res.send(Buffer.from(buf));
  } catch (e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// 上传 / 删除 / 重命名 / 新建文件夹：仅管理员
// （upload/download 为中银保信正式通道，由 Agent 统一写入；人工写操作收紧为管理员，避免污染业务目录）
router.post('/files/upload', adminOnly, upload.array('files', 50), async (req, res) => {
  try {
    const prefix = (req.query.prefix && typeof req.query.prefix === 'string') ? req.query.prefix : '';
    const base = prefix.endsWith('/') || prefix === '' ? prefix : prefix + '/';
    const saved = [];
    for (const f of req.files || []) {
      const key = base + f.originalname;
      await putObject(key, f.buffer, f.mimetype || 'application/octet-stream');
      saved.push(key);
    }
    res.json({ status: 'ok', saved });
  } catch (e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

router.delete('/files', adminOnly, async (req, res) => {
  try {
    const { key, type } = req.body || {};
    if (!key) return res.status(400).json({ status: 'error', message: '缺少 key' });
    if (type === 'folder') {
      const n = await deleteFolder(key);
      return res.json({ status: 'ok', deleted: n });
    }
    await deleteObject(key);
    res.json({ status: 'ok', deleted: 1 });
  } catch (e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

router.post('/files/rename', adminOnly, async (req, res) => {
  try {
    const { from, to, type } = req.body || {};
    if (!from || !to) return res.status(400).json({ status: 'error', message: '缺少 from/to' });
    if (type === 'folder') {
      const srcPrefix = from.endsWith('/') ? from : from + '/';
      const destPrefix = to.endsWith('/') ? to : to + '/';
      const keys = await listAllKeys(srcPrefix);
      for (const k of keys) {
        const newKey = destPrefix + k.slice(srcPrefix.length);
        await copyObject(k, newKey);
      }
      if (keys.length > 0) await deleteFolder(srcPrefix);
      else { await copyObject(srcPrefix, destPrefix); await deleteObject(srcPrefix); }
      return res.json({ status: 'ok', copied: keys.length });
    }
    await copyObject(from, to);
    await deleteObject(from);
    res.json({ status: 'ok' });
  } catch (e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

router.post('/files/folder', adminOnly, async (req, res) => {
  try {
    const { prefix, name } = req.body || {};
    if (!name) return res.status(400).json({ status: 'error', message: '缺少 name' });
    const key = await createFolder(prefix || '', name);
    res.json({ status: 'ok', key });
  } catch (e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

export default router;
