import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  CopyObjectCommand,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import path from 'path';

const client = new S3Client({
  region: process.env.S3_REGION || 'us-east-1',
  endpoint: process.env.S3_ENDPOINT || undefined,
  forcePathStyle: String(process.env.S3_FORCE_PATH_STYLE).toLowerCase() === 'true',
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
  },
});

export const BUCKET = process.env.S3_BUCKET || '';

// 列出某前缀下的“当前层级”内容（用 Delimiter 把子目录折叠成文件夹）
export async function listObjects(prefix = '') {
  const p = prefix.endsWith('/') || prefix === '' ? prefix : prefix + '/';
  const res = await client.send(new ListObjectsV2Command({
    Bucket: BUCKET,
    Prefix: p,
    Delimiter: '/',
  }));
  const folders = (res.CommonPrefixes || []).map((c) => ({
    type: 'folder',
    key: c.Prefix,
    name: c.Prefix.slice(p.length).replace(/\/$/, ''),
  }));
  const files = (res.Contents || [])
    .filter((o) => o.Key !== p) // 跳过“文件夹自身”的占位对象
    .map((o) => ({
      type: 'file',
      key: o.Key,
      name: o.Key.slice(p.length),
      size: o.Size || 0,
      lastModified: o.LastModified ? o.LastModified.toISOString() : null,
    }));
  return { prefix: p, folders, files };
}

// 列出某前缀下的所有对象（用于文件夹删除/重命名，不分页层级）
export async function listAllKeys(prefix) {
  const keys = [];
  let token;
  do {
    const res = await client.send(new ListObjectsV2Command({
      Bucket: BUCKET,
      Prefix: prefix,
      ContinuationToken: token,
    }));
    (res.Contents || []).forEach((o) => keys.push(o.Key));
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

// 下载：返回流与元数据
export async function getObject(key) {
  const res = await client.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  const body = res.Body;
  const isStream = body && typeof body.pipe === 'function';
  return {
    stream: isStream ? body : null,
    rawBody: isStream ? null : body,
    contentType: res.ContentType || 'application/octet-stream',
    contentLength: res.ContentLength,
    fileName: path.basename(key),
  };
}

// 上传（支持大文件分片）
export async function putObject(key, body, contentType) {
  const upload = new Upload({
    client,
    params: { Bucket: BUCKET, Key: key, Body: body, ContentType: contentType },
  });
  await upload.done();
}

export async function deleteObject(key) {
  await client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}

// 删除文件夹：列举全部后批量删除（每批最多 1000）
export async function deleteFolder(prefix) {
  const p = prefix.endsWith('/') ? prefix : prefix + '/';
  const keys = await listAllKeys(p);
  if (keys.length === 0) return 0;
  for (let i = 0; i < keys.length; i += 1000) {
    const batch = keys.slice(i, i + 1000).map((Key) => ({ Key }));
    await client.send(new DeleteObjectsCommand({
      Bucket: BUCKET,
      Delete: { Objects: batch, Quiet: true },
    }));
  }
  return keys.length;
}

export async function copyObject(srcKey, destKey) {
  await client.send(new CopyObjectCommand({
    Bucket: BUCKET,
    CopySource: encodeURIComponent(BUCKET + '/' + srcKey),
    Key: destKey,
  }));
}

// 新建文件夹：写入一个以 '/' 结尾的占位对象
export async function createFolder(prefix, name) {
  const base = prefix.endsWith('/') ? prefix : (prefix ? prefix + '/' : '');
  const key = base + name.replace(/\/+$/, '') + '/';
  await client.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: '' }));
  return key;
}
