// AI 解读报告 PDF（.pdf）导出（由 Word 版迁移而来）
// - 排版对齐《船舶险智盾报告模板.docx》：标题 华文中宋 14pt 居中；节标题 黑体 12pt；正文 仿宋 10.5pt
// - 第五节评级词（低风险/中风险/高风险/无数据）单独着色加粗：低 00A651 / 中 D6A419 / 高 E02020 / 无数据 808080
// - 每页叠加斜向半透明水印（机构 · 账号）
// - 说明：报告正文以 Markdown 标题（# 「xxx」智盾解读）开头，元信息行（船舶/识别号/IMO/风险等级/分析模型/生成时间）不再输出
import PDFDocument from 'pdfkit';
import fs from 'node:fs';
import path from 'node:path';

// 风险等级配色（与 Word 版口径一致：中风险用加深琥珀黄而非纯黄）
const LEVEL_COLOR = { 低风险: '#00A651', 中风险: '#D6A419', 高风险: '#E02020', 无数据: '#808080' };

// 字体候选（角色 → 依优先级尝试的字体文件名，大小写在 Windows 文件系统上不敏感）
const FONT_DIR = process.platform === 'win32'
  ? 'C:\\Windows\\Fonts'
  : process.platform === 'darwin'
    ? '/System/Library/Fonts'
    : '/usr/share/fonts';
const FONT_CANDIDATES = {
  title: ['STZHONGS.TTF', 'STZhongsong.ttf', 'simhei.ttf', 'msyh.ttf'],
  head: ['simhei.ttf', 'msyh.ttf', 'STHEIT.TTF'],
  body: ['simfang.ttf', 'STFANGSO.TTF', 'STFangsong.ttf', 'simkai.ttf', 'simhei.ttf'],
};

function resolveFont(candidates) {
  for (const f of candidates) {
    const p = path.join(FONT_DIR, f);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// 报告 Markdown → PDF：写入 body，返回 Buffer
export async function buildReportPdf({ reportMd, watermarkText }) {
  const fontPaths = {
    title: resolveFont(FONT_CANDIDATES.title),
    head: resolveFont(FONT_CANDIDATES.head),
    body: resolveFont(FONT_CANDIDATES.body),
  };
  if (!fontPaths.body) {
    throw new Error('未找到可用的中文字体（仿宋/黑体），无法生成中文 PDF 报告');
  }

  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 60, bottom: 60, left: 56, right: 56 },
    bufferPages: true,
    info: { Title: 'AI 解读报告', Author: watermarkText || '内部资料' },
  });

  // 注册命名字体（body 兜底复用到缺失的角色）
  doc.registerFont('title', fontPaths.title || fontPaths.head || fontPaths.body);
  doc.registerFont('head', fontPaths.head || fontPaths.body);
  doc.registerFont('body', fontPaths.body);

  const left = doc.page.margins.left;
  const contentWidth = doc.page.width - left - doc.page.margins.right;

  // 行内标记 → 着色/加粗片段：**加粗**；评级词按等级着色
  function writeInline(line, baseSize) {
    const parts = String(line).split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
    parts.forEach((p, idx) => {
      const last = idx === parts.length - 1;
      const opts = { continued: !last, width: contentWidth, lineGap: 3 };
      if (p.startsWith('**') && p.endsWith('**')) {
        const inner = p.slice(2, -2);
        doc.font('head').fontSize(baseSize).fillColor(LEVEL_COLOR[inner] || '#000000');
        doc.text(inner, opts);
      } else {
        doc.font('body').fontSize(baseSize).fillColor('#000000');
        doc.text(p, opts);
      }
    });
    if (!parts.length) doc.text('', { width: contentWidth });
  }

  for (const raw of String(reportMd || '').split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) { doc.moveDown(0.25); continue; }
    if (line.startsWith('## ')) {
      doc.font('head').fontSize(12).fillColor('#000000');
      doc.text(line.slice(3).trim(), { width: contentWidth, spaceBefore: 8, spaceAfter: 4 });
    } else if (line.startsWith('# ')) {
      doc.font('title').fontSize(14).fillColor('#000000');
      doc.text(line.slice(2).trim(), { width: contentWidth, align: 'center', spaceAfter: 8 });
    } else if (/^[-*·]\s+/.test(line)) {
      doc.text('·   ', left, doc.y, { continued: true, lineGap: 3 });
      writeInline(line.replace(/^[-*·]\s+/, ''), 10.5);
    } else {
      writeInline(line, 10.5);
    }
  }

  // 斜向水印：逐页叠加（覆盖上/中/下三档，旋转 ±45° 于页心）
  const wm = String(watermarkText || '内部资料');
  const range = doc.bufferedPageRange();
  doc.font('head').fontSize(22);
  const wmWidth = doc.widthOfString(wm);
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const w = doc.page.width;
    const h = doc.page.height;
    for (const fy of [0.22, 0.5, 0.78]) {
      doc.save();
      doc.opacity(0.14).fillColor('#808080').font('head').fontSize(22);
      doc.rotate(-45, { origin: [w / 2, h * fy] });
      doc.text(wm, w / 2 - wmWidth / 2, h * fy, { width: wmWidth, align: 'center', lineBreak: false });
      doc.restore();
    }
  }

  // 先挂载流监听再结束，避免丢失早期分块
  const buffer = new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  doc.end();
  return buffer;
}
