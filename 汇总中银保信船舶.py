# -*- coding: utf-8 -*-
"""
中银保信查询结果全量汇总脚本
1. 读取 中银保信查询结果/ 下全部 *_result.xlsx（每行为一船一险种记录）
2. 按船舶去重：识别号优先，缺失时用船名兜底（若船名在别的查询中对应唯一识别号则归并）；
   同一船舶保留最近一次查询（文件名日期，缺失时回退文件修改时间）的全部险种行
3. 近3年赔案金额合计（null 视为 0）
4. 双维度风险判定（《船舶险智盾-陶超莹/风险评估维度.xlsx》，口径与 s3-file-manager
   interpret.js evaluateRiskDimensions 一致）：业务品质风险 / 欺诈风险 ∈ {高, 中, 低, 空}
5. 输出 中银保信船舶汇总表.xlsx：船舶汇总（带单元格颜色）+ 去重明细 + 判定标准说明
"""
import glob
import os
import re
import datetime
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.utils import get_column_letter

BASE = os.path.dirname(os.path.abspath(__file__))
SRC_DIR = os.path.join(BASE, '中银保信查询结果')
OUT_PATH = os.path.join(BASE, '中银保信船舶汇总表.xlsx')

NULL_STR = {'', '(null)', 'null', 'None', 'none', 'NULL'}


def clean(v):
    """单元格 → 去空格字符串；空/None 返回 ''"""
    if v is None:
        return ''
    return str(v).strip()


def is_null(v):
    return clean(v) in NULL_STR


# ---------- 字段解析（口径对齐 server/src/excel.js + interpret.js） ----------

def parse_ratio(v):
    """'Z,0,0,0' → ['Z','0','0','0']；'(null)' → None"""
    s = clean(v)
    if s in NULL_STR:
        return None
    return [x.strip() for x in s.split(',')]


def ratio_num(x):
    """赔付率单项 → 数值；Z/非数值 → None"""
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def parse_causes(v):
    """'台风:2' / '人伤|2,碰撞、触碰|2' / '搁浅2次' → {raw, items:[(cause,count)]}"""
    s = clean(v)
    if s in NULL_STR:
        return None
    items = []
    for seg in re.split(r'[,，]', s):
        seg = seg.strip()
        if not seg:
            continue
        m = re.match(r'^(.*?)[|:：]\s*(\d+)$', seg)
        if m:
            items.append((m.group(1).strip(), int(m.group(2))))
            continue
        m = re.match(r'^(.*?)(\d+)\s*次$', seg)
        if m:
            items.append((m.group(1).strip(), int(m.group(2))))
    return {'raw': s, 'items': items}


def parse_claim(v):
    """近3年赔案金额 → float；null 视为 0"""
    if v is None:
        return 0.0
    if isinstance(v, (int, float)):
        return float(v)
    s = clean(v)
    if s in NULL_STR:
        return 0.0
    try:
        return float(s.replace(',', '').replace('，', ''))
    except ValueError:
        return 0.0


def parse_early(v):
    """'0,0.00%' → {count:0,pct:0}；'1' → {count:1,pct:None}；'(null)' → None"""
    s = clean(v)
    if s in NULL_STR:
        return None
    m = re.match(r'^(\d+)\s*,\s*([\d.]+)%$', s)
    if m:
        return {'count': int(m.group(1)), 'pct': float(m.group(2)), 'raw': s}
    try:
        return {'count': float(s), 'pct': None, 'raw': s}
    except ValueError:
        return {'count': None, 'pct': None, 'raw': s}


def early_state(e):
    """none=无数据 / zero=0,0.00% / claim=有出险 / unknown=有值但格式异常（按有出险处理）"""
    if e is None:
        return 'none'
    if e['count'] is not None:
        return 'claim' if e['count'] > 0 else 'zero'
    return 'unknown'


# ---------- 文件名日期解析 ----------

def parse_file_date(fname):
    b = os.path.basename(fname)
    m = re.search(r'(20\d{2})[.\-年](\d{1,2})[.\-/月](\d{1,2})', b)
    if m:
        y, mo, d = m.group(1), int(m.group(2)), int(m.group(3))
        if 1 <= mo <= 12 and 1 <= d <= 31:
            return '%s%02d%02d' % (y, mo, d)
    m = re.search(r'(20\d{6})', b)
    if m:
        s = m.group(1)
        if 1 <= int(s[4:6]) <= 12 and 1 <= int(s[6:8]) <= 31:
            return s
    return ''


def fmt_date(ds):
    if not ds:
        return ''
    try:
        return '%s-%s-%s' % (ds[:4], ds[4:6], ds[6:8])
    except Exception:
        return ds


# ---------- 读取全部文件 ----------

def load_all():
    files = sorted(glob.glob(os.path.join(SRC_DIR, '*.xlsx')))
    rows = []  # 每条 = 一行险种记录
    for f in files:
        try:
            wb = openpyxl.load_workbook(f, read_only=True)
            ws = wb.worksheets[0]
            data = list(ws.iter_rows(values_only=True))
            wb.close()
        except Exception as e:
            print('[WARN] 读取失败 %s: %s' % (f, e))
            continue
        date = parse_file_date(f)
        if not date:
            date = datetime.datetime.fromtimestamp(os.path.getmtime(f)).strftime('%Y%m%d')
        for r in data[1:]:
            if not any(v is not None for v in r):
                continue
            sid = clean(r[2])
            name_cn = clean(r[4])
            name_en = clean(r[5])
            if not sid and not name_cn and not name_en:
                continue
            rows.append({
                'file': os.path.basename(f), 'date': date,
                'sid': sid, 'imo': clean(r[3]), 'name_cn': name_cn, 'name_en': name_en,
                'subtype': clean(r[6]),
                'ratio_paid_raw': clean(r[7]), 'ratio_total': parse_ratio(r[8]),
                'ratio_total_raw': clean(r[8]),
                'causes': parse_causes(r[9]), 'claim': parse_claim(r[10]),
                'claim_raw': clean(r[10]), 'range_raw': clean(r[11]),
                'e1': parse_early(r[12]), 'e2': parse_early(r[13]), 'e3': parse_early(r[14]),
                'insurer_count': clean(r[15]), 'insurer_code': clean(r[16]),
                'avg_ap_raw': clean(r[17]),
            })
    return rows


# ---------- 去重：识别号优先，船名兜底 ----------

def dedup(rows):
    # 船名 → 识别号 唯一映射（用于无识别号行归并到有识别号的船）
    name2ids, id2names = {}, {}
    for r in rows:
        if r['sid'] and r['name_cn']:
            name2ids.setdefault(r['name_cn'], set()).add(r['sid'])
            id2names.setdefault(r['sid'], set()).add(r['name_cn'])
    name_map = {n: list(s)[0] for n, s in name2ids.items() if len(s) == 1}

    def key_of(r):
        if r['sid']:
            return ('ID', r['sid'])
        if r['name_cn'] and r['name_cn'] in name_map:
            return ('ID', name_map[r['name_cn']])
        if r['name_cn']:
            return ('NAME', r['name_cn'])
        return ('EN', r['name_en'])

    # (全局key, 文件) → 该查询实例的全部险种行
    instances = {}
    for r in rows:
        k = key_of(r)
        ik = (k, r['file'])
        instances.setdefault(ik, {'key': k, 'file': r['file'], 'date': r['date'], 'rows': []})
        instances[ik]['rows'].append(r)

    ships = {}
    for inst in instances.values():
        k = inst['key']
        ships.setdefault(k, []).append(inst)

    result = []
    for k, insts in ships.items():
        # 保留最近一次查询：日期 → 险种行数 → 文件名（同日多次查询取行数多者）
        best = max(insts, key=lambda x: (x['date'], len(x['rows']), x['file']))
        all_names = set()
        for it in insts:
            for r in it['rows']:
                if r['name_cn']:
                    all_names.add(r['name_cn'])
        result.append({
            'key': k,
            'sid': best['rows'][0]['sid'] or (k[1] if k[0] == 'ID' else ''),
            'names': sorted(all_names) or [best['rows'][0]['name_cn'] or best['rows'][0]['name_en']],
            'imo': next((r['imo'] for r in best['rows'] if r['imo']), ''),
            'query_count': len(insts),
            'first_date': min(i['date'] for i in insts),
            'last_date': best['date'],
            'last_file': best['file'],
            'policies': best['rows'],
        })
    return result


# ---------- 双维度风险判定（对齐 interpret.js evaluateRiskDimensions） ----------

def evaluate_business(ps):
    """返回 (等级, 说明)；等级 ∈ 高/中/低/空"""
    has_biz = any(p['ratio_total'] or p['causes'] or p['claim_raw'] not in NULL_STR for p in ps)
    if not has_biz:
        return '空', '无承保理赔数据，无法评估'

    reasons = []
    # 高①：全部险种赔付率（已决+未决）中超 100% 的数值 ≥ 4 个
    over_n = 0
    for p in ps:
        for v in (p['ratio_total'] or []):
            n = ratio_num(v)
            if n is not None and n > 100:
                over_n += 1
    if over_n >= 4:
        reasons.append('全部险种赔付率（已决+未决）中超100%%的数值共%d个（≥4个）' % over_n)
    # 高②：任一险种前两个年度（当年/Y-1）赔付率任一超 500%（出险转保可能）
    for p in ps:
        lt = p['ratio_total'] or []
        for i in range(min(2, len(lt))):
            n = ratio_num(lt[i])
            if n is not None and n > 500:
                reasons.append('%s：当年/Y-1赔付率%s%%（超500%%，存在出险转保的可能性）'
                               % (p['subtype'] or '未知险种', lt[i]))
                break
        else:
            continue
        break
    # 高③：任一出险原因数量超 3
    for p in ps:
        for cause, cnt in ((p['causes'] or {}).get('items') or []):
            if cnt > 3:
                reasons.append('%s：出险原因「%s」数量%d（超过3）' % (p['subtype'] or '未知险种', cause, cnt))
    if reasons:
        return '高', '；'.join(reasons)

    # 低风险三条件
    all_below = all(
        all((ratio_num(v) is None) or (ratio_num(v) < 55) for v in (p['ratio_total'] or []))
        for p in ps)
    cause_total = sum(
        sum(cnt for _, cnt in ((p['causes'] or {}).get('items') or [])) for p in ps)
    claim_total = sum(p['claim'] for p in ps)
    ok1 = all_below
    ok2 = cause_total <= 1
    ok3 = claim_total < 100000
    if ok1 and ok2 and ok3:
        return '低', ('赔付率数值均低于55%%、出险原因合计%d（≤1）、赔案金额合计%.2f元（<10万元），'
                      '同时满足低风险三条件' % (cause_total, claim_total))
    return '中', ('未命中高风险，且不同时满足低风险三条件（赔付率均<55%%：%s；出险原因合计%d≤1：%s；'
                  '赔案金额合计%.2f元<10万元：%s）'
                  % ('是' if ok1 else '否', cause_total, '是' if ok2 else '否',
                     claim_total, '是' if ok3 else '否'))


def evaluate_fraud(ps):
    """返回 (等级, 说明)；等级 ∈ 高/中/低/空"""
    any1m, any23m, has_data = False, False, False
    for p in ps:
        s1, s2, s3 = early_state(p['e1']), early_state(p['e2']), early_state(p['e3'])
        if s1 != 'none' or s2 != 'none' or s3 != 'none':
            has_data = True
        if s1 in ('claim', 'unknown'):
            any1m = True
        if s2 in ('claim', 'unknown') or s3 in ('claim', 'unknown'):
            any23m = True
    if not has_data:
        return '空', '近1年起保当月/2个月/3个月出险数据缺失，无法评估'
    if any1m:
        reasons = []
        for p in ps:
            e = p['e1']
            if e and (e['count'] is None or e['count'] > 0):
                reasons.append('%s：近1年起保当月出险保单%s单、占比%s（非0,0.00%%）'
                               % (p['subtype'] or '未知险种',
                                  '?' if e['count'] is None else int(e['count']),
                                  ('%.2f%%' % e['pct']) if e['pct'] is not None else e['raw']))
        return '高', '；'.join(reasons)
    if any23m:
        reasons = []
        for p in ps:
            parts = []
            for e, lbl in ((p['e2'], '2个月'), (p['e3'], '3个月')):
                if e and (e['count'] is None or e['count'] > 0):
                    parts.append('起保%s出险%s单/%s'
                                 % (lbl, '?' if e['count'] is None else int(e['count']),
                                    ('%.2f%%' % e['pct']) if e['pct'] is not None else e['raw']))
            if parts:
                reasons.append('%s：%s（当月无出险，存在早期出险但未达当月出险程度）'
                               % (p['subtype'] or '未知险种', '、'.join(parts)))
        return '中', '；'.join(reasons)
    return '低', '所有险种近1年起保当月/2个月/3个月出险保单数量及占比均为0,0.00%'


def early_summary(ps):
    """起保早期出险摘要（各险种合计单数）"""
    tot = {'当月': 0, '2个月': 0, '3个月': 0}
    unknown = False
    has = False
    for p in ps:
        for e, lbl in ((p['e1'], '当月'), (p['e2'], '2个月'), (p['e3'], '3个月')):
            if e is None:
                continue
            has = True
            if e['count'] is None:
                unknown = True
            else:
                tot[lbl] += e['count']
    if not has:
        return '无数据'
    s = '当月合计%d单、2个月合计%d单、3个月合计%d单' % (tot['当月'], tot['2个月'], tot['3个月'])
    if unknown:
        s += '（含格式异常值）'
    return s


# ---------- 输出 Excel ----------

FILLS = {
    '高': PatternFill('solid', fgColor='FFC7CE'),
    '中': PatternFill('solid', fgColor='FFEB9C'),
    '低': PatternFill('solid', fgColor='C6EFCE'),
    '空': PatternFill('solid', fgColor='D9D9D9'),
}
FONTS = {
    '高': Font(color='9C0006', bold=True),
    '中': Font(color='9C6500', bold=True),
    '低': Font(color='006100', bold=True),
    '空': Font(color='808080', bold=True),
}
CENTER = Alignment(horizontal='center', vertical='center')
WRAP = Alignment(vertical='center', wrap_text=True)

RISK_ORDER = {'高': 0, '中': 1, '低': 2, '空': 3}


def write_excel(ships):
    for s in ships:
        s['biz_level'], s['biz_note'] = evaluate_business(s['policies'])
        s['fraud_level'], s['fraud_note'] = evaluate_fraud(s['policies'])
        s['claim_total'] = sum(p['claim'] for p in s['policies'])
        s['subtypes'] = [p['subtype'] or '未知险种' for p in s['policies']]
    ships.sort(key=lambda s: (RISK_ORDER[s['biz_level']], RISK_ORDER[s['fraud_level']],
                              s['names'][0]))

    wb = openpyxl.Workbook()

    # ---- Sheet1 船舶汇总 ----
    ws = wb.active
    ws.title = '船舶汇总'
    headers = ['序号', '船舶识别号', '船舶中文名称', '船舶英文名称', 'IMO号',
               '查询次数', '首次查询日期', '最近查询日期', '最近查询来源文件',
               '险种数', '险种', '近3年赔案金额合计（元）', '近3年出险原因合计数量',
               '赔付率超100%数值个数', '起保早期出险摘要',
               '业务品质风险', '业务品质评估说明', '欺诈风险', '欺诈风险评估说明']
    ws.append(headers)
    for i, s in enumerate(ships, 1):
        cause_total = sum(
            sum(cnt for _, cnt in ((p['causes'] or {}).get('items') or [])) for p in s['policies'])
        over_n = 0
        for p in s['policies']:
            for v in (p['ratio_total'] or []):
                n = ratio_num(v)
                if n is not None and n > 100:
                    over_n += 1
        ws.append([
            i, s['sid'] or '—', '、'.join(n for n in s['names'] if n) or '—',
            next((p['name_en'] for p in s['policies'] if p['name_en']), ''),
            s['imo'], s['query_count'],
            fmt_date(s['first_date']), fmt_date(s['last_date']), s['last_file'],
            len(s['policies']), '、'.join(dict.fromkeys(s['subtypes'])),
            round(s['claim_total'], 2), cause_total, over_n, early_summary(s['policies']),
            s['biz_level'], s['biz_note'], s['fraud_level'], s['fraud_note'],
        ])
        r = ws.max_row
        for col, lv in ((16, s['biz_level']), (18, s['fraud_level'])):
            c = ws.cell(row=r, column=col)
            c.fill = FILLS[lv]
            c.font = FONTS[lv]
            c.alignment = CENTER
        ws.cell(row=r, column=12).number_format = '#,##0.00'
        ws.cell(row=r, column=6).alignment = CENTER
    widths = [6, 16, 22, 18, 10, 8, 12, 12, 34, 7, 22, 18, 12, 12, 30, 12, 46, 12, 46]
    for i, w in enumerate(widths, 1):
        ws.column_dimensions[get_column_letter(i)].width = w
    ws.freeze_panes = 'A2'
    ws.auto_filter.ref = 'A1:S%d' % ws.max_row
    for row in ws.iter_rows(min_row=2):
        for c in row:
            if c.column in (17, 19):
                c.alignment = WRAP

    # ---- Sheet2 去重明细（保留最近一次查询的全部险种行） ----
    ws2 = wb.create_sheet('去重明细')
    h2 = ['船舶识别号', '船舶中文名称', '船舶英文名称', '险种小类',
          '当年及过去3年满期赔付率（已决）', '当年及过去3年满期赔付率（已决+未决）',
          '近3年出险原因及数量', '近3年赔案金额', '近3年赔案区间及案件数量',
          '近1年起保当月出险保单数量及占比', '近1年起保2个月出险保单数量及占比',
          '近1年起保3个月出险保单数量及占比', '近3年保单涉及保险公司数量',
          '最近保单涉及保险公司代码', '近3年单均保额保费', '来源文件']
    ws2.append(h2)
    for s in ships:
        for p in s['policies']:
            ws2.append([
                s['sid'] or '—', p['name_cn'], p['name_en'], p['subtype'],
                p['ratio_paid_raw'], p['ratio_total_raw'],
                (p['causes'] or {}).get('raw', '') if p['causes'] else '',
                p['claim_raw'] if p['claim_raw'] not in NULL_STR else '',
                p['range_raw'],
                (p['e1'] or {}).get('raw', ''), (p['e2'] or {}).get('raw', ''),
                (p['e3'] or {}).get('raw', ''),
                p['insurer_count'], p['insurer_code'], p['avg_ap_raw'], p['file'],
            ])
    w2 = [16, 20, 16, 10, 16, 16, 30, 14, 20, 16, 16, 16, 12, 12, 18, 34]
    for i, w in enumerate(w2, 1):
        ws2.column_dimensions[get_column_letter(i)].width = w
    ws2.freeze_panes = 'A2'
    ws2.auto_filter.ref = 'A1:P%d' % ws2.max_row

    # ---- Sheet3 判定标准说明 ----
    ws3 = wb.create_sheet('判定标准说明')
    lines = [
        ['数据来源', '中银保信查询结果/ 目录下 %d 个查询结果文件' % len(glob.glob(os.path.join(SRC_DIR, '*.xlsx')))],
        ['去重规则', '同一船舶（识别号优先；识别号缺失时按船舶中文名称，若该名称在其他查询中对应唯一识别号则归并）'
                  '多次查询只保留最近一次查询结果（按文件名日期，缺失时按文件修改时间）；'
                  '「查询次数」列为该船去重前出现的查询次数'],
        ['赔案金额', '近3年赔案金额合计 = 该船全部险种近3年赔案金额之和，null/空值视为 0'],
        [''],
        ['业务品质风险·高（红）', '满足任一：①全部险种「当年及过去3年满期赔付率（已决+未决）」中超过100%的数值≥4个；'
                           '②任一险种前两个年度（当年/过去1年）赔付率任一超过500%（存在出险转保的可能性）；'
                           '③任一险种「近3年出险原因及数量」中某原因数量超过3'],
        ['业务品质风险·低（绿）', '同时满足：①所有险种赔付率数值均低于55%；②近3年出险原因合计数量≤1；'
                           '③近3年赔案金额合计低于10万元'],
        ['业务品质风险·中（黄）', '不属于高风险和低风险的，标注为中风险'],
        ['业务品质风险·空（灰）', '无承保理赔数据（赔付率/出险原因/赔案金额均无），无法评估'],
        [''],
        ['欺诈风险·高（红）', '任一险种「近1年起保当月出险保单数量及占比」不是0,0.00%'],
        ['欺诈风险·中（黄）', '起保当月出险为0，但任一险种「近1年起保2个月/3个月出险保单数量及占比」非0'],
        ['欺诈风险·低（绿）', '所有险种「近1年起保当月/2个月/3个月出险保单数量及占比」均为0,0.00%'],
        ['欺诈风险·空（灰）', '近1年起保当月/2个月/3个月出险数据缺失，无法评估'],
        [''],
        ['口径说明', '判定口径与船舶险智盾系统（interpret.js evaluateRiskDimensions，v1.5）一致；'
                  '赔付率中 Z 表示该年度无承保记录，按无数据处理；出险原因支持「原因:数量」「原因|数量」「原因N次」三种格式'],
    ]
    for line in lines:
        ws3.append(line)
    ws3.column_dimensions['A'].width = 24
    ws3.column_dimensions['B'].width = 110
    for row in ws3.iter_rows(min_row=2):
        for c in row:
            c.alignment = WRAP

    wb.save(OUT_PATH)
    return ships


def main():
    print('读取 %s ...' % SRC_DIR)
    rows = load_all()
    print('有效险种行: %d' % len(rows))
    ships = dedup(rows)
    print('去重后船舶数: %d' % len(ships))
    ships = write_excel(ships)
    from collections import Counter
    biz = Counter(s['biz_level'] for s in ships)
    fraud = Counter(s['fraud_level'] for s in ships)
    print('业务品质风险分布:', dict(biz))
    print('欺诈风险分布:', dict(fraud))
    top = sorted(ships, key=lambda s: -s['query_count'])[:10]
    print('查询次数最多的船:')
    for s in top:
        print('  %s(%s) %d次 %s~%s' % ('、'.join(s['names']), s['sid'], s['query_count'],
                                     fmt_date(s['first_date']), fmt_date(s['last_date'])))
    print('输出: %s' % OUT_PATH)


if __name__ == '__main__':
    main()
