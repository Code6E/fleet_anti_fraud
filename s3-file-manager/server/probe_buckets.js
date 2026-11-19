// 只读探测脚本：列出当前凭证可访问的 S3 桶，并单独探一下 test 桶
// 用法：在 server 目录 node probe_buckets.js
// 注意：本脚本只读取元数据，不会写入/删除任何对象。
import dotenv from 'dotenv';
dotenv.config();

import {
  S3Client,
  ListBucketsCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';

const force = String(process.env.S3_FORCE_PATH_STYLE).toLowerCase() === 'true';
console.log('--- 当前 .env 连接配置 ---');
console.log('S3_ENDPOINT        =', process.env.S3_ENDPOINT || '(空, 走 AWS)');
console.log('S3_REGION          =', process.env.S3_REGION || '(空, 默认 us-east-1)');
console.log('S3_FORCE_PATH_STYLE=', force);
console.log('S3_ACCESS_KEY_ID   =', (process.env.S3_ACCESS_KEY_ID || '').slice(0, 6) + '...');
console.log('S3_BUCKET(仅参考)   =', process.env.S3_BUCKET || '(空)');
console.log('');

const client = new S3Client({
  region: process.env.S3_REGION || 'us-east-1',
  endpoint: process.env.S3_ENDPOINT || undefined,
  forcePathStyle: force,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
  },
});

async function main() {
  // 1) 列出所有可访问的桶
  console.log('--- 1) ListBuckets（列出你这个 Access Key 能看到的全部桶）---');
  try {
    const r = await client.send(new ListBucketsCommand({}));
    if (r.Buckets && r.Buckets.length) {
      console.log('可访问的桶名列表：');
      r.Buckets.forEach((b) => console.log('  •', b.Name));
      console.log(`共 ${r.Buckets.length} 个桶。把其中一个填到 .env 的 S3_BUCKET 即可。`);
    } else {
      console.log('返回为空：该 Access Key 没有任何可列到的桶（可能对方禁用了 ListBuckets 权限）。');
    }
  } catch (e) {
    console.log('ListBuckets 失败：', e.name, '-', e.message);
  }

  // 2) 单独探一下 test 桶（无论上面是否列出）
  console.log('');
  console.log('--- 2) 单独探 test 桶是否可访问 ---');
  try {
    await client.send(new HeadBucketCommand({ Bucket: 'test' }));
    console.log('✅ test 桶可访问 → S3_BUCKET=test 是对的（先前报错应是 path-style 导致）');
    const objs = await client.send(new ListObjectsV2Command({ Bucket: 'test', MaxKeys: 10 }));
    console.log('   test 桶内前 10 个对象：');
    (objs.Contents || []).forEach((o) => console.log('    -', o.Key));
    if (!objs.Contents || objs.Contents.length === 0) console.log('   （桶为空）');
  } catch (e) {
    console.log('❌ test 桶不可访问：', e.name, '-', e.message);
    if (e.name === 'NotFound' || /does not exist/i.test(e.message)) {
      console.log('   → test 这个桶在对方端确实不存在，请在步骤 1 的列表里选真实桶名。');
    }
  }
}

main().catch((e) => {
  console.error('探测脚本异常：', e);
  process.exit(1);
});
