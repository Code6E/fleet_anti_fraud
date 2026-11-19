// 只读探测：先列全部桶，再逐个桶列对象（仅看前若干条，不写不删）
// 用途：帮用户定位哪个桶是“业务桶”（放查询 Excel / result 文件）
// 用法：node probe_buckets_content.js
import dotenv from 'dotenv';
dotenv.config();

import {
  S3Client,
  ListBucketsCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';

// 关键：对每个真实桶用 path-style 列举，否则 virtual-host-style 会请求到不存在的主机
const client = new S3Client({
  region: process.env.S3_REGION || 'us-east-1',
  endpoint: process.env.S3_ENDPOINT || undefined,
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
  },
});

async function listBucketContents(bucket) {
  const r = await client.send(
    new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 20, Delimiter: '/' })
  );
  const files = (r.Contents || []).map((o) => o.Key);
  const folders = (r.CommonPrefixes || []).map((p) => p.Prefix);
  return { files, folders, isTruncated: !!r.IsTruncated };
}

async function main() {
  const buckets = (await client.send(new ListBucketsCommand({}))).Buckets || [];
  console.log(`共 ${buckets.length} 个桶，逐个列举（每个最多 20 条）...\n`);

  for (const b of buckets) {
    const name = b.Name;
    try {
      const { files, folders, isTruncated } = await listBucketContents(name);
      const hasQueries = folders.some((f) => f.toLowerCase().startsWith('queries'));
      const xlsx = files.filter((f) => f.toLowerCase().endsWith('.xlsx'));
      const flag = hasQueries ? '  <== 含 queries/ 目录' : xlsx.length ? `  <== 含 ${xlsx.length} 个 xlsx` : '';
      console.log(`【${name}】${flag}`);
      folders.forEach((f) => console.log(`    📁 ${f}`));
      files.slice(0, 10).forEach((f) => console.log(`    📄 ${f}`));
      if (files.length > 10) console.log(`    … 还有 ${files.length - 10} 个文件${isTruncated ? '（可能更多）' : ''}`);
      if (files.length === 0 && folders.length === 0) console.log('    （空桶）');
    } catch (e) {
      console.log(`【${name}】列举失败：${e.name} - ${e.message}`);
    }
    console.log('');
  }
}

main().catch((e) => {
  console.error('探测异常：', e);
  process.exit(1);
});
