import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import filesRouter from './routes/files.js';
import shipsRouter from './routes/ships.js';
import { authMiddleware, authRequired, handleLogin, handleAuthRequired } from './auth.js';
import { initDb } from './db.js';
import { startScheduler } from './cron.js';
import { recomputeRiskDimensions } from './interpret.js';

const app = express();
app.use(cors());
app.use(express.json());

// ---- 公开接口 ----
app.post('/api/auth/login', handleLogin);
app.get('/api/auth/required', handleAuthRequired);

app.get('/api/health', (req, res) =>
  res.json({ status: 'ok', time: new Date().toISOString() }));

// 当前登录人信息（含机构、角色与上级分公司）
app.get('/api/me', authMiddleware, (req, res) =>
  res.json({ status: 'ok', username: req.user.username, org: req.user.org, role: req.user.role, parent_org: req.user.parent_org || '' }));

// ---- 受保护接口（若启用口令则需 Bearer）----
app.use('/api', authMiddleware, filesRouter);
app.use('/api/ships', authMiddleware, shipsRouter);

// ---- 生产环境：托管已构建的前端（npm run build 之后）----
const webDist = path.resolve(process.cwd(), '../web/dist');
if (fs.existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get(/^(?!\/api).*/, (req, res) =>
    res.sendFile(path.join(webDist, 'index.html')));
}

const PORT = process.env.PORT || 3001;

async function main() {
  await initDb();
  app.listen(PORT, () => {
    console.log(`[s3-file-manager] server listening on http://localhost:${PORT}`);
    if (!process.env.S3_BUCKET) {
      console.warn('[warn] S3_BUCKET 未配置，请在 .env 中填写后重启。');
    }
    // Agent 调度器：机构自动上传 + T+1 结果轮询（AGENT_ENABLED 总开关可停用）
    startScheduler();
    // v1.5：双维度体系（业务品质/欺诈）全量重算风险标签，幂等
    try { recomputeRiskDimensions(); } catch (e) { console.warn('[warn] 风险维度重算失败:', e.message); }
  });
}

main().catch((e) => {
  console.error('[fatal] 启动失败:', e);
  process.exit(1);
});
