# 项目记忆（s3-file-manager / 船舶险反欺诈查询智能体）

## 架构关键约定

- **三级账号体系（v1.3e，2026-10-25 落地）**：
  - `role: admin / org(分公司) / sub_org(中支机构)`；中支须配 `parent_org` 指向所属分公司 org
  - 层级关系从 `.env` 的 `USERS` 配置推导（`auth.js` 的 `orgChildren/orgParent/orgFamily/branchOf/visibleOrgs`）
  - 可见范围：分公司=本分公司+所属全部中支；中支=仅本中支；admin=全量
  - 汇总上传（v1.3f）：**所有机构（总公司/分公司/中支）待查询去重后汇总成一个总公司查询文件**（`hqOrg()` 取 USERS 中 role=admin 的 org 命名，fallback DEFAULT_ORG/总公司），不再按分公司分组；`findPending` 全局匹配回填，跨机构同船副本经 `linkDedupCopies` 绑 ship_id + interpreted
  - 文件名恒为总公司名（如 `船舶_000012_20260825_总公司.xlsx`）；v1.3f 起非管理员账号**不展示文件管理模块**（导航不渲染 + safeView 强制回退船舶查询），文件读写仅管理员
  - 新增 `GET /api/ships/overview`（机构运行概览，按可见范围统计）；前端 ShipQuery 顶部加非 admin 概览面板
  - token 载荷含 `parent_org`；`/api/me` 返回 parent_org

- **报告弹窗三增强（v1.3g，2026-10-25 落地）**：
  - db schema v4 新增 `ai_feedback` 表（ship_id/report_id/username/org/rating 1-5/accuracy 枚举/comment ≤500；同人同船保留最新一条）
  - `GET /api/ships/:id/export-data`：单船中银保信返回数据 xlsx（`excel.js buildShipDataExcel` 由 raw_json 原始列还原，raw 缺失退回结构化字段兜底）
  - `GET /api/ships/:id/export-report`：AI 报告 Markdown 下载（含船舶信息头/风险等级/命中规则）
  - `GET|POST /api/ships/:id/feedback`：评价提交/更新/聚合（avgRating+count；rating 用 Number.isInteger 严格校验，勿用 Math.max clamp——0 会被 clamp 成 1）
  - 前端 ShipDetailBody：头部「⬇ 下载返回数据 Excel」、报告标题行「⬇ 下载AI报告」、尾部 ReportFeedback 星级组件；`api.js` 加 `saveResponse()` blob 下载 helper

## 文件改造速查（v1.3e→v1.3g）
- `server/src/auth.js`：三级角色 + orgFamily 等 helper（108→161 行）
- `server/src/routes/ships.js`：visibleOrgs 过滤 + /overview + 导出/评价接口（245→429 行）
- `server/src/scheduler.js`：总公司单文件汇总 + 全局匹配回填（437→452 行）
- `server/src/excel.js`：buildShipDataExcel 单船导出（236→416 行）
- `server/src/db.js`：schema v4（+ai_feedback）
- `server/src/index.js`：/api/me 返回 parent_org
- `web/src/App.jsx`：OrgOverviewPanel + 概览面板 + 下载按钮 + ReportFeedback（782→942 行）
- `web/src/api.js`：shipOverview + roleLabel + saveResponse（219→255 行）
- `server/.env.example`：USERS 注释加 sub_org+parent_org 示例
- `server/test_hierarchy.mjs`：31 项断言（临时目录隔离，零内网）

## 约定
- 每次改 s3-file-manager 功能必须同步更新 PRD：`/Users/luoyuqing/船舶反欺诈/PRD-船舶险反欺诈查询智能体-v1.3.md`
- 冒烟测试约定用独立临时目录 + `DEFAULT_SOURCE=local` + `LOCAL_DB_PATH` 覆盖，避免污染真实 app.db 与本地S3数据库镜像
- `.env`（server/.env）含密钥，读写需用户授权；改配置示例改 `.env.example`
