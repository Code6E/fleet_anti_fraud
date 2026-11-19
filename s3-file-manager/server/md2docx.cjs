/**
 * Markdown → Word（.docx）转换脚本
 * 用途：把演示视频脚本等 Markdown 文档转成可交付/下载的 Word 文件
 * 排版对齐项目规范：标题华文中宋、节标题黑体、正文仿宋，表格深蓝表头
 * 支持的 Markdown 语法：# 标题、- 列表、- [ ] 待办、1. 有序列表、> 引用、
 * **加粗**、`行内代码`、``` 代码块、| 表格 |、--- 分隔线
 * 用法：node md2docx.cjs <输入.md> [输出.docx]
 */
const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, WidthType, BorderStyle, VerticalAlign, ShadingType, HeightRule,
} = require('docx');

const FONT_TITLE = { ascii: '华文中宋', eastAsia: '华文中宋', hAnsi: '华文中宋' };
const FONT_HEAD = { ascii: '黑体', eastAsia: '黑体', hAnsi: '黑体' };
const FONT_BODY = { ascii: '仿宋', eastAsia: '仿宋', hAnsi: '仿宋' };
const FONT_MONO = { ascii: 'Consolas', eastAsia: '仿宋', hAnsi: 'Consolas' };

const COLOR_DARK = '1F3864';  // 深蓝：标题 / 表头底纹
const COLOR_LINE = '8EAADB';  // 表格边框
const COLOR_GRAY = '595959';  // 次要文字
const COLOR_QUOTE_BG = 'F2F5FA';
const USABLE_WIDTH = 9020;    // A4 - 左右 2.5cm 页边距后的可用宽度（DXA）

// ---------- 行内语法：**加粗** 与 `代码`（支持 `**` 包裹 `` ` `` 的嵌套写法） ----------
function splitBy(text, re, key) {
  const out = [];
  let last = 0, m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push({ t: text.slice(last, m.index), [key]: false });
    out.push({ t: m[1], [key]: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ t: text.slice(last), [key]: false });
  return out;
}
function parseInline(text, base = {}) {
  const size = base.size || 24;
  const font = base.font || FONT_BODY;
  const runs = [];
  for (const seg of splitBy(text, /\*\*([^*]+)\*\*/g, 'bold')) {
    for (const part of splitBy(seg.t, /`([^`]+)`/g, 'code')) {
      if (part.code) {
        runs.push(new TextRun({ text: part.t, size: size - 2, font: FONT_MONO, color: '1F4E79', bold: seg.bold || base.bold }));
      } else if (part.t) {
        runs.push(new TextRun({ text: part.t, size, font, color: base.color, bold: seg.bold || base.bold }));
      }
    }
  }
  return runs.length ? runs : [new TextRun({ text: '', size, font })];
}

// ---------- 块级构造 ----------
const docTitle = (t) => new Paragraph({
  alignment: AlignmentType.CENTER, spacing: { before: 0, after: 120 },
  children: parseInline(t, { size: 36, font: FONT_TITLE, bold: true, color: COLOR_DARK }),
});
const h1 = (t) => new Paragraph({
  spacing: { before: 320, after: 140 }, keepNext: true,
  children: parseInline(t, { size: 30, font: FONT_HEAD, bold: true, color: COLOR_DARK }),
});
const h2 = (t) => new Paragraph({
  spacing: { before: 240, after: 100 }, keepNext: true,
  children: parseInline(t, { size: 26, font: FONT_HEAD, bold: true }),
});
const h3 = (t) => new Paragraph({
  spacing: { before: 200, after: 80 }, keepNext: true,
  children: parseInline(t, { size: 24, font: FONT_HEAD, bold: true, color: '2F5496' }),
});
const body = (t) => new Paragraph({
  spacing: { after: 80, line: 320 }, indent: { firstLine: 480 },
  children: parseInline(t),
});
const bullet = (t, mark = '●') => new Paragraph({
  spacing: { after: 60, line: 320 }, indent: { left: 600, hanging: 300 },
  children: [new TextRun({ text: mark + ' ', size: 18, font: FONT_BODY, color: COLOR_DARK }), ...parseInline(t)],
});
const numbered = (t, n) => new Paragraph({
  spacing: { after: 60, line: 320 }, indent: { left: 600, hanging: 300 },
  children: [new TextRun({ text: n + '. ', size: 24, font: FONT_BODY, bold: true, color: COLOR_DARK }), ...parseInline(t)],
});
const quote = (t) => new Paragraph({
  spacing: { after: 60, line: 320 }, indent: { left: 360, right: 200 },
  border: { left: { style: BorderStyle.SINGLE, size: 18, color: COLOR_LINE, space: 12 } },
  shading: { type: ShadingType.CLEAR, color: 'auto', fill: COLOR_QUOTE_BG },
  children: parseInline(t, { size: 22, color: '333F50' }),
});
const codeLine = (t) => new Paragraph({
  spacing: { after: 0, line: 260 }, indent: { left: 300 },
  shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'F5F5F5' },
  children: [new TextRun({ text: t || ' ', size: 20, font: FONT_MONO, color: '24292E' })],
});
const rule = () => new Paragraph({
  spacing: { before: 60, after: 120 },
  border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: COLOR_LINE, space: 1 } },
  children: [new TextRun({ text: '', size: 2 })],
});

// ---------- 表格 ----------
function cell(text, { header = false, width }) {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    verticalAlign: VerticalAlign.CENTER,
    shading: header ? { type: ShadingType.CLEAR, color: 'auto', fill: COLOR_DARK } : undefined,
    children: [new Paragraph({
      spacing: { after: 0, line: 260 },
      alignment: header ? AlignmentType.CENTER : AlignmentType.LEFT,
      children: parseInline(text, header
        ? { size: 22, font: FONT_HEAD, bold: true, color: 'FFFFFF' }
        : { size: 22 }),
    })],
  });
}
function buildTable(headerCells, rowCells) {
  const cols = headerCells.length;
  // 按各列内容长度分配宽度（最少 8%，避免长文本列被压扁）
  const weight = headerCells.map((h, i) => {
    const lens = [h.length, ...rowCells.map((r) => (r[i] || '').length)];
    return Math.min(Math.max(Math.max(...lens), 4), 60);
  });
  const sum = weight.reduce((a, b) => a + b, 0);
  const widths = weight.map((w) => Math.max(Math.round((w / sum) * USABLE_WIDTH), Math.round(USABLE_WIDTH * 0.08)));
  const fix = USABLE_WIDTH - widths.reduce((a, b) => a + b, 0);
  widths[cols - 1] += fix;

  const border = { style: BorderStyle.SINGLE, size: 4, color: COLOR_LINE };
  return new Table({
    width: { size: USABLE_WIDTH, type: WidthType.DXA },
    columnWidths: widths,
    borders: { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border },
    rows: [
      new TableRow({ tableHeader: true, children: headerCells.map((h, i) => cell(h, { header: true, width: widths[i] })) }),
      ...rowCells.map((r) => new TableRow({
        height: { value: 300, rule: HeightRule.ATLEAST },
        children: headerCells.map((_, i) => cell(r[i] || '', { width: widths[i] })),
      })),
    ],
  });
}
const tableGap = () => new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: '', size: 2 })] });

// ---------- Markdown 解析 ----------
function splitRow(line) {
  return line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());
}
function isTableSep(line) {
  return /^\s*\|?[\s:|-]*-{2,}[\s:|-]*\|?\s*$/.test(line) && line.includes('-');
}

function convert(md) {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0, firstH1 = true, inCode = false, codeBuf = [];
  while (i < lines.length) {
    const raw = lines[i];

    if (/^\s*```/.test(raw)) {
      if (!inCode) { inCode = true; codeBuf = []; }
      else { codeBuf.forEach((l) => out.push(codeLine(l))); out.push(tableGap()); inCode = false; }
      i++; continue;
    }
    if (inCode) { codeBuf.push(raw.replace(/\t/g, '    ')); i++; continue; }

    const line = raw.trimEnd();
    if (!line.trim()) { i++; continue; }

    // 表格
    if (line.trim().startsWith('|') && lines[i + 1] && isTableSep(lines[i + 1])) {
      const header = splitRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) { rows.push(splitRow(lines[i])); i++; }
      out.push(buildTable(header, rows));
      out.push(tableGap());
      continue;
    }

    // 标题
    let m = line.match(/^(#{1,6})\s+(.*)$/);
    if (m) {
      const level = m[1].length, text = m[2].trim();
      if (level === 1 && firstH1) { out.push(docTitle(text)); firstH1 = false; }
      else if (level <= 2) out.push(h1(text));
      else if (level === 3) out.push(h2(text));
      else out.push(h3(text));
      i++; continue;
    }

    // 分隔线
    if (/^-{3,}$|^\*{3,}$/.test(line.trim())) { out.push(rule()); i++; continue; }

    // 引用（允许缩进），连续引用行归为一段，空引用行分段
    if (/^\s*>/.test(raw)) {
      let buf = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        const t = lines[i].replace(/^\s*>\s?/, '').trim();
        if (t) buf.push(t);
        else if (buf.length) { out.push(quote(buf.join(' '))); buf = []; }
        i++;
      }
      if (buf.length) out.push(quote(buf.join(' ')));
      out.push(tableGap());
      continue;
    }

    // 列表
    m = raw.match(/^\s*[-*]\s+\[([ xX])\]\s+(.*)$/);
    if (m) { out.push(bullet(m[2], m[1] === ' ' ? '□' : '☑')); i++; continue; }
    m = raw.match(/^\s*[-*]\s+(.*)$/);
    if (m) { out.push(bullet(m[1])); i++; continue; }
    m = raw.match(/^\s*(\d+)\.\s+(.*)$/);
    if (m) { out.push(numbered(m[2], m[1])); i++; continue; }

    out.push(body(line.trim()));
    i++;
  }
  if (inCode) codeBuf.forEach((l) => out.push(codeLine(l)));
  return out;
}

// ---------- 主流程 ----------
const src = process.argv[2];
if (!src) { console.error('用法：node md2docx.cjs <输入.md> [输出.docx]'); process.exit(1); }
const srcPath = path.resolve(src);
const outPath = path.resolve(process.argv[3] || srcPath.replace(/\.md$/i, '') + '.docx');

const md = fs.readFileSync(srcPath, 'utf8');
const doc = new Document({
  creator: '船舶险反欺诈智盾',
  title: path.basename(srcPath, path.extname(srcPath)),
  styles: {
    default: {
      document: { run: { font: FONT_BODY, size: 24, color: '000000' }, paragraph: { spacing: { line: 320 } } },
    },
  },
  sections: [{
    properties: {
      page: {
        size: { width: 11906, height: 16838 },  // A4 竖版
        margin: { top: 1418, bottom: 1418, left: 1418, right: 1418 },
      },
    },
    children: convert(md),
  }],
});

Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(outPath, buf);
  console.log('已生成：' + outPath + '（' + (buf.length / 1024).toFixed(1) + ' KB）');
}).catch((e) => { console.error('生成失败：' + e.stack); process.exit(1); });
