/**
 * 生成《船舶险反欺诈查询智能体》作品介绍 Word 文档
 * 排版规范对齐项目报告规范：标题华文中宋、节标题黑体、正文仿宋
 * 用法：node gen-intro-doc.cjs
 */
const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, WidthType, BorderStyle, VerticalAlign, ShadingType,
} = require('docx');

const FONT_TITLE = { ascii: '华文中宋', eastAsia: '华文中宋', hAnsi: '华文中宋' };
const FONT_HEAD = { ascii: '黑体', eastAsia: '黑体', hAnsi: '黑体' };
const FONT_BODY = { ascii: '仿宋', eastAsia: '仿宋', hAnsi: '仿宋' };

const COLOR_DARK = '1F3864';   // 深蓝（标题/表头底纹）
const COLOR_LINE = '8EAADB';   // 表格边框

// ---------- 段落构造 ----------
function docTitle(text) {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 240, after: 120 },
    children: [new TextRun({ text, bold: true, size: 36, font: FONT_TITLE, color: COLOR_DARK })],
  });
}
function subTitle(text) {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 240 },
    children: [new TextRun({ text, size: 24, font: FONT_BODY, color: '595959' })],
  });
}
function h1(text) {
  return new Paragraph({
    spacing: { before: 320, after: 140 },
    children: [new TextRun({ text, bold: true, size: 30, font: FONT_HEAD, color: COLOR_DARK })],
  });
}
function h2(text) {
  return new Paragraph({
    spacing: { before: 200, after: 100 },
    children: [new TextRun({ text, bold: true, size: 24, font: FONT_HEAD })],
  });
}
function body(text, opts = {}) {
  return new Paragraph({
    spacing: { after: 80, line: 320 },
    indent: { firstLine: 480 },
    children: [new TextRun({ text, size: 24, font: FONT_BODY, bold: !!opts.bold })],
  });
}
// 带加粗前缀的正文段：如「痛点一：部署门槛高。描述……」
function bodyLead(lead, text) {
  return new Paragraph({
    spacing: { after: 80, line: 320 },
    indent: { firstLine: 480 },
    children: [
      new TextRun({ text: lead, bold: true, size: 24, font: FONT_BODY }),
      new TextRun({ text, size: 24, font: FONT_BODY }),
    ],
  });
}
function bullet(text, boldLead) {
  const runs = [];
  if (boldLead) runs.push(new TextRun({ text: boldLead, bold: true, size: 24, font: FONT_BODY }));
  runs.push(new TextRun({ text, size: 24, font: FONT_BODY }));
  return new Paragraph({
    spacing: { after: 60, line: 320 },
    indent: { left: 480, hanging: 240 },
    children: [new TextRun({ text: '● ', size: 18, font: FONT_BODY, color: COLOR_DARK }), ...runs],
  });
}

// ---------- 表格构造 ----------
function cellPara(text, { bold = false, center = false, color } = {}) {
  return new Paragraph({
    alignment: center ? AlignmentType.CENTER : AlignmentType.LEFT,
    spacing: { after: 0, line: 260 },
    children: [new TextRun({ text: String(text), bold, size: 21, font: FONT_BODY, color })],
  });
}
function makeTable(headers, rows, widths) {
  const borders = {
    top: { style: BorderStyle.SINGLE, size: 4, color: COLOR_LINE },
    bottom: { style: BorderStyle.SINGLE, size: 4, color: COLOR_LINE },
    left: { style: BorderStyle.SINGLE, size: 4, color: COLOR_LINE },
    right: { style: BorderStyle.SINGLE, size: 4, color: COLOR_LINE },
    insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: COLOR_LINE },
    insideVertical: { style: BorderStyle.SINGLE, size: 2, color: COLOR_LINE },
  };
  const headerRow = new TableRow({
    tableHeader: true,
    children: headers.map((t, i) => new TableCell({
      width: widths ? { size: widths[i], type: WidthType.PERCENTAGE } : undefined,
      shading: { type: ShadingType.CLEAR, fill: COLOR_DARK },
      verticalAlign: VerticalAlign.CENTER,
      children: [cellPara(t, { bold: true, center: true, color: 'FFFFFF' })],
    })),
  });
  const bodyRows = rows.map((r, ri) => new TableRow({
    children: r.map((t, i) => new TableCell({
      width: widths ? { size: widths[i], type: WidthType.PERCENTAGE } : undefined,
      shading: { type: ShadingType.CLEAR, fill: ri % 2 === 1 ? 'EDF1F9' : 'FFFFFF' },
      verticalAlign: VerticalAlign.CENTER,
      children: [cellPara(t, { center: i === 0 && r.length > 2 })],
    })),
  }));
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders,
    rows: [headerRow, ...bodyRows],
  });
}
function tableCaption(text) {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 120, after: 60 },
    children: [new TextRun({ text, bold: true, size: 21, font: FONT_HEAD, color: '595959' })],
  });
}
function spacer() {
  return new Paragraph({ spacing: { after: 120 }, children: [] });
}

// ---------- 文档内容 ----------
const children = [];

// 封面标题
children.push(docTitle('船舶险反欺诈查询智能体'));
children.push(docTitle('（船舶险反欺诈智盾）作品介绍'));
children.push(subTitle('—— AI Agent 赋能船舶险承保风控：收单、调度、解析、解读全流程自动化'));

// ===== 一、作品概述 =====
children.push(h1('一、作品概述'));
children.push(body('2026 年 4 月，我司联合中银保信上线“船舶险反欺诈风控服务”，以“船舶”为维度追溯近三年船壳险、保赔险等核心险种的承保与损失记录，采用“线下查询、T+1 反馈”模式。当前该服务依赖人工完成 S3 客户端安装、Excel 汇总上传、结果下载与逐字段解读，效率低、门槛高、风险识别能力受限。'));
children.push(body('本作品“船舶险反欺诈查询智能体”将“收单—汇总—上传—下载—解析—解读”全流程自动化：分公司/中支机构业务员在网页端输入船舶识别号、IMO 号、中英文名称等要素即可发起查询；智能体自动完成跨机构去重汇总、合规文件生成与上传、T+1 结果轮询拉取、结构化解析入库，并基于“规则引擎 + 大模型”双轨引擎自动生成专业核保解读报告，实现高风险船舶自动预警。'));
children.push(bodyLead('作品定位：', '面向船舶险核保与反欺诈场景的企业级 AI Agent 应用，覆盖总公司—分公司—中支机构三级用户，核心解决“部署难、流转慢、无隔离、解读难”四大痛点。'));
children.push(bodyLead('技术栈：', 'Express + React + S3 SDK + SQLite（sql.js）+ ExcelJS + DeepSeek 大模型 + docx 报告导出引擎，前后端共约 3800 行代码，轻量架构、可平滑迁移至公司内网部署。'));
children.push(bodyLead('完成度：', '作品为可运行、可演示的真实系统（非概念原型）——端到端链路（收单→合规文件生成→模拟 T+1 返回→导入→AI 报告）可重复执行；27 个真实格式结果文件解析回归零异常；三级账号体系、跨机构去重、报告评价闭环等 31 项端到端断言全部通过。'));

// ===== 二、需求痛点 =====
children.push(h1('二、需求痛点分析'));
children.push(body('当前船舶险反欺诈平台在落地应用中存在四大业务痛点，严重制约风控效能：'));
children.push(bodyLead('痛点一：部署门槛高。', '各分公司需安装 S3 客户端并连接内网地址，安装步骤长达 12 步，其中一个环节出错即无法安装，排查耗时耗力，显著增加一线沟通负担。'));
children.push(bodyLead('痛点二：数据流转低效。', '依赖人工上传查询 Excel，易因命名或路径错误导致数据遗漏；多人协作需专人汇总，且受每日 15:00 截单限制，逾期导致反馈从 T+1 滞后至 T+2，增加对客户的解释成本；不同机构重复查询同一船舶，按次计费的查询成本（4 元/次）造成直接浪费。'));
children.push(bodyLead('痛点三：数据隔离缺失。', '全司仅有一个 S3 账号，仅以文件命名区分查询机构，查询数据未做权限隔离——各机构的客户资源与查询行为相互可见，存在业务内部竞争与数据泄露隐患。'));
children.push(bodyLead('痛点四：结果解读困难。', '中银保信返回结果多达 18 列、十余项字段，且含大量特殊语义（赔付率为多年度逗号分隔复合值、Z 表示无承保记录、(null) 表示无数据等），对核保人专业能力要求较高，人工逐项研判易遗漏潜在欺诈风险点。'));
children.push(body('上述痛点导致反欺诈服务难以高效运转，削弱了“事前预防与风险减量管理”的实际效果。'));

// ===== 三、设计思路 =====
children.push(h1('三、设计思路'));
children.push(h2('3.1 总体思路：机器提效、人类决策'));
children.push(body('遵循“人机协同”原则：AI Agent 自动执行数据收单、汇总上传、结果解析、初步风险解读等高频、易错、重复性事务；涉及重大欺诈风险判定及最终核保决策时，保留“人在回路（Human-in-the-Loop）”机制——AI 报告仅作辅助参考并标注免责声明，核保决策以人工为准；同时设置人工评价闭环（星级 + 准确性标签 + 评语），持续收集核保人对 AI 报告的反馈，反向驱动规则阈值与提示词迭代。'));
children.push(h2('3.2 数据共享、行为隔离'));
children.push(body('船舶风险数据与查询行为分层治理：船舶风险数据及 AI 解读报告存于全量共享库，任何机构查询命中即可秒回复用（查询提效与数据资产化的基础）；查询行为（谁在何时查过哪条船）、待查询队列、文件按机构严格隔离，且机构命中结果中不出现其他机构的任何信息。可见范围采用三级账号体系（管理员/分公司/中支机构），由服务端按机构家族（visibleOrgs）强制过滤，不依赖前端控制。'));
children.push(h2('3.3 全量库优先查询 + 跨机构同船去重'));
children.push(body('新查询先以船舶标识在全量库检索：命中且未过期则免 T+1 秒回；每日汇总时对全司所有机构的待查询按船舶四要素去重，同船只保留一条主查询，跨机构副本自动重定向——结果返回后全局匹配回填，所有提交过该船的机构同步推进状态、各自可见结果。既压缩了 4 元/次的查询成本，又保证了各机构视角的完整闭环。'));
children.push(h2('3.4 “规则引擎 + 大模型”双轨校验'));
children.push(body('规则引擎提供确定性、可解释的判断：R1–R6 硬规则（起保当月出险、高赔付、频繁转保、出险集中、赔案异常、无承保记录）与 S1–S6 软信号（未决赔案突出、单年度赔付率畸高等）阈值全部配置化；大模型（DeepSeek）负责生成面向核保人的自然语言解读报告，输入注入字段字典（12 个字段定义与解读规则）、真实案例解读范例、235 条保险公司代码映射三类业务知识；LLM 不可用时自动降级为规则版报告，保证断网环境下功能完整可用。风险结论由双维度规则引擎驱动，LLM 不得自行改判，确保口径统一。'));
children.push(h2('3.5 双维度风险标签体系'));
children.push(body('依据业务专家《风险评估维度》规则，风险标签采用“业务品质风险 × 欺诈风险”双维度体系，各分高/中/低三档：业务品质维度看赔付率、出险原因、赔案金额；欺诈维度重点识别“起保早期出险”等典型骗保特征。双低判为低风险；近三年无投保记录的船舶不评为低风险，而是标注灰色“无数据”并提示补充尽调，避免“危险空真”结论。'));
children.push(h2('3.6 合规与安全内建'));
children.push(body('对齐总公司报告模板与业务专家报告生成规则：报告固定六节结构，排版遵循公文规范（标题华文中宋、节标题黑体、正文仿宋，评级词分色）；报告页面与导出的 Word 文档均叠加“机构 + 账号”斜向水印，防止截图外传；演示数据全部仿真脱敏，真实业务数据不出内网。'));

// ===== 四、业务逻辑 =====
children.push(h1('四、业务逻辑'));
children.push(h2('4.1 三级账号体系与权限隔离'));
children.push(body('系统设管理员（总公司运营/风控）、分公司、中支机构三类账号：管理员可见全部机构的查询记录、报告、文件与运维信息；分公司账号可见本分公司及所属全部中支机构数据；中支机构账号仅可见本中支数据（下级不可见上级与兄弟机构）。所有查询、列表、统计接口在服务端按可见机构集合强制过滤。'));
children.push(tableCaption('表 4-1 角色权限矩阵（节选）'));
children.push(makeTable(
  ['功能', '中支机构账号', '分公司账号', '管理员账号'],
  [
    ['发起船舶查询（全量库命中/新查询）', '✓（本中支）', '✓（本分公司+中支）', '✓（全部）'],
    ['查询记录 / AI 解读报告', '✓（按命中查看）', '✓（按命中查看）', '✓'],
    ['运行概览统计面板', '✓（本中支范围）', '✓（分公司+中支范围）', '✓（全局 + 运维）'],
    ['S3 文件管理', '✗（不展示）', '✗（不展示）', '✓（全部文件）'],
    ['调度启停 / 手动触发 / 全局上传配置', '✗', '✗', '✓'],
    ['Agent 运行日志', '✗', '✗', '✓'],
  ],
  [34, 22, 22, 22],
));
children.push(spacer());
children.push(h2('4.2 三段式智能查询'));
children.push(body('业务员输入船舶四要素（识别号/IMO 号/中英文名任一必填）发起查询，系统按“全量库优先”执行三段式逻辑：'));
children.push(bullet('任何机构查过且未过有效期 → 弹窗提示该船历史查询时间，用户可选“使用旧数据”（秒回风险数据与已有 AI 报告，免 T+1 等待）或“重新查询”（入队走 T+1 最新流程）。', '① 全量库命中：'));
children.push(bullet('超过有效期（默认 90 天，可配置）→ 同样弹窗二选一，因“近三年”时间窗口随时间推移会变化，系统不静默返回旧数据。', '② 命中但过期：'));
children.push(bullet('二次确认后录入本机构待查询队列（记录机构、操作人、时间，机构隔离），随次日总公司汇总文件统一提交。', '③ 未命中：'));
children.push(h2('4.3 每日调度：去重汇总与合规上传'));
children.push(body('调度中心是系统“心脏”，按全局配置（自动/手动模式，自动时刻限定 12:00–14:50，为 15:00 中银保信截单预留缓冲）执行：聚合全司所有机构当日待查询 → 按船舶四要素跨机构去重（同船保留首条主查询，副本标记重定向）→ 生成唯一一份总公司查询文件（严格遵循“船舶_{服务编号}_{日期}_{机构}.xlsx”命名与六列模板规范）→ 三重校验（命名正则/路径/表头）→ 上传 S3 upload 目录并标记已导出。上传失败自动重试，单点失败不阻塞整体；AGENT_ENABLED 总开关支持管理员一键停用。'));
children.push(h2('4.4 T+1 结果轮询与结构化解析'));
children.push(body('系统于每日 09:00/11:00/14:00 三次轮询 download 目录，发现 _result 文件后下载、按内容摘要去重（重复拉取不重复入库），随后按“一船 × 多险种”结构化解析入库：复合值自动拆解（如赔付率“Z,0,0,0”拆为四个年度、出险原因“搁浅2次”拆为原因与次数、单均保额保费拆为保额与保费）；特殊语义显式登记（(null) 为无数据、Z 为无承保记录，与 0 严格区分）；文件名容错解析（大小写、空格、副本号、双后缀等真实脏数据场景）。同船新结果增量覆盖更新，保留原始行透传兜底。'));
children.push(h2('4.5 AI 解读引擎与六节报告'));
children.push(body('结果入库后自动触发解读流水线：'));
children.push(bullet('通过对接船讯网数据接口自动回填船舶档案（识别号、船龄、船舶类型、总吨位、船东等），档案缓存 30 天；船龄优先按识别号编码规则独立推算，不依赖外部数据源。', '① 船舶档案回填：'));
children.push(bullet('按配置阈值逐险种评估双维度风险（业务品质/欺诈 × 高/中/低），输出命中规则与判定依据，落库驱动列表徽章、筛选与统计。', '② 双维度风险评估：'));
children.push(bullet('固定六节结构——船舶档案 / 业务品质分析 / 欺诈风险识别 / 近 3 年单均保额保费 / 风险提示 / 核保建议，结尾附生成日期与 AI 免责声明；内置费率推算（保赔险按总吨位、船壳险按保额）、未决估损绝对值估算、保险公司数量解读（1 家稳定 / 2 家需关注 / 3 家及以上重点关注的频繁变更信号）等业务专家规则。', '③ 报告生成：'));
children.push(bullet('报告挂船舶维度生成一次、全量复用；同船新结果返回时增量更新；管理员可一键全量重生成。', '④ 全量库联动：'));
children.push(h2('4.6 报告交付与人工评价闭环'));
children.push(body('报告弹窗内可直接下载带斜向水印的 Word 版 AI 解读报告（排版对齐总公司模板）与该船中银保信返回数据原始 Excel（列名列序与返回文件一致，供离线留档或转交复核）；报告尾部提供人工评价组件（1–5 星 + 准确/部分准确/不准确标签 + 评语），展示“N 人评价 · 平均 X.X 星”聚合结果，为 AI 分析质量提供量化反馈通道。'));

// ===== 五、数据流转 =====
children.push(h1('五、数据流转'));
children.push(h2('5.1 端到端数据流'));
children.push(tableCaption('表 5-1 端到端数据流转时序'));
children.push(makeTable(
  ['阶段', '数据动作', '执行者'],
  [
    ['T-1 收单', '业务员网页提交船舶四要素 → 全量库优先检索：命中秒回报告；未命中录入本机构待查询队列（pending）', '业务员 + 智能体'],
    ['T-1 汇总', '聚合全司待查询 → 跨机构同船去重 → 生成总公司合规单文件 → 三重校验 → 上传 S3（15:00 截单前）', '智能体（调度中心）'],
    ['T+1 返回', '轮询 download 目录（09:00/11:00/14:00）→ 下载 _result 文件 → 摘要去重', '智能体（调度中心）'],
    ['T+1 解析', '一船多险种结构化拆解、复合值解析、特殊语义处理 → 增量写入全量库', '智能体（解析引擎）'],
    ['T+1 解读', '船讯网档案回填 → 双维度规则评估 → 规则引擎 + LLM 生成六节报告 → 落库复用', '智能体（AI 解读引擎）'],
    ['T+1 交付', '各机构查询记录状态推进至“已解读”；业务员查看/下载报告并人工评价', '智能体 + 业务员'],
  ],
  [14, 62, 24],
));
children.push(spacer());
children.push(h2('5.2 查询状态机'));
children.push(body('每条查询记录沿状态机推进：待提交（pending）→ 已上传（exported）→ 已返回（returned）→ 已解读（interpreted）；全量库秒回命中标记 hit；跨机构去重副本标记 exported_dedup 并指向主查询，主查询结果返回后自动绑定船舶、同步推进全部提交机构的状态——各级人员无需感知文件归属。'));
children.push(h2('5.3 数据分层存储'));
children.push(tableCaption('表 5-2 数据分层与核心表'));
children.push(makeTable(
  ['分层', '核心表', '内容与用途'],
  [
    ['全量共享层', 'ships / ship_policy_results / ai_reports / ship_profiles', '船舶主记录、险种粒度结构化结果（含原始行兜底）、AI 解读报告、船讯网档案缓存；任何机构命中即可复用'],
    ['机构隔离层', 'pending_queries / org_settings', '查询行为与状态机（机构、操作人、时间、hit_type）、机构显示名缓存；仅本机构（或上级）可见'],
    ['系统层', 'agent_task_logs / server_settings / processed_results', 'Agent 任务执行日志（含去重日志）、全局配置键值（调度开关/上传模式）、结果文件去重登记'],
  ],
  [16, 34, 50],
));
children.push(spacer());
children.push(body('分层原则保证“船舶风险数据全司共享、查询行为严格隔离”：命中复用只读共享层数据，不触碰也不暴露其他机构的查询行为；查询行为审计仅管理员可见，满足合规要求。'));

// ===== 六、功能介绍 =====
children.push(h1('六、功能介绍'));
children.push(tableCaption('表 6-1 功能总览'));
children.push(makeTable(
  ['功能模块', '主要内容'],
  [
    ['登录与账号', '网页账号登录，三级角色徽章（管理员/分公司/中支机构），零安装替代 S3 客户端 12 步安装'],
    ['船舶查询', '四要素表单、全量库命中弹窗确认（使用旧数据/重新查询）、险种结果表 + AI 报告默认展开、命中规则徽章'],
    ['我的查询', '查询记录状态徽章（待提交/已上传/已返回/已解读）、发起机构列、近 7 天/近 30 天/全部时间切换、风险双维度两级表头（业务品质/欺诈子列各配高/中/低筛选）'],
    ['运行概览', '分公司/中支/管理员各自范围统计：累计查询、待查询、命中复用（近半年，可下钻各船历史查询机构）、双维度风险大卡片（高/中/低/无数据分色计数）'],
    ['船舶详情', '险种结构化结果表、六节 AI 报告（水印防泄露）、下载返回数据 Excel、下载 AI 报告 Word、人工评价组件'],
    ['管理员面板', 'Agent 一键启停、手动触发（汇总上传/检索导入/模拟中银保信返回）、全局上传配置、船舶库全列筛选（船名/识别号/IMO/机构/双维度风险/时间范围）、Agent 运行日志'],
    ['文件管理', '仅管理员可见，S3 目录浏览、上传/删除/重命名'],
    ['风险标签体系', '业务品质风险与欺诈风险双维度 × 高/中/低 + 低风险 + 无数据灰色标签，列表徽章分色（红/黄/绿/灰）'],
  ],
  [18, 82],
));
children.push(spacer());
children.push(h2('6.1 特色功能说明'));
children.push(bullet('机构 A 查过的船，机构 B 再查秒回命中，免 T+1 等待；命中行为不留痕迹，不暴露机构 A 的查询。', '全量库秒回复用：'));
children.push(bullet('跨机构同船查询自动去重合并，按 4 元/次返回成本直接节省查询费用，去重明细独立留痕可审计。', '跨机构去重省钱：'));
children.push(bullet('一键生成模拟中银保信 T+1 返回文件（覆盖正常/高赔付/起保早期出险/频繁转保/无记录五种风险场景），决赛演示免内网依赖。', '模拟中银保信返回：'));
children.push(bullet('“风险”列两级表头（父表头合并跨两列，下分业务品质/欺诈两个子列），各子列高/中/低等级徽章分色显示并支持多选筛选。', '双维度两级表头：'));
children.push(bullet('报告弹窗叠加 SVG 斜向水印，导出 Word 页眉注入 VML 水印（每页平铺），内容为“机构 · 账号”，实现泄露溯源。', '报告双重水印：'));
children.push(h2('6.2 质量与验证'));
children.push(body('作品配套四个自动化验证脚本：解析回归脚本（27 个真实格式结果文件，0 异常、脏样本正确识别）、端到端脚本（收单→生成→模拟返回→导入→报告全链路，12 文件全导入、状态机闭环）、LLM 真实调用脚本（约 6 秒生成专业报告）、三级账号体系冒烟脚本（数据隔离正反向、总公司单文件汇总去重、结果回填闭环、导出与评价接口等 31 项断言全部通过）。'));

// ===== 七、技术架构 =====
children.push(h1('七、技术架构'));
children.push(body('系统采用前后端分离的轻量架构：前端 React 单页应用（Vite 构建），后端 Express 提供 REST API，数据层 SQLite（sql.js 纯 WASM，零部署依赖），文件层通过 S3 SDK 与中银保信文件服务器交互，AI 层接入 DeepSeek 大模型并内置规则版降级兜底。'));
children.push(tableCaption('表 7-1 后端模块（server/src）'));
children.push(makeTable(
  ['模块', '职责'],
  [
    ['db.js', '数据库 schema 与迁移、8 张核心表、自动备份'],
    ['auth.js', '三级角色认证、机构层级推导（visibleOrgs）、路由守卫'],
    ['excel.js', '合规查询文件生成（命名/六列模板）、结果健壮解析（复合值拆解、特殊语义、文件名容错）、单船数据导出'],
    ['scheduler.js', '全司待查询去重汇总（总公司单文件）、合规上传、T+1 轮询导入、结果回填、模拟中银保信返回'],
    ['cron.js', '定时调度（上传时刻检查、三次轮询）、总开关与防重入'],
    ['interpret.js', '双维度风险评估、R1–R6 硬规则与 S1–S6 软信号引擎、DeepSeek 报告生成（字段字典/案例/保司代码注入）、规则版降级兜底'],
    ['anlan.js', '船讯网船舶档案对接（搜索/详情、会话缓存、403 自动重登）'],
    ['report-docx.js', 'Word 报告导出（公文排版规范、评级词分色、VML 斜向水印）'],
    ['routes/ships.js · routes/files.js', '查询/列表/统计/导出/评价等业务 API 与文件管理 API'],
  ],
  [22, 78],
));
children.push(spacer());
children.push(body('可部署性：保持 Express + SQLite 轻量组合，支持本地镜像数据源离线运行（DEFAULT_SOURCE=local 启动即零内网依赖）；未配置大模型密钥时自动降级规则版报告，断网环境演示完整可用；生产环境可平滑迁移至公司内部服务器与大模型平台，真实数据不出内网。'));

// ===== 八、创新点与业务价值 =====
children.push(h1('八、创新点与业务价值'));
children.push(h2('8.1 创新点'));
children.push(bullet('以全量共享库替代“一司一号、文件即数据”的原始模式：查询秒回复用 + 数据随使用积累成为公司级船舶风险数据资产。', '全量库资产化：'));
children.push(bullet('Agent 在汇总环节自动完成跨机构同船去重与结果全局回填，把省钱的去重动作变成无感的系统能力。', '跨机构去重调度：'));
children.push(bullet('确定性规则引擎定级、大模型写报告，结论可解释、口径统一，LLM 故障自动降级，生产可用性有保障。', '规则 + LLM 双轨：'));
children.push(bullet('对齐业务专家风险评估维度：业务品质与欺诈两个独立维度 × 高/中/低，并以灰色“无数据”标签杜绝“无记录=低风险”的危险误判。', '双维度风险标签：'));
children.push(bullet('AI 解读报告自动融合船讯网船舶静态档案（船龄、吨位、船东等），输出可直接用于核保决策的完整画像。', '外部档案自动回填：'));
children.push(bullet('报告页面与导出 Word 双重斜向水印（机构 + 账号），为风控数据的内部流转提供泄露溯源能力。', '水印防泄露：'));
children.push(h2('8.2 业务价值（量化口径）'));
children.push(tableCaption('表 8-1 业务价值量化'));
children.push(makeTable(
  ['价值项', '量化口径'],
  [
    ['零门槛接入', '分公司 0 安装，网页登录即用，替代 S3 客户端 12 步安装'],
    ['流转提效', '100% 替代人工汇总上传，消除命名/路径错误导致的数据遗漏；反馈时效由 T+2 稳定至 T+1'],
    ['工时节省', '安装协助、汇总上传、结果整理、逐单解读合计每日节省基层操作工时 2 小时以上'],
    ['查询提效', '全量库命中查询秒回（免 T+1 等待），重复查询率越高提效越显著'],
    ['直接省钱', '跨机构同船去重次数 × 4 元/次，直接节省中银保信查询返回成本'],
    ['风控减损', '精准识别并拦截高赔付客户，预计每年减少赔案损失 100 万元以上'],
    ['人才赋能', 'AI 秒级解读十余项核心字段，新核保人上手成本趋近于零，弥补人工解读盲区'],
  ],
  [18, 82],
));
children.push(spacer());
children.push(body('本作品推动船舶险风控从“事后理赔”向“事前预防”转型：让一线业务员从安装、传文件、翻 Excel 中解放出来，让核保人在承保决策前即可获得结构化、可解释、可追溯的风险画像，让管理层面板化掌握全司风控态势。'));

// ===== 九、结语 =====
children.push(h1('九、结语'));
children.push(body('船舶险反欺诈查询智能体以真实业务痛点为起点、以可运行为标准、以业务专家规则为准绳，完成了从创意到落地的完整闭环。系统当前为可演示、可运行状态，配套离线演示环境与仿真数据集，赛后可按规划接入公司 SSO、内网大模型平台与告警通道，选取 2–3 家分公司灰度试点后全量推广，并可复制到货运险、企财险等同类“查询—返回—解读”模式险种，具备清晰的推广与演进路径。'));

// ---------- 文档组装 ----------
const doc = new Document({
  styles: {
    document: { run: { font: FONT_BODY, size: 24 } },
  },
  sections: [{
    properties: {
      page: {
        margin: { top: 1440, bottom: 1440, left: 1600, right: 1600 },
      },
    },
    children,
  }],
});

const OUT = path.resolve(__dirname, '../../作品介绍-船舶险反欺诈查询智能体.docx');
Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(OUT, buf);
  console.log('生成完成:', OUT, `(${(buf.length / 1024).toFixed(1)} KB)`);
});
