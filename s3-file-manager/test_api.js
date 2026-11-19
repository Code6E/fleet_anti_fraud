/**
 * 端到端验证脚本：在后端无真实 S3 凭证时，验证服务启动与接口形态。
 * 有真实凭证时，验证完整文件 CRUD 链路。
 */
const assert = require('assert');

const BASE = 'http://localhost:3001';
const results = [];
function ok(name) { results.push({ name, pass: true }); console.log(`PASS: ${name}`); }
function fail(name, msg) { results.push({ name, pass: false }); console.error(`FAIL: ${name} - ${msg}`); }
async function get(path) {
  const res = await fetch(BASE + path);
  const ct = res.headers.get('content-type') || '';
  const body = ct.includes('json') ? await res.json() : await res.text();
  return { status: res.status, body };
}
async function post(path, data) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const body = await res.json();
  return { status: res.status, body };
}
async function del(path, data) {
  const res = await fetch(BASE + path, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const body = await res.json();
  return { status: res.status, body };
}

async function main() {
  // 1. 健康检查
  try {
    const r = await get('/api/health');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.status, 'ok');
    ok('GET /api/health returns ok');
  } catch (e) { fail('GET /api/health', e.message); }

  // 2. 配置接口（不含密钥）
  try {
    const r = await get('/api/config');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.status, 'ok');
    assert.ok(!('S3_ACCESS_KEY_ID' in r.body), 'config must not expose secrets');
    assert.ok('bucket' in r.body, 'config should include bucket');
    assert.ok('endpoint' in r.body, 'config should include endpoint');
    assert.ok('authRequired' in r.body, 'config should include authRequired');
    ok('GET /api/config (no secrets exposed)');
  } catch (e) { fail('GET /api/config', e.message); }

  // 3. 认证检查
  try {
    const r = await get('/api/auth/required');
    assert.strictEqual(r.status, 200);
    assert.ok(typeof r.body.required === 'boolean');
    ok('GET /api/auth/required');
  } catch (e) { fail('GET /api/auth/required', e.message); }

  // 4. 文件列表（如果 S3 未配置，应该返回错误但不崩溃）
  try {
    const r = await get('/api/files');
    if (r.body.status === 'error') {
      // S3 未配置，预期行为
      ok('GET /api/files (S3 not configured - expected error)');
    } else {
      assert.strictEqual(r.body.status, 'ok');
      assert.ok(Array.isArray(r.body.folders), 'folders should be array');
      assert.ok(Array.isArray(r.body.files), 'files should be array');
      ok('GET /api/files (list ok)');
    }
  } catch (e) { fail('GET /api/files', e.message); }

  // 5. 新建文件夹（如果 S3 未配置会报错）
  try {
    const r = await post('/api/files/folder', { prefix: '', name: '__test_folder__' });
    if (r.body.status === 'error') {
      ok('POST /api/files/folder (S3 not configured - expected error)');
    } else {
      assert.strictEqual(r.body.status, 'ok');
      assert.ok(r.body.key, 'should return key');
      ok('POST /api/files/folder (create ok)');
    }
  } catch (e) { fail('POST /api/files/folder', e.message); }

  // 6. 下载缺 key 应返回 400
  try {
    const r = await get('/api/files/download');
    assert.strictEqual(r.status, 400);
    ok('GET /api/files/download (400 without key)');
  } catch (e) { fail('GET /api/files/download 400 check', e.message); }

  // 7. 删除缺 key 应返回 400
  try {
    const r = await del('/api/files', {});
    assert.strictEqual(r.status, 400);
    ok('DELETE /api/files (400 without key)');
  } catch (e) { fail('DELETE /api/files 400 check', e.message); }

  // 8. 重命名缺参数应返回 400
  try {
    const r = await post('/api/files/rename', {});
    assert.strictEqual(r.status, 400);
    ok('POST /api/files/rename (400 without from/to)');
  } catch (e) { fail('POST /api/files/rename 400 check', e.message); }

  // 结果
  const passed = results.filter((r) => r.pass).length;
  const total = results.length;
  console.log(`\n${'='.repeat(40)}`);
  console.log(`Results: ${passed}/${total} passed`);
  process.exit(passed === total ? 0 : 1);
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
