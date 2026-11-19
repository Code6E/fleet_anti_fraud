import ExcelJS from 'exceljs';
const files = [
  '/Users/luoyuqing/船舶反欺诈/船舶_000012_20260825_广东分公司.xlsx',
  '/Users/luoyuqing/船舶反欺诈/船舶_000012_20260825_广东分公司_result.xlsx',
  '/Users/luoyuqing/Downloads/A01_000001_20240313湖南分公司.xlsx',
];
for (const f of files) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(f);
  const ws = wb.worksheets[0];
  console.log('=== ' + f.split('/').pop() + ' | sheet=' + ws.name + ' rows=' + ws.rowCount + ' cols=' + ws.columnCount);
  const limit = Math.min(4, ws.rowCount);
  for (let r = 1; r <= limit; r++) {
    const row = ws.getRow(r);
    const vals = [];
    for (let c = 1; c <= ws.columnCount; c++) {
      let v = row.getCell(c).value;
      if (v == null) { vals.push(''); continue; }
      if (typeof v === 'object') {
        if (v.text != null) v = v.text;
        else if (v.richText) v = v.richText.map(t => t.text).join('');
        else if (v.result != null) v = v.result;
        else v = JSON.stringify(v);
      }
      vals.push(String(v).slice(0, 40));
    }
    console.log('  R' + r + ': ' + vals.join(' | '));
  }
  console.log('');
}
