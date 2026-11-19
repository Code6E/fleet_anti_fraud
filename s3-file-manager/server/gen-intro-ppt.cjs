/**
 * 生成《船舶险反欺诈查询智能体》作品介绍 PPT（核心精简版）
 * 用法：node gen-intro-ppt.cjs
 */
const fs = require('fs');
const path = require('path');
const PptxGenJS = require('pptxgenjs');

// ---------- 配色与字体 ----------
const C = {
  primary: '1F3864',   // 深蓝（主色）
  accent: '2E75B6',    // 亮蓝（强调）
  light: 'EDF2FA',     // 浅蓝底
  white: 'FFFFFF',
  dark: '333333',
  gray: '666666',
  red: 'E02020', green: '00A651', amber: 'D6A419', grayTag: '808080',
};
const FONT = '微软雅黑';

const pptx = new PptxGenJS();
pptx.defineLayout({ name: 'W16x9', width: 13.333, height: 7.5 });
pptx.layout = 'W16x9';

const W = 13.333, H = 7.5;

// ---------- 通用元素 ----------
// 页眉：左上角标题条 + 右上角页码
function header(slide, title, pageNo) {
  slide.addShape('rect', { x: 0, y: 0, w: W, h: 0.9, fill: { color: C.primary } });
  slide.addShape('rect', { x: 0.55, y: 0.28, w: 0.09, h: 0.36, fill: { color: '4FC3F7' } });
  slide.addText(title, { x: 0.78, y: 0.16, w: 9, h: 0.6, fontSize: 24, bold: true, color: C.white, fontFace: FONT, valign: 'middle' });
  slide.addText(`${pageNo}`, { x: W - 1.1, y: 0.22, w: 0.7, h: 0.5, fontSize: 12, color: 'A9C4E8', fontFace: FONT, align: 'right', valign: 'middle' });
}
// 底部细线
function footer(slide) {
  slide.addShape('rect', { x: 0.55, y: H - 0.35, w: W - 1.1, h: 0.012, fill: { color: 'C9D6EA' } });
  slide.addText('船舶险反欺诈智盾', { x: 0.55, y: H - 0.38, w: 3, h: 0.3, fontSize: 9, color: '9AA7B8', fontFace: FONT });
}
// 卡片：圆角矩形
function card(slide, { x, y, w, h, fill = C.light, line }) {
  slide.addShape('roundRect', { x, y, w, h, rectRadius: 0.06, fill: { color: fill }, line: line ? { color: line, width: 1 } : { color: fill, width: 0 } });
}
// 卡片标题 + 描述
function cardText(slide, { x, y, w, h, title, desc, titleColor = C.primary, descColor = C.dark, titleSize = 14, descSize = 11.5 }) {
  slide.addText(title, { x: x + 0.18, y: y + 0.12, w: w - 0.36, h: 0.42, fontSize: titleSize, bold: true, color: titleColor, fontFace: FONT, valign: 'middle' });
  slide.addText(desc, { x: x + 0.18, y: y + 0.56, w: w - 0.36, h: h - 0.68, fontSize: descSize, color: descColor, fontFace: FONT, valign: 'top', lineSpacingMultiple: 1.15 });
}
// 徽章
function badge(slide, { x, y, w, h = 0.32, text, color, size = 10.5 }) {
  slide.addShape('roundRect', { x, y, w, h, rectRadius: 0.16, fill: { color }, line: { color, width: 0 } });
  slide.addText(text, { x, y: y - 0.015, w, h, fontSize: size, bold: true, color: C.white, fontFace: FONT, align: 'center', valign: 'middle' });
}

// ==================== S1 封面 ====================
{
  const s = pptx.addSlide();
  s.background = { color: C.primary };
  // 装饰斜块
  s.addShape('rect', { x: 9.2, y: -1.2, w: 6, h: 4.2, rotate: 18, fill: { color: '26508A' } });
  s.addShape('rect', { x: 10.2, y: -1.5, w: 6, h: 3.4, rotate: 18, fill: { color: '2E75B6' }, transparency: 45 });
  s.addShape('rect', { x: -1.5, y: 5.9, w: 6, h: 3.2, rotate: 18, fill: { color: '26508A' } });
  s.addText('2026 年中国东方 AI 赋能金融技能大赛 · 参赛作品', { x: 1.0, y: 1.55, w: 11, h: 0.4, fontSize: 14, color: '8FB4E3', fontFace: FONT });
  s.addText('船舶险反欺诈查询智能体', { x: 0.95, y: 2.15, w: 11.5, h: 1.15, fontSize: 48, bold: true, color: C.white, fontFace: FONT });
  s.addText('船舶险反欺诈智盾', { x: 1.0, y: 3.35, w: 8, h: 0.5, fontSize: 20, color: '4FC3F7', fontFace: FONT, bold: true });
  s.addShape('rect', { x: 1.05, y: 4.05, w: 2.6, h: 0.035, fill: { color: '4FC3F7' } });
  s.addText('AI Agent 赋能船舶险承保风控：收单 · 调度 · 解析 · 解读全流程自动化', { x: 1.0, y: 4.3, w: 11, h: 0.45, fontSize: 17, color: 'D7E5F7', fontFace: FONT });
  // 底部三个关键词徽章
  badge(s, { x: 1.0, y: 5.35, w: 2.5, text: '零门槛 · 网页即用', color: '2E75B6', size: 12 });
  badge(s, { x: 3.7, y: 5.35, w: 2.5, text: '全流程自动流转', color: '2E75B6', size: 12 });
  badge(s, { x: 6.4, y: 5.35, w: 2.9, text: 'AI 解读 · 双维度风控', color: '2E75B6', size: 12 });
}

// ==================== S2 业务背景 ====================
{
  const s = pptx.addSlide();
  header(s, '一、业务背景', '02');
  footer(s);
  card(s, { x: 0.55, y: 1.25, w: 12.23, h: 1.5, fill: C.light });
  s.addText([
    { text: '2026 年 4 月，我司联合中银保信上线「船舶险反欺诈风控服务」', options: { bold: true, color: C.primary, fontSize: 15 } },
    { text: '\n以船舶为维度追溯近三年船壳险、保赔险等核心险种的承保与损失记录，采用「线下查询、T+1 反馈」模式。', options: { color: C.dark, fontSize: 13 } },
  ], { x: 0.8, y: 1.38, w: 11.8, h: 1.25, fontFace: FONT, valign: 'middle', lineSpacingMultiple: 1.2 });
  // 现状人工流程（5 步链）
  s.addText('现状：全流程依赖人工', { x: 0.55, y: 3.0, w: 6, h: 0.4, fontSize: 15, bold: true, color: C.primary, fontFace: FONT });
  const steps = ['S3 客户端\n安装', '人工汇总\nExcel', '手工上传\n(15:00 截单)', '人工下载\n结果文件', '逐字段\n人工解读'];
  steps.forEach((t, i) => {
    const x = 0.55 + i * 2.55;
    card(s, { x, y: 3.5, w: 2.1, h: 1.1, fill: C.white, line: 'C9D6EA' });
    s.addText(t, { x, y: 3.5, w: 2.1, h: 1.1, fontSize: 12.5, color: C.dark, fontFace: FONT, align: 'center', valign: 'middle', lineSpacingMultiple: 1.1 });
    if (i < steps.length - 1) s.addText('▶', { x: x + 2.08, y: 3.85, w: 0.5, h: 0.4, fontSize: 14, color: C.accent, fontFace: FONT, align: 'center' });
  });
  // 我们的方案
  s.addText('本作品：AI Agent 全流程自动化', { x: 0.55, y: 5.0, w: 8, h: 0.4, fontSize: 15, bold: true, color: C.green, fontFace: FONT });
  s.addText('网页提交四要素 → 智能体自动去重汇总、合规上传、T+1 拉取解析 → 规则引擎 + 大模型自动生成核保解读报告，高风险船舶自动预警。', { x: 0.55, y: 5.42, w: 12.2, h: 0.75, fontSize: 13.5, color: C.dark, fontFace: FONT, lineSpacingMultiple: 1.25 });
  s.addText('定位：可运行、可演示的真实系统 —— 前后端约 3800 行代码，27 个真实格式文件解析回归零异常，31 项端到端断言全部通过', { x: 0.55, y: 6.35, w: 12.2, h: 0.5, fontSize: 12, italic: true, color: C.gray, fontFace: FONT });
}

// ==================== S3 四大痛点 ====================
{
  const s = pptx.addSlide();
  header(s, '二、需求痛点', '03');
  footer(s);
  const pains = [
    { n: '痛点一', t: '部署门槛高', d: 'S3 客户端安装长达 12 步，一处出错即失败，排查耗时，沟通负担重', icon: '⚠' },
    { n: '痛点二', t: '数据流转低效', d: '人工上传易错漏；受 15:00 截单限制，反馈 T+1 滞后为 T+2；重复查询浪费按次计费成本（4 元/次）', icon: '⏱' },
    { n: '痛点三', t: '数据隔离缺失', d: '全司仅一个账号、以文件命名区分机构，客户资源与查询行为互见，存在竞争与泄露隐患', icon: '🔓' },
    { n: '痛点四', t: '结果解读困难', d: '返回 18 列十余项字段，含复合值/特殊语义（Z、null），人工研判易遗漏欺诈风险点', icon: '📖' },
  ];
  pains.forEach((p, i) => {
    const x = 0.55 + (i % 2) * 6.27, y = 1.35 + Math.floor(i / 2) * 2.6;
    card(s, { x, y, w: 5.95, h: 2.3, fill: C.white, line: 'C9D6EA' });
    s.addShape('rect', { x, y, w: 0.09, h: 2.3, fill: { color: C.accent } });
    s.addText(p.icon, { x: x + 0.28, y: y + 0.2, w: 0.7, h: 0.6, fontSize: 26, fontFace: FONT, color: C.accent });
    s.addText(p.n, { x: x + 1.0, y: y + 0.18, w: 2, h: 0.35, fontSize: 12, bold: true, color: C.accent, fontFace: FONT });
    s.addText(p.t, { x: x + 1.0, y: y + 0.5, w: 4.5, h: 0.5, fontSize: 19, bold: true, color: C.primary, fontFace: FONT });
    s.addText(p.d, { x: x + 0.35, y: y + 1.12, w: 5.3, h: 1.05, fontSize: 12.5, color: C.dark, fontFace: FONT, lineSpacingMultiple: 1.2 });
  });
  s.addText('上述痛点导致反欺诈服务难以高效运转，削弱「事前预防与风险减量管理」的实际效果', { x: 0.55, y: 6.6, w: 12.2, h: 0.4, fontSize: 12.5, italic: true, color: C.gray, fontFace: FONT, align: 'center' });
}

// ==================== S4 设计思路 ====================
{
  const s = pptx.addSlide();
  header(s, '三、设计思路', '04');
  footer(s);
  const ideas = [
    { t: '机器提效 · 人类决策', d: 'Agent 自动执行高频事务；重大风险判定保留人在回路，AI 报告仅辅助参考 + 人工评价闭环反哺迭代' },
    { t: '数据共享 · 行为隔离', d: '船舶风险数据全量共享秒回复用；查询行为按机构严格隔离，服务端三级账号强制过滤' },
    { t: '全量库优先 + 跨机构去重', d: '新查询先查全量库，命中秒回；每日汇总按船舶四要素跨机构去重，省成本且各机构闭环' },
    { t: '规则引擎 + LLM 双轨', d: '规则定级（可解释、阈值配置化）+ 大模型写报告（字段字典/案例/保司代码注入），LLM 故障自动降级' },
    { t: '双维度风险标签', d: '业务品质 × 欺诈两个独立维度各分高/中/低；无记录 ≠ 低风险，灰色「无数据」杜绝危险误判' },
    { t: '合规安全内建', d: '对齐总公司报告模板与公文排版；页面与 Word 报告双重「机构·账号」水印，泄露可溯源；演示数据仿真脱敏' },
  ];
  ideas.forEach((p, i) => {
    const x = 0.55 + (i % 3) * 4.18, y = 1.35 + Math.floor(i / 3) * 2.6;
    card(s, { x, y, w: 3.86, h: 2.35, fill: C.light });
    s.addText(`${i + 1}`, { x: x + 0.18, y: y + 0.14, w: 0.5, h: 0.5, fontSize: 20, bold: true, color: '4FC3F7', fontFace: FONT });
    s.addText(p.t, { x: x + 0.62, y: y + 0.16, w: 3.1, h: 0.5, fontSize: 14.5, bold: true, color: C.primary, fontFace: FONT, valign: 'middle' });
    s.addText(p.d, { x: x + 0.22, y: y + 0.75, w: 3.45, h: 1.5, fontSize: 11, color: C.dark, fontFace: FONT, lineSpacingMultiple: 1.2 });
  });
}

// ==================== S5 业务逻辑：账号体系与三段式查询 ====================
{
  const s = pptx.addSlide();
  header(s, '四、业务逻辑（1）：三级账号与三段式查询', '05');
  footer(s);
  // 左：三级账号
  s.addText('三级账号体系 · 服务端强制隔离', { x: 0.55, y: 1.2, w: 6, h: 0.4, fontSize: 15, bold: true, color: C.primary, fontFace: FONT });
  const roles = [
    { t: '管理员（总公司）', d: '全局数据 · 调度运维 · 审计日志', c: C.primary },
    { t: '分公司账号', d: '本分公司 + 所属全部中支机构数据', c: C.accent },
    { t: '中支机构账号', d: '仅本中支数据，下级不可见上级', c: '5B9BD5' },
  ];
  roles.forEach((r, i) => {
    const y = 1.75 + i * 1.5;
    card(s, { x: 0.55, y, w: 5.7, h: 1.3, fill: C.white, line: 'C9D6EA' });
    s.addShape('rect', { x: 0.55, y, w: 0.09, h: 1.3, fill: { color: r.c } });
    s.addText(r.t, { x: 0.85, y: y + 0.15, w: 5.2, h: 0.45, fontSize: 15, bold: true, color: r.c, fontFace: FONT });
    s.addText(r.d, { x: 0.85, y: y + 0.62, w: 5.2, h: 0.5, fontSize: 12, color: C.dark, fontFace: FONT });
  });
  // 右：三段式查询
  s.addText('三段式智能查询（全量库优先）', { x: 6.75, y: 1.2, w: 6, h: 0.4, fontSize: 15, bold: true, color: C.primary, fontFace: FONT });
  const q = [
    { t: '① 全量库命中', d: '任何机构查过且未过期 → 秒回风险数据 + 已有 AI 报告（不暴露他机构查询行为）', c: C.green },
    { t: '② 命中但过期', d: '默认 90 天有效期 → 弹窗二选一：使用旧数据 / 重新查询（不静默返回旧数据）', c: C.amber },
    { t: '③ 未命中', d: '二次确认 → 录入本机构待查询队列 → 随次日总公司汇总文件统一提交', c: C.accent },
  ];
  q.forEach((r, i) => {
    const y = 1.75 + i * 1.5;
    card(s, { x: 6.75, y, w: 6.03, h: 1.3, fill: C.white, line: 'C9D6EA' });
    s.addShape('rect', { x: 6.75, y, w: 0.09, h: 1.3, fill: { color: r.c } });
    s.addText(r.t, { x: 7.05, y: y + 0.12, w: 5.5, h: 0.42, fontSize: 14.5, bold: true, color: C.primary, fontFace: FONT });
    s.addText(r.d, { x: 7.05, y: y + 0.56, w: 5.55, h: 0.68, fontSize: 11.5, color: C.dark, fontFace: FONT, lineSpacingMultiple: 1.15 });
  });
  s.addText('业务员仅需输入船舶四要素（识别号 / IMO 号 / 中英文名任一必填），零培训上手', { x: 0.55, y: 6.55, w: 12.2, h: 0.4, fontSize: 12, italic: true, color: C.gray, fontFace: FONT, align: 'center' });
}

// ==================== S6 业务逻辑：每日调度闭环 ====================
{
  const s = pptx.addSlide();
  header(s, '四、业务逻辑（2）：Agent 每日调度闭环', '06');
  footer(s);
  // T-1 行
  s.addText('T-1 收单日', { x: 0.55, y: 1.25, w: 1.6, h: 0.45, fontSize: 14, bold: true, color: C.white, fontFace: FONT, align: 'center', valign: 'middle', fill: { color: C.primary } });
  const t1 = [
    { t: '收单入库', d: '全司待查询\n按机构隔离' },
    { t: '跨机构去重', d: '同船四要素去重\n省 4 元/次成本' },
    { t: '合规文件生成', d: '总公司单文件\n命名/六列模板' },
    { t: '三重校验上传', d: '命名/路径/表头\n15:00 截单前' },
  ];
  t1.forEach((p, i) => {
    const x = 2.35 + i * 2.75;
    card(s, { x, y: 1.25, w: 2.45, h: 1.35, fill: C.light });
    s.addText(p.t, { x, y: 1.33, w: 2.45, h: 0.4, fontSize: 13, bold: true, color: C.primary, fontFace: FONT, align: 'center' });
    s.addText(p.d, { x, y: 1.75, w: 2.45, h: 0.75, fontSize: 10.5, color: C.gray, fontFace: FONT, align: 'center', lineSpacingMultiple: 1.1 });
    if (i < t1.length - 1) s.addText('▶', { x: x + 2.42, y: 1.72, w: 0.36, h: 0.4, fontSize: 12, color: C.accent, fontFace: FONT, align: 'center' });
  });
  // 中间箭头
  s.addText('▼  中银保信 T+1 返回  ▼', { x: 4.6, y: 2.75, w: 4.2, h: 0.4, fontSize: 13, bold: true, color: C.amber, fontFace: FONT, align: 'center' });
  // T+1 行
  s.addText('T+1 结果日', { x: 0.55, y: 3.35, w: 1.6, h: 0.45, fontSize: 14, bold: true, color: C.white, fontFace: FONT, align: 'center', valign: 'middle', fill: { color: C.accent } });
  const t2 = [
    { t: '三次轮询拉取', d: '09:00/11:00/14:00\n下载 _result 文件' },
    { t: '结构化解析', d: '一船×多险种\n复合值/特殊语义拆解' },
    { t: 'AI 解读', d: '档案回填+双维度评估\n规则+LLM 六节报告' },
    { t: '状态回填交付', d: '全机构状态推进\n查看/下载/评价' },
  ];
  t2.forEach((p, i) => {
    const x = 2.35 + i * 2.75;
    card(s, { x, y: 3.35, w: 2.45, h: 1.35, fill: C.light });
    s.addText(p.t, { x, y: 3.43, w: 2.45, h: 0.4, fontSize: 13, bold: true, color: C.accent, fontFace: FONT, align: 'center' });
    s.addText(p.d, { x, y: 3.85, w: 2.45, h: 0.75, fontSize: 10.5, color: C.gray, fontFace: FONT, align: 'center', lineSpacingMultiple: 1.1 });
    if (i < t2.length - 1) s.addText('▶', { x: x + 2.42, y: 3.82, w: 0.36, h: 0.4, fontSize: 12, color: C.accent, fontFace: FONT, align: 'center' });
  });
  // 底部状态机 + 保障
  card(s, { x: 0.55, y: 5.05, w: 12.23, h: 0.85, fill: C.white, line: 'C9D6EA' });
  s.addText([
    { text: '查询状态机：', options: { bold: true, color: C.primary, fontSize: 12.5 } },
    { text: '待提交 → 已上传 → 已返回 → 已解读（命中秒回记 hit；跨机构去重副本自动绑定船舶、同步推进全机构状态）', options: { color: C.dark, fontSize: 12.5 } },
  ], { x: 0.8, y: 5.05, w: 11.8, h: 0.85, fontFace: FONT, valign: 'middle' });
  s.addText('安全保障：失败自动重试 · 单点失败不阻塞 · AGENT 一键停用 · 全链路任务日志', { x: 0.55, y: 6.15, w: 12.2, h: 0.4, fontSize: 12, color: C.gray, fontFace: FONT, align: 'center' });
}

// ==================== S7 数据流转：分层存储 ====================
{
  const s = pptx.addSlide();
  header(s, '五、数据流转：分层存储架构', '07');
  footer(s);
  // 三层
  const layers = [
    { t: '全量共享层', c: C.primary, d: 'ships 船舶主记录 · ship_policy_results 险种结构化结果（原始行兜底）· ai_reports AI 报告 · ship_profiles 档案缓存', tag: '任何机构命中即可复用' },
    { t: '机构隔离层', c: C.accent, d: 'pending_queries 查询行为与状态机（机构/操作人/时间/hit_type）· org_settings 机构显示名', tag: '仅本机构或上级可见' },
    { t: '系统层', c: '5B9BD5', d: 'agent_task_logs 任务日志（含去重留痕）· server_settings 全局配置 · processed_results 结果去重', tag: '运维与合规审计' },
  ];
  layers.forEach((l, i) => {
    const y = 1.4 + i * 1.55;
    card(s, { x: 0.55, y, w: 12.23, h: 1.35, fill: C.white, line: 'C9D6EA' });
    s.addShape('rect', { x: 0.55, y, w: 2.3, h: 1.35, fill: { color: l.c } });
    s.addText(l.t, { x: 0.55, y: y + 0.22, w: 2.3, h: 0.5, fontSize: 16, bold: true, color: C.white, fontFace: FONT, align: 'center' });
    s.addText(l.tag, { x: 0.65, y: y + 0.75, w: 2.1, h: 0.4, fontSize: 10.5, color: 'D7E5F7', fontFace: FONT, align: 'center' });
    s.addText(l.d, { x: 3.1, y: y + 0.12, w: 9.5, h: 1.1, fontSize: 12.5, color: C.dark, fontFace: FONT, valign: 'middle', lineSpacingMultiple: 1.25 });
  });
  card(s, { x: 0.55, y: 6.15, w: 12.23, h: 0.85, fill: C.light });
  s.addText([
    { text: '分层原则：', options: { bold: true, color: C.primary, fontSize: 13 } },
    { text: '船舶风险数据全司共享（查询提效 + 数据资产化），查询行为严格隔离（合规无泄露）——命中复用只读共享层，不触碰其他机构任何信息', options: { color: C.dark, fontSize: 13 } },
  ], { x: 0.8, y: 6.15, w: 11.8, h: 0.85, fontFace: FONT, valign: 'middle' });
}

// ==================== S8 AI 解读引擎 ====================
{
  const s = pptx.addSlide();
  header(s, '六、AI 解读引擎（核心亮点）', '08');
  footer(s);
  // 左：双维度标签
  s.addText('双维度风险标签体系', { x: 0.55, y: 1.2, w: 6, h: 0.4, fontSize: 15, bold: true, color: C.primary, fontFace: FONT });
  card(s, { x: 0.55, y: 1.68, w: 5.8, h: 2.15, fill: C.white, line: 'C9D6EA' });
  badge(s, { x: 0.85, y: 1.95, w: 1.55, text: '业务品质风险', color: C.accent, size: 11 });
  badge(s, { x: 0.85, y: 2.4, w: 0.5, text: '高', color: C.red, size: 10 });
  badge(s, { x: 1.45, y: 2.4, w: 0.5, text: '中', color: C.amber, size: 10 });
  badge(s, { x: 2.05, y: 2.4, w: 0.5, text: '低', color: C.green, size: 10 });
  s.addText('赔付率 · 出险原因 · 赔案金额', { x: 2.75, y: 2.38, w: 3.4, h: 0.35, fontSize: 10.5, color: C.gray, fontFace: FONT });
  badge(s, { x: 0.85, y: 2.95, w: 1.55, text: '欺诈风险', color: C.accent, size: 11 });
  badge(s, { x: 0.85, y: 3.4, w: 0.5, text: '高', color: C.red, size: 10 });
  badge(s, { x: 1.45, y: 3.4, w: 0.5, text: '中', color: C.amber, size: 10 });
  badge(s, { x: 2.05, y: 3.4, w: 0.5, text: '低', color: C.green, size: 10 });
  s.addText('起保早期出险等骗保特征', { x: 2.75, y: 3.38, w: 3.4, h: 0.35, fontSize: 10.5, color: C.gray, fontFace: FONT });
  card(s, { x: 0.55, y: 4.0, w: 5.8, h: 1.0, fill: C.light });
  s.addText([
    { text: '无记录 ≠ 低风险：', options: { bold: true, color: C.grayTag, fontSize: 12 } },
    { text: '近三年无投保记录标灰色「无数据」，提示补充尽调，杜绝危险空真结论', options: { color: C.dark, fontSize: 12 } },
  ], { x: 0.75, y: 4.0, w: 5.45, h: 1.0, fontFace: FONT, valign: 'middle', lineSpacingMultiple: 1.15 });
  // 规则+LLM
  card(s, { x: 0.55, y: 5.2, w: 5.8, h: 1.55, fill: C.white, line: 'C9D6EA' });
  s.addText('规则引擎 + 大模型双轨', { x: 0.75, y: 5.3, w: 5.4, h: 0.4, fontSize: 13.5, bold: true, color: C.primary, fontFace: FONT });
  s.addText('R1–R6 硬规则 + S1–S6 软信号定级（阈值配置化、可解释）；DeepSeek 生成报告（注入字段字典 / 真实案例 / 235 条保司代码）；LLM 故障自动降级规则版，断网可用', { x: 0.75, y: 5.7, w: 5.45, h: 1.0, fontSize: 11, color: C.dark, fontFace: FONT, lineSpacingMultiple: 1.15 });
  // 右：六节报告
  s.addText('AI 解读报告：固定六节结构', { x: 6.75, y: 1.2, w: 6, h: 0.4, fontSize: 15, bold: true, color: C.primary, fontFace: FONT });
  const secs = [
    '一、船舶档案（船讯网自动回填 / 识别号推算船龄）',
    '二、业务品质分析',
    '三、欺诈风险识别',
    '四、近 3 年单均保额保费（费率推算 / 估损绝对值）',
    '五、风险提示（双维度评级，分色显示）',
    '六、核保建议（结尾附 AI 免责声明）',
  ];
  secs.forEach((t, i) => {
    const y = 1.68 + i * 0.62;
    card(s, { x: 6.75, y, w: 6.03, h: 0.52, fill: i === 4 ? 'FDF3E7' : C.light });
    s.addText(t, { x: 6.95, y, w: 5.7, h: 0.52, fontSize: 12, bold: i === 4, color: C.dark, fontFace: FONT, valign: 'middle' });
  });
  card(s, { x: 6.75, y: 5.55, w: 6.03, h: 1.2, fill: C.white, line: 'C9D6EA' });
  s.addText([
    { text: '交付与闭环：', options: { bold: true, color: C.primary, fontSize: 12 } },
    { text: '带斜向水印 Word 报告 + 原始返回数据 Excel 一键下载；人工评价（星级+准确性标签）反向驱动迭代', options: { color: C.dark, fontSize: 12 } },
  ], { x: 6.95, y: 5.55, w: 5.65, h: 1.2, fontFace: FONT, valign: 'middle', lineSpacingMultiple: 1.2 });
}

// ==================== S9 功能总览 ====================
{
  const s = pptx.addSlide();
  header(s, '七、功能总览', '09');
  footer(s);
  const rows = [
    ['功能模块', '核心能力'],
    ['船舶查询', '四要素表单 · 全量库命中弹窗确认（旧数据/重查二选一）· 险种结果表 + AI 报告'],
    ['我的查询', '状态徽章跟踪 · 发起机构列 · 双维度风险两级表头（各子列高/中/低筛选）· 时间范围切换'],
    ['运行概览', '累计/待查/命中复用（可下钻历史查询机构）· 双维度风险大卡片分色统计'],
    ['船舶详情', '六节 AI 报告（水印）· 返回数据 Excel 下载 · Word 报告下载 · 人工评价'],
    ['管理员面板', 'Agent 启停 · 手动触发（汇总/导入/模拟中银保信返回）· 船舶库全列筛选 · 运行日志'],
    ['安全与合规', '三级账号服务端隔离 · 双重水印防泄露 · 全链路任务日志 · 演示数据仿真脱敏'],
  ];
  const tableRows = rows.map((r, ri) => ri === 0
    ? r.map(t => ({ text: t, options: { bold: true, color: 'FFFFFF', fill: { color: C.primary }, fontSize: 13, align: 'center', valign: 'middle', fontFace: FONT } }))
    : r.map((t, ci) => ({ text: t, options: { color: ci === 0 ? C.primary : C.dark, bold: ci === 0, fill: { color: ri % 2 === 0 ? C.white : C.light }, fontSize: 12, valign: 'middle', fontFace: FONT } })));
  s.addTable(tableRows, {
    x: 0.55, y: 1.35, w: 12.23,
    colW: [2.2, 10.03],
    rowH: [0.5, 0.72, 0.72, 0.72, 0.72, 0.72, 0.72],
    border: { type: 'solid', color: 'C9D6EA', pt: 1 },
  });
}

// ==================== S10 创新点 ====================
{
  const s = pptx.addSlide();
  header(s, '八、创新点', '10');
  footer(s);
  const items = [
    { t: '全量库资产化', d: '查询秒回复用；数据随使用积累为公司级船舶风险资产' },
    { t: '跨机构去重调度', d: '去重与结果全局回填成为无感系统能力，直接节省查询成本' },
    { t: '规则 + LLM 双轨', d: '结论可解释、口径统一，故障自动降级，生产可用' },
    { t: '双维度风险标签', d: '业务品质 × 欺诈独立评估，灰色「无数据」杜绝误判' },
    { t: '外部档案自动回填', d: '自动融合船讯网静态档案，输出完整核保画像' },
    { t: '水印防泄露溯源', d: '页面 + Word 双重「机构·账号」斜向水印，泄露可追责' },
  ];
  items.forEach((p, i) => {
    const x = 0.55 + (i % 3) * 4.18, y = 1.5 + Math.floor(i / 3) * 2.45;
    card(s, { x, y, w: 3.86, h: 2.2, fill: C.white, line: 'C9D6EA' });
    s.addShape('roundRect', { x: x + 0.25, y: y + 0.22, w: 0.55, h: 0.55, rectRadius: 0.08, fill: { color: C.accent } });
    s.addText(`${i + 1}`, { x: x + 0.25, y: y + 0.2, w: 0.55, h: 0.55, fontSize: 18, bold: true, color: C.white, fontFace: FONT, align: 'center', valign: 'middle' });
    s.addText(p.t, { x: x + 0.95, y: y + 0.26, w: 2.8, h: 0.5, fontSize: 15, bold: true, color: C.primary, fontFace: FONT, valign: 'middle' });
    s.addText(p.d, { x: x + 0.28, y: y + 0.95, w: 3.35, h: 1.1, fontSize: 11.5, color: C.dark, fontFace: FONT, lineSpacingMultiple: 1.25 });
  });
}

// ==================== S11 业务价值 ====================
{
  const s = pptx.addSlide();
  header(s, '九、业务价值', '11');
  footer(s);
  // 四个大数字卡
  const nums = [
    { v: '0 安装', d: '网页登录即用\n替代 12 步客户端安装', c: C.primary },
    { v: 'T+1 稳定', d: '100% 替代人工汇总上传\n反馈时效从 T+2 稳定到 T+1', c: C.accent },
    { v: '2h+/日', d: '节省基层操作工时\n（安装/汇总/整理/解读）', c: '2E9B8F' },
    { v: '100万+/年', d: '拦截高赔付客户\n预计年减少赔案损失', c: C.red },
  ];
  nums.forEach((n, i) => {
    const x = 0.55 + i * 3.14;
    card(s, { x, y: 1.4, w: 2.9, h: 2.3, fill: C.white, line: 'C9D6EA' });
    s.addShape('rect', { x, y: 1.4, w: 2.9, h: 0.09, fill: { color: n.c } });
    s.addText(n.v, { x, y: 1.62, w: 2.9, h: 0.75, fontSize: 30, bold: true, color: n.c, fontFace: FONT, align: 'center' });
    s.addText(n.d, { x: x + 0.15, y: 2.45, w: 2.6, h: 1.1, fontSize: 11.5, color: C.gray, fontFace: FONT, align: 'center', lineSpacingMultiple: 1.25 });
  });
  // 底部补充价值
  card(s, { x: 0.55, y: 4.1, w: 12.23, h: 1.1, fill: C.light });
  s.addText([
    { text: '更多收益：', options: { bold: true, color: C.primary, fontSize: 13 } },
    { text: '全量库命中秒回（免 T+1 等待，重复查询率越高提效越显著）· 跨机构去重直接节省 4 元/次查询成本 · 新核保人上手成本趋近于零', options: { color: C.dark, fontSize: 13 } },
  ], { x: 0.8, y: 4.1, w: 11.8, h: 1.1, fontFace: FONT, valign: 'middle', lineSpacingMultiple: 1.25 });
  card(s, { x: 0.55, y: 5.5, w: 12.23, h: 1.25, fill: C.primary });
  s.addText('推动船舶险风控从「事后理赔」向「事前预防」全面转型', { x: 0.8, y: 5.62, w: 11.8, h: 0.5, fontSize: 17, bold: true, color: C.white, fontFace: FONT, align: 'center' });
  s.addText('解放一线操作 · 决策前即得结构化风险画像 · 管理层面板化掌握全司风控态势', { x: 0.8, y: 6.15, w: 11.8, h: 0.45, fontSize: 12.5, color: 'D7E5F7', fontFace: FONT, align: 'center' });
}

// ==================== S12 结语 ====================
{
  const s = pptx.addSlide();
  s.background = { color: C.primary };
  s.addShape('rect', { x: 9.2, y: 4.8, w: 6, h: 4.2, rotate: 18, fill: { color: '26508A' } });
  s.addShape('rect', { x: -1.5, y: -1.5, w: 6, h: 3.2, rotate: 18, fill: { color: '26508A' } });
  s.addText('从创意到落地的完整闭环', { x: 1.0, y: 2.0, w: 11.3, h: 0.8, fontSize: 34, bold: true, color: C.white, fontFace: FONT });
  s.addShape('rect', { x: 1.05, y: 2.95, w: 2.6, h: 0.035, fill: { color: '4FC3F7' } });
  const pts = [
    '真实系统：可运行、可演示，27 文件解析回归零异常，31 项端到端断言通过',
    '业务准绳：规则对齐业务专家评估维度与总公司报告模板，水印合规防泄露',
    '清晰演进：赛后接 SSO / 内网大模型，灰度试点 2-3 家分公司后全量推广',
    '模式复制：可平移至货运险、企财险等「查询—返回—解读」同类险种',
  ];
  pts.forEach((t, i) => {
    s.addText('✔  ' + t, { x: 1.1, y: 3.35 + i * 0.62, w: 11, h: 0.5, fontSize: 15, color: 'D7E5F7', fontFace: FONT });
  });
  s.addText('谢谢观看 · 船舶险反欺诈智盾', { x: 1.0, y: 6.3, w: 11.3, h: 0.6, fontSize: 20, bold: true, color: '4FC3F7', fontFace: FONT });
}

// ---------- 输出 ----------
const OUT = path.resolve(__dirname, '../../作品介绍-船舶险反欺诈查询智能体.pptx');
pptx.writeFile({ fileName: OUT }).then(() => {
  console.log('生成完成:', OUT, `(${(fs.statSync(OUT).size / 1024).toFixed(1)} KB)`);
});
