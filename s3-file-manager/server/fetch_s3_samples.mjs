// fetch_s3_samples.mjs — 从内网 S3 拉取代表性查询文件，构建本地数据库（脱离内网可调试）
// 用法：cd server && node fetch_s3_samples.mjs [输出目录（默认 ../../../本地S3数据库）]
// 说明：只读下载，不上传不删除；文件清单见下方 SAMPLES。
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env') });

const OUT_DIR = path.resolve(process.argv[2] || path.join(__dirname, '..', '..', '本地S3数据库'));

// ============ 代表性文件清单（S3 key → 本地镜像路径） ============
// 覆盖：船舶/企业两种格式、上传→结果配对、多家分公司、典型脏命名（大写 RESULT、空格、双后缀、.xls、错放目录）
const SAMPLES = [
  // ---- 船舶格式：upload ----
  { key: 'download/船舶_000012_20260624_广东分公司.xlsx', note: '边界:上传文件错放在download目录,配对_result也在download' },
  { key: 'download/船舶_000012_20260625_福建分公司(1).xlsx', note: '边界:上传文件错放在download目录,配对_result也在download' },
  { key: 'upload/船舶_000012_20260507_浙江分公司.xlsx', note: '船舶上传常规样例' },
  { key: 'upload/船舶_000012_20260509_重庆分公司.xlsx', note: '船舶上传常规样例' },
  { key: 'upload/船舶_000012_20260602_天津分公司.xlsx', note: '船舶上传常规样例' },
  { key: 'upload/船舶_000012_20260512_上海分公司 (11).xlsx', note: '边界:文件名含空格和括号序号' },
  { key: 'upload/船舶_000012_20260525_1安徽分公司.xlsx', note: '边界:非规范命名(分公司前加序号)' },
  { key: 'upload/船舶_000012_202605281安徽分公司.xlsx', note: '边界:非规范命名(日期后直接拼序号)' },
  // ---- 船舶格式：download ----
  { key: 'download/船舶_000012_20260624_广东分公司_result.xlsx', note: '配对:upload同名文件' },
  { key: 'download/船舶_000012_20260625_福建分公司(1)_result.xlsx', note: '配对:upload同名文件' },
  { key: 'download/船舶_000012_20260623_河南分公司_result.xlsx', note: '配对:上传文件在download目录' },
  { key: 'download/船舶_000012_20260608_辽宁分公司_result.xlsx', note: '最早一批船舶结果' },
  { key: 'download/船舶_000012_20260610_上海分公司_result.xlsx', note: '船舶结果常规样例' },
  { key: 'download/船舶_000012_20260622_山东分公司_result.xlsx', note: '船舶结果常规样例' },
  { key: 'download/船舶_000012_20260625_厦门分公司_result.xlsx', note: '船舶结果常规样例' },
  { key: 'download/船舶_000012_20260624_福建分公司(1)_result.xlsx', note: '配对:upload/船舶_000012_20260625_福建分公司(1).xlsx(次日返回)' },
  { key: 'download/船舶_000012_20260609_辽宁分公司.xlsx_result.xlsx', note: '边界:双后缀.xlsx_result.xlsx' },
  { key: 'download/船舶_000012_20260623_上海分公司 _result.xlsx', note: '边界:_result前有空格' },
  // ---- 企业格式：upload ----
  { key: 'upload/A01_000012_20240704江苏分公司.xlsx', note: '配对;无连字符命名' },
  { key: 'upload/A01_000012_20240705-内蒙古分公司.xlsx', note: '配对;结果文件为大写RESULT' },
  { key: 'upload/A01_000012_20240705-四川分公司.xlsx', note: '配对' },
  { key: 'upload/A01_000012_20240705-大连分公司.xlsx', note: '配对;结果文件为大写RESULT' },
  { key: 'upload/A01_000012_20241217-广东分公司.xlsx', note: '配对' },
  { key: 'upload/A01_000012_20241218-上海分公司.xlsx', note: '配对' },
  { key: 'upload/A01_000012_20250513-广东分公司.xlsx', note: '配对' },
  { key: 'upload/A01_000012_20250506-北京分公司.xlsx', note: '企业上传常规样例' },
  { key: 'upload/A01_000012_20250514-广东分公司（南顺） .xlsx', note: '边界:全角括号+尾随空格' },
  // ---- 企业格式：download ----
  { key: 'download/A01_000012_20240704江苏分公司_result.xlsx', note: '配对:upload同名文件' },
  { key: 'download/A01_000012_20240705-内蒙古分公司_RESULT.xlsx', note: '配对;边界:大写RESULT' },
  { key: 'download/A01_000012_20240705-四川分公司_result.xlsx', note: '配对' },
  { key: 'download/A01_000012_20240705-大连分公司_RESULT.xlsx', note: '配对;边界:大写RESULT' },
  { key: 'download/A01_000012_20241217-广东分公司_result.xlsx', note: '配对' },
  { key: 'download/A01_000012_20241218-上海分公司_result.xlsx', note: '配对' },
  { key: 'download/A01_000012_20250513-广东分公司_result.xlsx', note: '配对' },
  { key: 'download/A01_000012_20241219-湖南分公司_result.xlsx', note: '企业结果常规样例' },
  { key: 'download/A01_000012_20250516-山东分公司_result.xlsx', note: '大文件(122KB,多船多险种)' },
  { key: 'download/A01_000012_20240710-湖北分公司_result .xlsx', note: '边界:.xlsx前有空格' },
  { key: 'A01_000012_20250306-安徽分公司.xls', note: '边界:.xls扩展名(非.xlsx)' },
  // ---- 根目录散落文件（非规范存放，S3 真实存在的脏数据） ----
  { key: 'A01_000001_20240313湖南分公司.xlsx', note: '根目录;服务编号000001;无连字符' },
  { key: 'A01_000001_20250318甘肃分公司.xlsx', note: '根目录;服务编号000001' },
  { key: '新疆分公司0725 - 副本.xlsx', note: '边界:完全不符合命名规范的根目录文件' },
  { key: '广东汕头2.24.xlsx', note: '边界:完全不符合命名规范的根目录文件' },
  { key: '9.30黑龙江运力通供应链管理有限公司/A01_000012_20240930-黑龙江分公司.xlsx', note: '边界:放在自建子文件夹里' },
  // ---- 补充：45 个具有代表性的「10月前」船舶过往投保结果（覆盖 4-9 月 / 多分公司 / 多数据规模 / 命名边界 / 不同服务编号） ----
  // 4 月（最早批）
  { key: 'download/船舶_000012_20260407_大连分公司_result.xlsx', note: '4月最早批;大连' },
  { key: 'download/船舶_000012_20260407_福建分公司_result.xlsx', note: '4月最早批;福建' },
  { key: 'download/船舶_000012_20260407_宁波分公司_result.xlsx', note: '4月最早批;宁波' },
  { key: 'download/船舶_000012_20260407_总公司_result.xlsx', note: '4月最早批;总公司' },
  { key: 'download/船舶_000012_20260409_山东分公司_result.xlsx', note: '4月;山东' },
  { key: 'download/船舶_000012_20260422_广东分公司_result.xlsx', note: '4月;广东' },
  { key: 'download/船舶_000012_20260428_安徽分公司_result.xlsx', note: '4月;安徽' },
  { key: 'download/船舶_000001_20260414_江苏分公司_result.xlsx', note: '边界:服务编号000001;江苏' },
  // 5 月（含多船/大批）
  { key: 'download/船舶_000012_20260507_浙江分公司_result.xlsx', note: '5月;浙江' },
  { key: 'download/船舶_000012_20260509_重庆分公司_result.xlsx', note: '5月;重庆' },
  { key: 'download/船舶_000012_20260515_广东分公司_result.xlsx', note: '5月;广东' },
  { key: 'download/船舶_000012_20260519_大连分公司_result.xlsx', note: '5月;大连;多船(12.9KB)' },
  { key: 'download/船舶_000012_20260522_广东分公司_result.xlsx', note: '5月;广东;多船(16.4KB)' },
  { key: 'download/船舶_000012_20260520_浙江分公司_result.xlsx', note: '5月;浙江;大批(59.8KB)' },
  { key: 'download/船舶_000012_20260526_上海分公司_result.xlsx', note: '5月;上海;大批(59.1KB)' },
  { key: 'download/船舶_000012_20260527_广东分公司_result.xlsx', note: '5月;广东;大批(101KB)' },
  // 6 月（补新分公司+命名边界）
  { key: 'download/船舶_000012_20260601_青岛分公司_result.xlsx', note: '6月;青岛' },
  { key: 'download/船舶_000012_20260604_辽宁分公司_result.xlsx', note: '6月;辽宁;多船(25.4KB)' },
  { key: 'download/船舶_000012_20260605_广东分公司_result.xlsx', note: '6月;广东' },
  { key: 'download/船舶_000012_20260611_广东分公司_result.xlsx', note: '6月;广东' },
  { key: 'download/船舶_000012_20260616安徽分公司_result.xlsx', note: '边界:日期后无下划线直接拼分公司;安徽' },
  { key: 'download/船舶_000012_20260624_四川分公司_result.xlsx', note: '6月;四川' },
  { key: 'download/船舶_000012_20260626_河南分公司_result.xlsx', note: '6月;河南;多船(20.9KB)' },
  { key: 'download/船舶_芦泾3_20260624_江苏分公司_result.xlsx', note: '边界:以船名代替服务编号;江苏' },
  // 7 月
  { key: 'download/船舶_000012_20260701_广东分公司_result.xlsx', note: '7月;广东' },
  { key: 'download/船舶_000012_20260707_广西分公司_result.xlsx', note: '7月;广西' },
  { key: 'download/船舶_000012_20260709_江苏分公司_result.xlsx', note: '7月;江苏' },
  { key: 'download/船舶_000012_20260713_上海分公司_result.xlsx', note: '7月;上海;多船(15.0KB)' },
  { key: 'download/船舶_000012_20260716_福建分公司_result.xlsx', note: '7月;福建' },
  { key: 'download/船舶_000012_20260717_天津分公司_result.xlsx', note: '7月;天津' },
  { key: 'download/船舶_000012_20260722_大连分公司_result.xlsx', note: '7月;大连' },
  { key: 'download/船舶_000013_20260706_江苏分公司_result.xlsx', note: '边界:服务编号000013;江苏' },
  // 8 月（补新分公司+全角括号/序号边界）
  { key: 'download/船舶_000012_20260803_四川分公司_result.xlsx', note: '8月;四川' },
  { key: 'download/船舶_000012_20260805_广东分公司（清远）_result.xlsx', note: '边界:全角括号地名后缀;广东' },
  { key: 'download/船舶_000012_20260805_江苏分公司（1）_result.xlsx', note: '边界:全角括号序号;江苏' },
  { key: 'download/船舶_000012_20260807_浙江分公司_result.xlsx', note: '8月;浙江' },
  // 9 月
  { key: 'download/船舶_000012_20260914_浙江分公司_result.xlsx', note: '9月;浙江' },
  { key: 'download/船舶_000012_20260915_福建分公司_result.xlsx', note: '9月;福建' },
  { key: 'download/船舶_000012_20260916_大连分公司_result.xlsx', note: '9月;大连' },
  { key: 'download/船舶_000012_20260918_湖北分公司_result.xlsx', note: '9月;湖北' },
  { key: 'download/船舶_000012_20260921_广西分公司（贵港）_result.xlsx', note: '边界:全角括号地名;广西' },
  { key: 'download/船舶_000012_20260923_广东分公司_result.xlsx', note: '9月;广东' },
  { key: 'download/船舶_000012_20260924_天津分公司_result.xlsx', note: '9月;天津' },
  { key: 'download/船舶_000012_20260929_江苏分公司_result.xlsx', note: '9月;江苏' },
  { key: 'download/船舶_领航_20260929-广东分公司_result.xlsx', note: '边界:船名+连字符命名;广东' },
];

// S3 key → 本地镜像相对路径（根目录散落文件归入 root/，其余保持 upload/、download/ 结构）
function mirrorPath(key) {
  if (key.startsWith('upload/') || key.startsWith('download/')) return key;
  return path.join('root', key);
}

const client = new S3Client({
  region: process.env.S3_REGION || 'us-east-1',
  endpoint: process.env.S3_ENDPOINT || undefined,
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
  },
});

function streamToBuffer(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (c) => chunks.push(c));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

const manifest = [];
let ok = 0, fail = 0;
for (const s of SAMPLES) {
  const rel = mirrorPath(s.key);
  const dest = path.join(OUT_DIR, rel);
  try {
    const obj = await client.send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: s.key }));
    const body = obj.Body ?? obj.stream ?? obj.rawBody;
    if (!body) throw new Error('响应中没有 Body/stream/rawBody 字段');
    const buf = typeof body.transformToByteArray === 'function'
      ? Buffer.from(await body.transformToByteArray())
      : await streamToBuffer(body);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, buf);
    // .xlsx 应为 zip 格式（PK 头）；.xls 可能是 OLE2（D0CF）或实为 zip
    const magic = buf.subarray(0, 4).toString('hex');
    manifest.push({ s3Key: s.key, local: rel, bytes: buf.length, note: s.note, magic });
    console.log(`OK  ${rel} (${buf.length} B)`);
    ok++;
  } catch (e) {
    console.log(`FAIL ${s.key}: ${e.name} ${e.message}`);
    manifest.push({ s3Key: s.key, local: null, error: `${e.name} ${e.message}`, note: s.note });
    fail++;
  }
}

await fs.mkdir(OUT_DIR, { recursive: true });
await fs.writeFile(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`\n完成: 成功 ${ok} / 失败 ${fail}，清单已写入 ${path.join(OUT_DIR, 'manifest.json')}`);
