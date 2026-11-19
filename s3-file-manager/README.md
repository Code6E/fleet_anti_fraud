# 船舶险反欺诈查询智能体（s3-file-manager）

基于 S3 / 兼容存储的船舶险反欺诈查询 Web 系统，以 **AI Agent 自动化**为核心，替代中银保信 S3 客户端手工流程。后端 Express + AWS SDK v3 + SQLite（sql.js 纯 WASM），前端 React + Vite。

> 本项目为 2026 年中国东方 AI 赋能金融技能大赛·智能创新赛道参赛作品。设计文档见 `../PRD-船舶险反欺诈查询智能体-v1.2.md`。

## 解决的核心痛点

| 痛点 | 解决方案 |
|---|---|
| S3 软件安装繁琐 | Web 网页登录即用，0 安装 |
| 手动汇总上传易错、易逾期 | 录入船舶四要素后，Agent 按机构配置时刻（12:00-14:50）自动汇总生成合规文件上传，T+1 自动轮询拉取结果 |
| 全公司共用账号无数据隔离 | 机构账号/管理员账号双角色；机构账号仅可见本机构文件、查询记录与风险面板，服务端强制过滤 |
| 返回字段十余项需人工解读 | 规则引擎（R1-R6）+ DeepSeek LLM 双轨生成解读报告，高风险自动预警；LLM 不可用时降级为规则版报告 |

## 关键设计

- **全量结果库 + 命中秒回**：所有机构查询返回的结果入全量库；新查询优先命中全量库（任何机构查过即可复用，免 T+1），结果带 90 天有效期，过期提示重查。数据共享、行为隔离——船舶风险数据全量复用，查询行为/文件/待查询队列按机构隔离。
- **Agent 调度**：`cron.js` 每分钟检查机构自动上传时刻 + T+1 轮询时刻（默认 09:00/11:00/14:00）；`AGENT_ENABLED` 总开关可一键停用；单任务失败跳过不阻塞其他机构。
- **合规文件生成**：Sheet「A01入参」六列（序号/查询服务编号/船舶识别号/IMO号/船舶中英文名称），命名 `船舶_000012_YYYYMMDD_分公司.xlsx`，三重校验。
- **健壮解析**：结果文件一船多险种（17 列）结构化入库；容错真实脏数据（`_RESULT` 大写、空格、双后缀、`(1)` 副本、错放目录）；`Z`=无承保记录、`(null)`=无数据语义化处理。

## 快速开始

### 1. 配置

进入 `server/`，复制 `.env.example` 为 `.env` 并填写（项目已自带演示配置）：

```bash
cp .env.example .env
```

关键配置项：

```ini
# S3 连接（生产内网）；离线调试可用本地S3数据库镜像，无需配 S3
S3_ENDPOINT=http://88.88.1.63:8080
S3_BUCKET=004zhlhccbx
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
S3_FORCE_PATH_STYLE=true

# 启动默认数据源：s3=生产桶（需内网），local=本地S3数据库（离线调试）
DEFAULT_SOURCE=local

# 登录账号（role: org=机构账号 / admin=管理员；org 建议用分公司名，实现文件过滤）
USERS=[{"username":"admin","password":"admin123","org":"总公司","role":"admin"},{"username":"gd","password":"gd123","org":"广东分公司","role":"org"}]

# 船舶查询服务参数（中银保信规范，用于文件命名与表内「查询服务编号」列）
SERVICE_NAME=船舶
SERVICE_NO=000012

# AI 解读（DeepSeek，可选；未配置 key 时自动降级为规则版报告）
DEEPSEEK_API_KEY=
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-chat
```

### 2. 安装依赖

```bash
cd server && npm install
cd ../web && npm install
```

### 3. 运行

**生产模式（后端托管前端）：**

```bash
cd web && npm run build          # 构建前端到 web/dist
cd ../server && npm start        # 启动后端，自动托管 web/dist
```

打开 http://localhost:3001 即可使用（前端 + 后端同一服务）。

**开发模式（前后端分离）：**

```bash
# 终端1：后端
cd server && npm start           # http://localhost:3001

# 终端2：前端（自动代理 /api 到后端）
cd web && npm run dev            # http://localhost:3000
```

### 4. 离线演示

无需内网，用本地S3数据库镜像调试（镜像位于工作区 `../本地S3数据库/`，含 49 个真实文件）：

```bash
cd server
DEFAULT_SOURCE=local node src/index.js
```

浏览器开 http://localhost:3001 ，内置演示账号：

| 账号 | 密码 | 角色 | 机构 |
|---|---|---|---|
| admin | admin123 | 管理员 | 总公司（全局可见 + 管理面板） |
| gd | gd123 | 机构 | 广东分公司（仅本机构数据） |
| sh | sh123 | 机构 | 上海分公司（仅本机构数据） |

演示流程：管理员登录 → 管理员面板 →「检索导入结果」→ 把本地 download/ 的真实结果文件导入全量库并生成 AI 报告 → 切到 gd 账号体验数据隔离、查询命中秒回、查看报告。

## 账号体系与权限

| 功能 | 机构账号 | 管理员账号 |
|---|---|---|
| 船舶查询（全量库命中/新查询） | ✓ | ✓ |
| 我的查询列表 | ✓（仅本机构） | ✓（全部） |
| 文件管理（浏览/下载） | ✓（仅本机构文件） | ✓（全部） |
| 船舶风险数据 + AI 解读报告 | ✓ | ✓ |
| 管理面板（统计/机构配置/手动触发/日志/Agent开关） | ✗ | ✓ |
| 文件写操作（上传/删除/重命名/新建） | ✗ | ✓ |

## API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 健康检查 |
| GET | `/api/auth/required` | 是否需要登录 |
| POST | `/api/auth/login` | 登录（返回 token + role） |
| GET | `/api/me` | 当前登录人（username / org / role） |
| GET | `/api/config` | S3 配置信息（不含密钥） |
| GET/POST | `/api/source` | 查询/切换数据源（s3 / local） |
| GET | `/api/files?prefix=` | 文件列表（机构账号按本机构名过滤） |
| GET | `/api/files/download?key=` | 下载文件（机构账号校验归属） |
| POST | `/api/files/upload` | 上传文件（仅管理员） |
| DELETE | `/api/files` | 删除文件/文件夹（仅管理员） |
| POST | `/api/files/rename` | 重命名（仅管理员） |
| POST | `/api/files/folder` | 新建文件夹（仅管理员） |
| POST | `/api/ships/query` | 船舶三段式查询（全量库命中秒回/过期提示/新查询入队） |
| POST | `/api/ships/pending` | 确认新查询，录入本机构待查询队列 |
| GET | `/api/ships/pending` | 我的查询列表（机构账号仅本机构） |
| GET | `/api/ships` | 船舶列表（admin 全量 / 机构账号本机构关联） |
| GET | `/api/ships/:id` | 船舶详情（险种结果 + 最新 AI 报告） |
| POST | `/api/ships/admin/export-now` | 手动触发上传待查询（管理员可指定机构） |
| POST | `/api/ships/admin/import-now` | 手动触发检索导入返回结果（仅管理员） |
| GET | `/api/ships/admin/logs` | Agent 运行日志（仅管理员） |
| GET | `/api/ships/admin/stats` | 统计面板数据（仅管理员） |
| GET/POST | `/api/ships/admin/orgs` | 机构配置管理（仅管理员） |
| GET/POST | `/api/ships/admin/agent-enabled` | Agent 调度总开关（仅管理员） |

## 数据模型（SQLite，schema v3）

| 表 | 说明 |
|---|---|
| `ships` | 全量船舶主记录（四类标识 + 最新风险等级 + 首次查询溯源） |
| `ship_policy_results` | 险种粒度结果（一船 × 多险种，17 列结构化，复合值拆解存 JSON） |
| `pending_queries` | 查询行为记录（机构隔离；状态机：pending→exported→returned→interpreted；hit=全量库命中秒回） |
| `org_settings` | 机构配置（display_name / upload_mode / upload_time 12:00-14:50 / enabled） |
| `ai_reports` | AI 解读报告（挂船舶维度，全量复用；含 risk_level / rule_hits / report_md / model） |
| `agent_task_logs` | Agent 任务执行日志 |
| `server_settings` | 系统键值（AGENT_ENABLED 总开关） |
| `processed_results` | 结果文件去重 |

解读规则配置见 `server/config/interpret-rules.json`（字段字典 + R1-R6 阈值），改规则无需动库。

## 测试

```bash
cd server

# 解析回归：对本地S3数据库 download/ 全部 27 个结果文件做文件名+内容解析
node test_parse_all.js

# 端到端：收单→合规文件生成→模拟T+1返回→轮询导入→AI解读→全量库命中（规则版报告）
DEFAULT_SOURCE=local DB_PATH=/tmp/e2e-ship.db node test_e2e.mjs

# LLM 验证：对一条船调用 DeepSeek 生成真实解读报告
node test_llm.mjs
```

## 业务流程

```
【T-1 收单日】
  机构账号 Web 录入船舶四要素
    → 全量库命中？秒回结果+已有报告（免 T+1）
    → 未命中？录入本机构待查询队列
  Agent 14:30（机构配置时刻）自动汇总 → 生成合规文件 → 三重校验 → 上传 upload/
  15:00 中银保信截单

【T+1 结果日】
  Agent 09:00/11:00/14:00 轮询 download/
    → 全量扫描 _result 文件（容错匹配）→ 去重 → 按险种解析入全量库
    → 触发 AI 解读（规则引擎 + DeepSeek）→ 生成报告 → 高风险标红提醒
  机构账号收到通知，查看本机构船舶列表与 AI 报告
```

## 技术栈

- 后端：Express 4 + @aws-sdk/client-s3 + multer 2 + sql.js（SQLite/WASM）+ exceljs
- 前端：React 18 + Vite 5
- 鉴权：Bearer Token（多用户 USERS 含 role / 单口令）
- AI：DeepSeek（chat/completions），失败降级规则版报告
- 调度：原生 setInterval（零依赖），防重入 + AGENT_ENABLED 总开关

## 目录结构

```
s3-file-manager/
  server/
    config/
      interpret-rules.json   解读规则配置（字段字典 + R1-R6 阈值）
    src/
      index.js               入口，Express 应用 + 启动调度器
      db.js                  SQLite 封装与 schema v3
      auth.js                登录与双角色（org/admin）
      storage.js             存储门面（生产 S3 ↔ 本地S3数据库 运行时切换）
      s3.js                  S3 操作封装
      localfs.js             本地文件系统后端（离线调试）
      excel.js               船舶 Excel 合规生成与健壮解析
      scheduler.js           Agent 调度核心（汇总上传 + 轮询导入 + 触发解读）
      cron.js                定时调度器（机构自动上传时刻 + T+1 轮询）
      interpret.js           AI 解读引擎（规则引擎 + DeepSeek LLM）
      routes/
        files.js             文件管理路由（机构过滤 + 管理员写权限）
        ships.js             船舶查询路由（三段式 + 机构隔离 + 管理员接口）
    data/                    SQLite 数据库文件（运行时生成）
    .env / .env.example      配置
    test_parse_all.js        解析回归测试
    test_e2e.mjs             端到端测试
    test_llm.mjs             DeepSeek LLM 验证
    package.json
  web/
    src/
      App.jsx                主应用（登录 + 船舶查询 + 文件管理 + 管理员面板）
      api.js                 API 封装与工具函数
      styles.css             样式
    index.html
    vite.config.js
    package.json
  start.bat                  Windows 一键启动脚本
  README.md
```
