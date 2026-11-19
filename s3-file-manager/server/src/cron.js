// Agent 定时调度器（零依赖，setInterval 实现）
//  v1.3b：上传调度从"机构级差异化时刻"改为"全局统一时刻 + 管理员手动"
//  - UPLOAD_MODE=auto 时，到 UPLOAD_TIME 时刻汇总所有机构待查询（先去重）上传 S3 upload/
//  - T+1 轮询时刻（默认 09:00 / 11:00 / 14:00，POLL_TIMES 可配）扫描 download/ 导入结果
//  - AGENT_ENABLED 总开关（server_settings 表，管理员可一键停用）
//  - 防重入：同一任务（日期 / 轮询时刻）当日只执行一次；进程重启自动恢复
import { all, get, run } from './db.js';
import { exportPendingAll, importResults, logTask } from './scheduler.js';

const POLL_TIMES = (process.env.POLL_TIMES || '09:00,11:00,14:00').split(',').map((s) => s.trim());

const ranToday = new Set(); // 防重入标记：taskKey = `${type}:${YYYY-MM-DD}`

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function nowHHMM() {
  const d = new Date();
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

// ---- AGENT_ENABLED 总开关 ----
export function getAgentEnabled() {
  const row = get("SELECT value FROM server_settings WHERE key='AGENT_ENABLED'");
  return row ? row.value !== 'false' : true; // 默认启用
}

export function setAgentEnabled(v) {
  run("INSERT INTO server_settings (key, value) VALUES ('AGENT_ENABLED', ?) "
    + "ON CONFLICT(key) DO UPDATE SET value=excluded.value", [v ? 'true' : 'false']);
  return getAgentEnabled();
}

// ---- 全局上传配置（v1.3b：取代 org_settings.upload_mode/upload_time） ----
export function getUploadConfig() {
  const mode = get("SELECT value FROM server_settings WHERE key='UPLOAD_MODE'");
  const time = get("SELECT value FROM server_settings WHERE key='UPLOAD_TIME'");
  return {
    upload_mode: mode?.value === 'auto' ? 'auto' : 'manual',
    upload_time: time?.value || '14:30',
  };
}

export function setUploadConfig({ mode, time }) {
  const m = mode === 'auto' ? 'auto' : 'manual';
  let t = '14:30';
  if (m === 'auto') {
    const mm = String(time || '').match(/^(\d{2}):(\d{2})$/);
    if (!mm) throw new Error('upload_time 格式应为 HH:MM');
    const mins = Number(mm[1]) * 60 + Number(mm[2]);
    if (mins < 12 * 60 || mins > 14 * 60 + 50) {
      throw new Error('自动上传时刻仅允许 12:00-14:50（中银保信 15:00 截单）');
    }
    t = time;
  }
  run("INSERT INTO server_settings (key, value) VALUES ('UPLOAD_MODE', ?) "
    + "ON CONFLICT(key) DO UPDATE SET value=excluded.value", [m]);
  run("INSERT INTO server_settings (key, value) VALUES ('UPLOAD_TIME', ?) "
    + "ON CONFLICT(key) DO UPDATE SET value=excluded.value", [t]);
  return getUploadConfig();
}

// ---- 调度主循环 ----

async function tick() {
  let enabled;
  try { enabled = getAgentEnabled(); } catch { return; } // db 未初始化完成时静默跳过
  if (!enabled) return;

  const hhmm = nowHHMM();
  const today = todayStr();

  // 1) 全局自动上传：UPLOAD_MODE=auto 且当前时刻等于 UPLOAD_TIME
  try {
    const cfg = getUploadConfig();
    if (cfg.upload_mode === 'auto' && cfg.upload_time === hhmm) {
      const taskKey = `export:${today}`;
      if (!ranToday.has(taskKey)) {
        ranToday.add(taskKey);
        try {
          const r = await exportPendingAll();
          const ok = (r.files || []).length;
          const skipped = ok === 0 ? '（无待提交查询）' : '';
          console.log(`[agent] 全局自动上传：上传 ${ok} 个文件${skipped}，去重 ${r.dedupCount || 0} 条重复查询`);
        } catch (e) {
          logTask('export', '', '', 'error', `全局自动上传失败: ${e.message}`);
          console.error('[agent] 全局自动上传失败:', e.message);
        }
      }
    }
  } catch (e) {
    console.error('[agent] 检查全局上传配置失败:', e.message);
  }

  // 2) T+1 结果轮询：到点扫描 download/
  if (POLL_TIMES.includes(hhmm)) {
    const taskKey = `poll:${hhmm}:${today}`;
    if (ranToday.has(taskKey)) return;
    ranToday.add(taskKey);
    try {
      const r = await importResults();
      if (r.imported?.length) {
        console.log(`[agent] 轮询导入 ${r.imported.length} 个结果文件（跳过 ${r.skipped.length}，失败 ${r.failed.length}）`);
      }
    } catch (e) {
      logTask('poll', '', '', 'error', `轮询导入失败: ${e.message}`);
      console.error('[agent] 轮询导入失败:', e.message);
    }
  }
}

let timer = null;

export function startScheduler() {
  if (timer) return;
  timer = setInterval(tick, 60 * 1000);
  // 启动后 10 秒先跑一次（捕捉启动窗口内错过的时刻）
  setTimeout(tick, 10 * 1000);
  const cfg = getUploadConfig();
  console.log(`[agent] 调度器已启动：全局上传模式=${cfg.upload_mode}（${cfg.upload_mode === 'auto' ? cfg.upload_time : '管理员手动'}）+ 结果轮询（${POLL_TIMES.join(' / ')}）；总开关 AGENT_ENABLED=${getAgentEnabled()}`);
}

export function stopScheduler() {
  if (timer) { clearInterval(timer); timer = null; }
}
