#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""船舶险智盾解读报告生成器。

用法：
  python build_report.py --source <数据表.xlsx> --ship 万国顺达 --out-dir <目录>
  python build_report.py --source <数据表.xlsx> --all --out-dir <目录>          # 批量
  python build_report.py --source <数据表.xlsx> --all --out-dir <目录> \
      --template <模板.docx> --watermark "分公司/账号" --current-year 2026

批量模式下每船生成一个 docx，并在 out-dir 写 _batch-summary.json 记录结果。
"""
import argparse
import json
import math
import os
import re
import shutil
import sys
import zipfile
from copy import deepcopy
from datetime import date
from pathlib import Path

from lxml import etree

try:
    from openpyxl import load_workbook
except ImportError:  # pragma: no cover
    sys.exit("缺少 openpyxl，请先安装：pip install openpyxl")

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
R = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
PKG_REL = "{http://schemas.openxmlformats.org/package/2006/relationships}"
PKG_CT = "{http://schemas.openxmlformats.org/package/2006/content-types}"
XMLSP = "{http://www.w3.org/XML/1998/namespace}space"

DEFAULT_WATERMARK = "总公司/1010000789"

# 风险等级配色。中风险用加深的琥珀黄而非纯黄：纯黄在白底与黑白打印下不可读。
# 「无数据」用中性灰：过往3年无投保记录时没有任何赔付或起保数据可供评估，
# 若标成绿色「低风险」会让核保人误判为优质标的，属于危险的空真结论。
LEVEL_COLOR = {"低风险": "00A651", "中风险": "D6A419", "高风险": "E02020",
               "无数据": "808080"}
NO_DATA = "无数据"

# 保赔险/油污险按总吨位计收保费（元/GT）；船壳险按保额计（‰）。
GT_RATE_TYPES = ("保赔险", "油污险")

RPR_ORDER = [
    "rStyle", "rFonts", "b", "bCs", "i", "iCs", "caps", "smallCaps", "strike",
    "dstrike", "outline", "shadow", "emboss", "imprint", "noProof", "snapToGrid",
    "vanish", "webHidden", "color", "spacing", "w", "kern", "position", "sz",
    "szCs", "highlight", "u", "effect", "bdr", "shd", "fitText", "vertAlign",
    "rtl", "cs", "em", "lang", "eastAsianLayout", "specVanish", "oMath",
]

# ---------------------------------------------------------------- 排版片段 --
# 取自总公司报告模板（清理 rsid/paraId 等编辑痕迹后的格式语义）
TITLE_PPR = ('<w:pPr><w:jc w:val="center"/><w:rPr>'
             '<w:rFonts w:ascii="华文中宋" w:eastAsia="华文中宋" w:hAnsi="华文中宋"/>'
             '<w:sz w:val="28"/><w:szCs w:val="32"/></w:rPr></w:pPr>')
TITLE_RPR = ('<w:rPr><w:rFonts w:ascii="华文中宋" w:eastAsia="华文中宋" '
             'w:hAnsi="华文中宋" w:hint="eastAsia"/><w:sz w:val="28"/>'
             '<w:szCs w:val="32"/></w:rPr>')
HEAD_PPR = ('<w:pPr><w:rPr><w:rFonts w:ascii="黑体" w:eastAsia="黑体" w:hAnsi="黑体"/>'
            '<w:sz w:val="24"/><w:szCs w:val="28"/></w:rPr></w:pPr>')
HEAD_RPR = ('<w:rPr><w:rFonts w:ascii="黑体" w:eastAsia="黑体" w:hAnsi="黑体" '
            'w:hint="eastAsia"/><w:sz w:val="24"/><w:szCs w:val="28"/></w:rPr>')
BODY_RPR = '<w:rPr><w:rFonts w:hint="eastAsia"/></w:rPr>'
NOTE_PPR = '<w:pPr><w:rPr><w:b/><w:bCs/></w:rPr></w:pPr>'
NOTE_RPR = '<w:rPr><w:rFonts w:hint="eastAsia"/><w:b/><w:bCs/></w:rPr>'
SECTPR = ('<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>'
          '<w:pgMar w:top="1440" w:right="1800" w:bottom="1440" w:left="1800" '
          'w:header="851" w:footer="992" w:gutter="0"/>'
          '<w:cols w:space="425"/>'
          '<w:docGrid w:type="lines" w:linePitch="312"/></w:sectPr>')

_DOC_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'


def _frag(xml):
    return etree.fromstring(f"<w:root {_DOC_NS}>{xml}</w:root>")[0]


# ------------------------------------------------------------- 数据读取 --
COLUMNS = {
    "序号": "seq", "船舶识别号": "ship_id", "IMO号": "imo",
    "船舶中文名": "name_cn", "船舶英文名": "name_en", "险种小类": "type",
    "当年及过去3年满期赔付率（已决）": "rate_settled",
    "当年及过去3年满期赔付率（已决+未决）": "rate_total",
    "近3年出险原因及数量": "cause", "近3年赔案金额": "amount",
    "近3年赔案区间及案件数量": "band",
    "近1年起保当月出险保单数量及占比": "m0",
    "近1年起保2个月出险保单数量及占比": "m2",
    "近1年起保3个月出险保单数量及占比": "m3",
    "近3年保单涉及保险公司数量": "insurers",
    "最近保单涉及保险公司代码": "insurer_code",
    "近3年单均保额": "sum_insured", "近3年单均保费": "premium",
}


def _norm_header(s):
    return re.sub(r"\s+", "", str(s)) if s is not None else ""


def load_ships(source):
    """读取案例表，返回 {船名: {字段: 值}}。船名为空的行跳过。"""
    wb = load_workbook(source, data_only=True)
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))
    header_idx, colmap = None, {}
    for i, row in enumerate(rows):
        cand = {}
        for j, cell in enumerate(row):
            key = COLUMNS.get(_norm_header(cell))
            if key:
                cand[key] = j
        if "name_cn" in cand and "type" in cand:
            header_idx, colmap = i, cand
            break
    if header_idx is None:
        raise SystemExit(f"未能在 {source} 中识别表头（需含「船舶中文名」「险种小类」列）")

    ships = {}
    for row in rows[header_idx + 1:]:
        name = row[colmap["name_cn"]] if colmap["name_cn"] < len(row) else None
        if name is None or str(name).strip() in ("", "(null)"):
            continue
        rec = ships.setdefault(str(name).strip(), {})
        for key, j in colmap.items():
            if key == "name_cn":
                continue
            val = row[j] if j < len(row) else None
            if val is not None and str(val).strip() != "":
                rec[key] = val
    wb.close()
    if not ships:
        raise SystemExit("数据表中未找到任何有效船舶记录")
    return ships


def load_insurers(source):
    """读取机构代码表 -> {代码: 机构全称}。用于把代码翻译成名称。"""
    if not source or not Path(source).exists():
        return {}
    wb = load_workbook(source, data_only=True)
    mapping = {}
    for ws in wb.worksheets:
        if "保险机构" not in ws.title:
            continue
        for row in ws.iter_rows(min_row=3, values_only=True):
            if row and row[0] and row[1]:
                mapping[str(row[0]).strip()] = str(row[1]).strip()
    wb.close()
    return mapping


# ------------------------------------------------------------- 指标推算 --
def parse_rate(raw):
    """'0,0,16,0' -> [0,0,16,0]；含 'Z' 的位置为 None（该年度无投保记录）。"""
    if raw is None or str(raw).strip() in ("", "(null)"):
        return []
    out = []
    for tok in str(raw).split(","):
        tok = tok.strip()
        if tok.upper() == "Z":
            out.append(None)
        else:
            try:
                out.append(float(tok) if "." in tok else int(tok))
            except ValueError:
                out.append(None)
    return out


def parse_count(raw):
    """'意外事故类|2,触碰|1' -> [('意外事故类',2),('触碰',1)]；(null) -> []。"""
    if raw is None or str(raw).strip() in ("", "(null)"):
        return []
    items = []
    for tok in str(raw).split(","):
        tok = tok.strip()
        if not tok or "|" not in tok:
            continue
        cause, _, num = tok.rpartition("|")
        try:
            items.append((cause.strip(), int(num)))
        except ValueError:
            items.append((cause.strip(), 0))
    return items


def num(raw):
    """安全转数值；(null)/空 -> None。"""
    if raw is None:
        return None
    s = str(raw).strip()
    if s in ("", "(null)", "None"):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def vessel_age(ship_id, current_year):
    """船龄 = 当前年份 - 识别号 CN 之后的四位建造年份。"""
    if not ship_id:
        return None
    m = re.match(r"^\s*CN\s*(\d{4})", str(ship_id), re.IGNORECASE)
    if not m:
        return None
    built = int(m.group(1))
    if built < 1900 or built > current_year:
        return None
    return current_year - built


def wan(v):
    """元 -> 万元，保留合理精度。"""
    if v is None:
        return None
    w = v / 10000.0
    return str(int(round(w))) if abs(w - round(w)) < 0.05 else f"{w:.2f}".rstrip("0").rstrip(".")


def compute(rec, current_year):
    """汇总单船所有派生指标。

    rec 结构：标量字段（ship_id/insurers/insurer_code/gt/ship_type/_name/_insurer_name）
    + 每险种一个 "t:<险种>" 子字典。
    """
    per_type = {k[2:]: v for k, v in rec.items()
                if k.startswith("t:") and isinstance(v, dict)}
    # 整行为 (null) 的船舶（无投保记录）不设回退行，rows 保持为空，
    # 否则会凭 rec 自身字段造出一个不存在的「未分类」险种。

    gt = num(_first(rec, "gt"))
    rows = []
    for tname, r in per_type.items():
        si, prem = num(r.get("sum_insured")), num(r.get("premium"))
        if tname in GT_RATE_TYPES:
            rate = f"{prem / gt:.2f}元/GT" if (si is not None and prem and gt) else None
        else:
            rate = f"{prem / si * 1000:.2f}‰" if (si and prem) else None
        rows.append({
            "type": tname,
            "rate_settled": parse_rate(r.get("rate_settled")),
            "rate_total": parse_rate(r.get("rate_total")),
            "raw_settled": r.get("rate_settled"),
            "raw_total": r.get("rate_total"),
            "causes": parse_count(r.get("cause")),
            "amount": num(r.get("amount")),
            "band": parse_count(r.get("band")),
            "m0": str(r.get("m0") or "").strip(),
            "m2": str(r.get("m2") or "").strip(),
            "m3": str(r.get("m3") or "").strip(),
            "sum_insured": si, "premium": prem, "rate": rate,
        })

    ship_id = str(rec.get("ship_id") or "").strip()
    return {
        "name": rec.get("_name"),
        "ship_id": ship_id if ship_id and ship_id != "(null)" else None,
        "age": vessel_age(ship_id, current_year),
        "ship_type": rec.get("ship_type"),
        "gt": gt,
        "insurers": rec.get("insurers"),
        "insurer_name": rec.get("_insurer_name"),
        "rows": rows,
        "years": [current_year - i for i in range(4)],
    }


def _first(rec, key):
    v = rec.get(key)
    if v not in (None, ""):
        return v
    for tname, r in rec.items():
        if tname.startswith("t:") and isinstance(r, dict) and r.get(key) not in (None, ""):
            return r[key]
    return None


# ------------------------------------------------------------- 风险评级 --
def grade_business(info):
    """业务品质评级。返回 (等级, 依据文本)；依据仅用于对话解释，不写入报告正文。"""
    rows = info["rows"]
    if not rows:
        return NO_DATA, "过往3年无投保记录，无赔付数据可供业务品质评估"
    all_totals = [v for r in rows for v in r["rate_total"] if v is not None]
    over100 = sum(1 for v in all_totals if v > 100)
    recent = [r["rate_total"][i] for r in rows for i in (0, 1)
              if i < len(r["rate_total"]) and r["rate_total"][i] is not None]
    cause_total = sum(n for r in rows for _, n in r["causes"])
    amount_total = sum(r["amount"] for r in rows if r["amount"])

    reasons = []
    if len(rows) >= 3 and over100 >= 4:
        reasons.append(f"涉及{len(rows)}个险种且已决+未决赔付率超过100%的数值达{over100}个（≥4）")
    if any(v > 500 for v in recent):
        reasons.append(f"当年或去年赔付率超过500%（存在出险转保可能）：{max(recent)}%")
    if cause_total > 3:
        reasons.append(f"近3年出险合计{cause_total}次，超过3次")
    if reasons:
        return "高风险", "；".join(reasons)

    low_ok = [
        all(v < 55 for v in all_totals),
        cause_total <= 1,
        amount_total < 100000,
    ]
    if all(low_ok):
        return "低风险", ("所有险种已决+未决赔付率均低于55%，近3年出险合计"
                          f"{cause_total}次（≤1），赔案金额合计{amount_total/10000:.1f}万（<10万）")

    blockers = []
    if not low_ok[0]:
        mx = max(all_totals) if all_totals else 0
        blockers.append(f"存在超过55%的赔付率（最高{mx:.0f}%）")
    if not low_ok[1]:
        blockers.append(f"近3年出险合计{cause_total}次（>1）")
    if not low_ok[2]:
        blockers.append(f"赔案金额合计{amount_total/10000:.1f}万（≥10万）")
    return "中风险", "未触发高风险条件，但不满足低风险条件：" + "；".join(blockers)


def grade_fraud(info):
    """欺诈风险评级。三个起保期出险字段全为 0,0.00% -> 低风险。"""
    rows = info["rows"]
    if not rows:
        return NO_DATA, "过往3年无投保记录，无起保出险数据可供欺诈风险评估"
    zero = "0,0.00%"
    if all(r["m0"] == zero and r["m2"] == zero and r["m3"] == zero for r in rows):
        return "低风险", ("所有险种的近1年起保当月/2个月/3个月出险保单数量及占比"
                          "均为「0,0.00%」，未在起保3个月内出险")
    if any(r["m0"] not in ("", zero) for r in rows):
        return "高风险", "存在起保当月即出险的保单，欺诈风险显著"
    return "中风险", "存在起保2-3个月内出险的保单"


# ------------------------------------------------------------- 正文生成 --
def _est_unpaid(row):
    """按单均保费估算未决赔案金额（估算值，非事实数据）。"""
    if not row["premium"]:
        return None
    worst = max((v for v in row["rate_total"] if v is not None), default=None)
    if worst is None or worst <= 0:
        return None
    settled = [row["rate_settled"][i] if i < len(row["rate_settled"]) else None
               for i in range(len(row["rate_total"]))]
    pairs = [(t, s) for t, s in zip(row["rate_total"], settled)]
    gap = max((t - (s or 0)) for t, s in pairs if t is not None)
    if gap <= 0:
        return None
    return round(gap / 100.0 * row["premium"] / 10000.0) * 10000  # 估损取整到万元


def _active_years(row, years):
    """返回有赔付（已决或未决非0）的保单年度列表。"""
    out = []
    for i, y in enumerate(years):
        t = row["rate_total"][i] if i < len(row["rate_total"]) else None
        s = row["rate_settled"][i] if i < len(row["rate_settled"]) else None
        if (t or 0) > 0 or (s or 0) > 0:
            out.append((y, s, t))
    return out


def _band_text(band):
    """把赔案区间 [(区间, 件数)] 转成自然语言。"""
    if not band:
        return ""
    total = sum(n for _, n in band)
    if len(band) == 1:
        rng, n = band[0]
        return f"{n}件赔案金额均在{rng}" if n == total else f"{n}件赔案金额在{rng}"
    segs = "、".join(f"{n}件在{rng}" for rng, n in band)
    return f"赔案金额分布为{segs}"


def _scheme_stability(info):
    """按单均保额/保费的取整程度推断承保方案是否调整（定性判断）。

    规则源自指标解读表：保额为完整整数（如 4250 万）说明方案未变；
    出现零头（如 5566667 元）说明保额涉及调整。保费同理。
    """
    rows = [r for r in info["rows"] if r["sum_insured"] and r["premium"]]
    if not rows:
        return "结合单均保额保费数值判断承保方案稳定性。"

    # 保额为整数万 -> 保额未调整；保费为整数千 -> 保费未调整（出现零头说明方案有变动）
    whole_si = [r for r in rows if r["sum_insured"] % 10000 == 0]
    whole_prem = [r for r in rows if r["premium"] % 1000 == 0]
    odd_prem = [r for r in rows if r["premium"] % 1000 != 0]

    head = "结合单均保额保费数值，"
    segs, tails = [], []
    if whole_si:
        vals = "、".join(f"{wan(r['sum_insured'])}万" for r in whole_si)
        prefix = ("两个险种的" if len(whole_si) == 2 == len(rows)
                  else "、".join(r["type"] for r in whole_si) + "的")
        segs.append(f"{prefix}单均保额均为完整整数（{vals}）")
    if whole_prem:
        vals = "、".join(f"{wan(r['premium'])}万" for r in whole_prem)
        names = "、".join(r["type"] for r in whole_prem)
        segs.append(f"{names}单均保费亦为完整数值（{vals}），预计近3年承保方案基本保持稳定")
    for r in odd_prem:
        tails.append(f"{r['type']}单均保费存在零头（{int(r['premium'])}元），"
                     "可能受保单数量或承保方案微调影响")
    body = "，".join(segs)
    if tails:
        body += ("；" if body else "") + "；".join(tails)
    return head + body + "。（本段为定性判断，非事实陈述）"


def build_sections(info):
    """生成六节正文段落。每段为 [(文本, 加粗, 色值|None), ...]。"""
    name = info["name"]
    P = []

    def head(t): P.append(("h", [(t, False, None)]))
    def plain(t): P.append(("p", [(t, False, None)]))
    def bold(t): P.append(("p", [(t, True, None)]))
    def lead(label, rest): P.append(("p", [(label, True, None), (rest, False, None)]))

    # 一、船舶档案
    head("一、船舶档案")
    id_txt = info["ship_id"] or "待补充"
    plain(f"船舶名称：{name}（船舶识别号：{id_txt}）")
    plain(f"船龄：{str(info['age']) + '年' if info['age'] is not None else '待补充'}")
    plain(f"船舶类型：{info['ship_type'] or '待补充'}")
    plain(f"总吨位（GT）：{str(int(info['gt'])) if info['gt'] else '待补充'}")

    # 二、业务品质分析
    head("二、业务品质分析")
    types = [r["type"] for r in info["rows"] if r["type"]]
    bold(f"过往3年投保的险种分别为{'、'.join(types)}。" if types else "过往3年无投保记录。")
    for r in info["rows"]:
        label = f"{r['type']}："
        acts = _active_years(r, info["years"])
        cause_n = sum(n for _, n in r["causes"])
        parts = []
        if not acts and not r["causes"] and not r["amount"]:
            parts.append("过往3年无赔付。")
            lead(label, "".join(parts))
            continue
        if cause_n:
            causes = "、".join(c for c, _ in r["causes"])
            yrs = sorted({y for y, _, _ in acts})
            parts.append(f"2023年至今共出险{cause_n}次，出险原因均为{causes}"
                         if len(set(c for c, _ in r["causes"])) == 1
                         else f"2023年至今共出险{cause_n}次，出险原因分别为{causes}")
            if yrs:
                parts.append("，出险的保单年度为"
                             + "和".join(f"{y}年" for y in yrs))
            if r["amount"]:
                parts.append(f"，累计赔案金额为{wan(r['amount'])}万")
            if r["band"]:
                parts.append("，" + _band_text(r["band"]))
            parts.append("。")
        else:
            nulls = [n for n, v in (("近3年出险原因及数量", r["causes"]),
                                    ("近3年赔案金额", r["amount"]),
                                    ("近3年赔案区间", r["band"])) if not v]
            if nulls:
                parts.append("、".join(nulls) + "均显示为(null)，即近3年统计窗口内无出险记录。")
            else:
                parts.append("近3年统计窗口内无出险记录。")
        # 逐年赔付率
        first = True
        for y, s, t in acts:
            lead_in = "但" if (first and not cause_n and not r["amount"]) else ""
            first = False
            if s == 0 and t and t > 0:
                parts.append(f"{lead_in}{y}年保单年度“当年及过去3年满期赔付率（已决+未决）”"
                             f"为{t:.0f}%，而同年度已决赔付率为0，"
                             "表明该保单年度存在一起尚未结案的未决赔案")
                est = _est_unpaid(r)
                if est:
                    parts.append(f"，按单均保费{wan(r['premium'])}万元估算，估损金额约{wan(est)}万元"
                                 "（估算值，仅供参考，实际以理赔系统立案估损为准）")
                parts.append("。")
            else:
                clauses = []
                if s:
                    clauses.append(f"已决满期赔付率为{s:.0f}%")
                if t and t != s:
                    clauses.append(f"已决+未决满期赔付率为{t:.0f}%")
                    if s and t > s:
                        clauses.append(f"即该保单年度仍有约{t - s:.0f}个百分点"
                                       "来自立案未决的估损，赔案尚未全部结案")
                if clauses:
                    parts.append(f"{y}年" + "，".join(clauses) + "。")
        lead(label, "".join(parts))

    # 三、欺诈风险识别
    head("三、欺诈风险识别")
    lvl, _ = grade_fraud(info)
    if lvl == NO_DATA:
        plain(f"{name}过往3年无投保记录，无起保出险数据可供欺诈风险识别。")
    elif lvl == "低风险":
        plain(f"{name}近1年起保当月、起保2个月、起保3个月内出险保单数量及占比均显示为"
              "“0,0.00%”，即近1年起保的保单未在起保3个月内出险，欺诈风险较低。")
    else:
        plain(f"{name}近1年存在起保短期内出险的保单，需重点核查出险时点与起保时点的关系。")
    ins = num(info["insurers"])
    if ins is not None:
        freq = {1: "较高", 2: "中等", 3: "较高"}.get(int(ins), "需关注")
        tail = f"，最近一张保单承保公司为{info['insurer_name']}" if info["insurer_name"] else ""
        plain(f"近3年保单涉及保险公司数量为{int(ins)}家，更换保险公司频率{freq}{tail}。")

    # 四、近3年单均保额保费
    head("四、近3年单均保额保费")
    rated = False
    for r in info["rows"]:
        si, prem = r["sum_insured"], r["premium"]
        if not si or not prem:
            continue
        rated = True
        seg = f"单均保额为{wan(si)}万，单均保费为{wan(prem)}万"
        if r["rate"]:
            if r["type"] in GT_RATE_TYPES:
                seg += (f"，按总吨位{int(info['gt'])}GT计算，单均费率约为{r['rate']}"
                        if info["gt"] else
                        "。因查询结果未返回总吨位（GT），暂无法计算“元/GT”口径费率，"
                        "而该险种通常按总吨位计收保费，建议补充后再行评估")
            else:
                seg += f"，单均费率约为{r['rate']}"
        lead(f"{r['type']}：", seg + "。")
    if rated:
        plain(_scheme_stability(info))
    else:
        plain("该船过往3年无投保记录，无单均保额保费数据。")

    # 五、风险提示：只给评级结果，不写评级依据
    head("五、风险提示")
    bl, _ = grade_business(info)
    fl, _ = grade_fraud(info)
    P.append(("p", [("业务品质评估：", False, None), (bl, True, LEVEL_COLOR[bl])]))
    P.append(("p", [("欺诈风险评估：", False, None), (fl, True, LEVEL_COLOR[fl])]))

    # 六、核保建议
    head("六、核保建议")
    tips, i = [], 0
    for r in info["rows"]:
        acts = _active_years(r, info["years"])
        for y, s, t in acts:
            if (s or 0) == 0 and t and t >= 100:
                i += 1
                tips.append(f"{i}、{r['type']}{y}年保单年度存在{t:.0f}%的未决赔付率且已决为0，"
                            "建议重点核实该未决赔案的案情、立案时间、估损依据及当前处理进展；")
    if ins is not None and int(ins) >= 2:
        i += 1
        who = f"由{info['insurer_name']}承保" if info["insurer_name"] else "承保"
        tips.append(f"{i}、该船近3年在{int(ins)}家保险公司投保，最近一张保单{who}，"
                    "建议核实转保原因，关注是否存在出险后转保的情形；")
    for r in info["rows"]:
        cause_n = sum(n for _, n in r["causes"])
        if cause_n and r["amount"]:
            i += 1
            extra = ("，但该保单年度仍有未决估损，建议跟踪结案进度"
                     if any((s or 0) < (t or 0) for _, s, t in _active_years(r, info["years"])) else "")
            yrs = sorted({y for y, _, _ in _active_years(r, info["years"])})
            yr_txt = (f"{yrs[0]}年" if len(yrs) == 1
                      else "、".join(str(y) for y in yrs) + "年") if yrs else "近3年"
            causes = "（" + "、".join(c for c, _ in r["causes"]) + "）" if r["causes"] else ""
            band_txt = ("、单案均在" + r["band"][0][0] if len(r["band"]) == 1 else "")
            tips.append(f"{i}、{r['type']}{yr_txt}出险{cause_n}次{causes}，"
                        f"累计赔案金额{wan(r['amount'])}万{band_txt}，"
                        f"赔付规模可控{extra}。")
    missing = [n for n, v in [("船龄", info["age"]), ("船舶类型", info["ship_type"]),
                              ("总吨位（GT）", info["gt"])] if not v]
    if not info["rows"]:
        i += 1
        tips.append(f"{i}、该船过往3年无投保记录，缺乏历史赔付与承保数据，"
                    "不能据此认定为优质标的，建议通过船舶登记信息、船级社记录及客户访谈"
                    "补充尽调后再作承保判断。")
    if missing:
        i += 1
        tips.append(f"{i}、本次查询结果未返回{'、'.join(missing)}，"
                    "建议补充核实船舶基础档案后再作最终承保判断。")
    if not tips:
        tips.append("1、该船历史赔付表现良好，未见明显异常，建议按常规流程核保。")
    for t in tips:
        plain(t)
    return P


# ------------------------------------------------------------- DOCX 渲染 --
def _insert_el(rPr, tag):
    """按 OOXML rPr 子元素顺序插入，返回新元素。"""
    el = etree.Element(W + tag)
    idx = RPR_ORDER.index(tag)
    pos = len(rPr)
    for i, c in enumerate(rPr):
        ln = etree.QName(c).localname
        if ln in RPR_ORDER and RPR_ORDER.index(ln) > idx:
            pos = i
            break
    rPr.insert(pos, el)
    return el


def render_docx(info, sections, template, out_path, watermark, report_date):
    z = zipfile.ZipFile(template)
    doc = etree.fromstring(z.read("word/document.xml"))
    body = doc.find(W + "body")
    old_sect = body.find(W + "sectPr")
    for c in list(body):
        body.remove(c)

    def para(ppr_xml, rpr_xml, segs):
        p = etree.SubElement(body, W + "p")
        if ppr_xml:
            p.append(_frag(ppr_xml))
        # 空段不写 run，保持与模板一致的 <w:p/> 结构
        segs = [s for s in segs if s[0]]
        if not segs:
            return p
        for text, bold, color in segs:
            r = etree.SubElement(p, W + "r")
            rPr = deepcopy(_frag(rpr_xml))
            if bold and rPr.find(W + "b") is None:
                _insert_el(rPr, "b")
                _insert_el(rPr, "bCs")
            if color:
                _insert_el(rPr, "color").set(W + "val", color)
            r.append(rPr)
            t = etree.SubElement(r, W + "t")
            t.text = text
            t.set(XMLSP, "preserve")
        return p

    para(None, BODY_RPR, [("", False, None)])
    para(TITLE_PPR, TITLE_RPR, [(f"“{info['name']}”智盾解读", False, None)])
    para(None, BODY_RPR, [("", False, None)])
    for kind, segs in sections:
        if kind == "h":
            para(HEAD_PPR, HEAD_RPR, segs)
        else:
            para(None, BODY_RPR, segs)
    para(None, BODY_RPR, [("", False, None)])
    para(None, BODY_RPR, [("", False, None)])
    para(None, BODY_RPR, [(f"报告生成日期：{report_date}", False, None)])
    para(NOTE_PPR, NOTE_RPR,
         [("注：本报告由AI生成，仅供内部参考，不作为最终核保依据。", True, None)])

    # 关系与 Content Types：先解析关系表，才能为水印页眉分配未占用的 rId
    rels_root = etree.fromstring(z.read("word/_rels/document.xml.rels"))
    for e in list(rels_root):
        tgt = e.get("Target") or ""
        if "comments" in tgt or tgt == "people.xml":
            rels_root.remove(e)
    used_ids = {e.get("Id") for e in rels_root}

    def free_rid(prefix):
        n = 1
        while f"{prefix}{n}" in used_ids:
            n += 1
        rid = f"{prefix}{n}"
        used_ids.add(rid)
        return rid

    # sectPr（含水印页眉引用）：直接深拷贝节点，不做序列化往返，
    # 否则会丢失 w: 命名空间声明，导致 w:rsidR 等属性解析失败。
    if old_sect is not None:
        new_sect = deepcopy(old_sect)
    else:
        new_sect = _frag(SECTPR)
    rid = None
    if watermark:
        # 自定义模板可能自带页眉引用，先移除，否则会出现两个 headerReference
        for old_ref in new_sect.findall(W + "headerReference"):
            new_sect.remove(old_ref)
        rid = free_rid("rId")
        href = etree.Element(W + "headerReference")
        href.set(W + "type", "default")
        href.set(R + "id", rid)
        new_sect.insert(0, href)  # OOXML 要求 headerReference 为 sectPr 首个子元素
    body.append(new_sect)

    new_doc = etree.tostring(doc, xml_declaration=True, encoding="UTF-8", standalone=True)

    if rid:
        rel = etree.SubElement(rels_root, PKG_REL + "Relationship")
        rel.set("Id", rid)
        rel.set("Type", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/header")
        rel.set("Target", "header1.xml")
    new_rels = etree.tostring(rels_root, xml_declaration=True, encoding="UTF-8", standalone=True)

    ct_root = etree.fromstring(z.read("[Content_Types].xml"))
    for ov in list(ct_root):
        pn = ov.get("PartName") or ""
        if re.search(r"/word/(comments|commentsExtended|commentsIds|commentsExtensible|people)\.xml$", pn):
            ct_root.remove(ov)
    if rid and not any((o.get("PartName") == "/word/header1.xml") for o in ct_root):
        ov = etree.SubElement(ct_root, PKG_CT + "Override")
        ov.set("PartName", "/word/header1.xml")
        ov.set("ContentType",
               "application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml")
    new_ct = etree.tostring(ct_root, xml_declaration=True, encoding="UTF-8", standalone=True)

    DROP = {"word/comments.xml", "word/commentsExtended.xml", "word/commentsIds.xml",
            "word/commentsExtensible.xml", "word/people.xml"}
    if rid:
        # 水印页眉会写入 header1.xml；模板若自带同名部件须丢弃，否则 zip 出现重复条目
        DROP.add("word/header1.xml")
    os.makedirs(os.path.dirname(os.path.abspath(out_path)) or ".", exist_ok=True)
    tmp = str(out_path) + ".tmp"
    written = set()
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zo:
        for item in z.infolist():
            if item.filename in DROP or item.filename in written:
                continue
            data = z.read(item.filename)
            if item.filename == "word/document.xml":
                data = new_doc
            elif item.filename == "word/_rels/document.xml.rels":
                data = new_rels
            elif item.filename == "[Content_Types].xml":
                data = new_ct
            zo.writestr(item, data)
            written.add(item.filename)
        if rid:
            zo.writestr("word/header1.xml", build_watermark_header(watermark).encode("utf-8"))
            written.add("word/header1.xml")
    z.close()
    shutil.move(tmp, out_path)
    return out_path


def build_watermark_header(text, page_width_pt=595.3):
    """斜式艺术字水印页眉。rotation:315 = 左下→右上斜式，页面居中，衬于文字下方。

    page_width_pt 默认取 A4 宽度（模板 sectPr 为 11906 twips = 595.3pt）。
    """
    text = text.replace("&", "&amp;").replace("<", "&lt;").replace('"', "&quot;")
    # 按字形比例设定宽高，避免文字被拉伸变形：
    # 汉字 1em、ASCII 数字约 0.5em -> 总宽 ≈ (汉字数 + 0.5×数字数) em
    han = len(re.findall(r"[\u4e00-\u9fff]", text))
    other = len(text) - han
    em = han + 0.5 * other
    height = 56.0
    width = max(round(height * em, 1), 120.0)
    # 旋转 45° 后的外接框必须落在页面内；超限时等比缩小（缩字号，不拉伸变形）
    # 预留 1% 边距并向下取整：round() 可能向上进位，导致临界情况下超出页面被裁切
    diag = math.sin(math.radians(45))
    bbox = (width + height) * diag
    limit = page_width_pt * 0.99
    if bbox > limit:
        scale = limit / bbox
        width = math.floor(width * scale * 10) / 10.0
        height = math.floor(height * scale * 10) / 10.0
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        '<w:hdr xmlns:o="urn:schemas-microsoft-com:office:office" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
        'xmlns:v="urn:schemas-microsoft-com:vml" '
        'xmlns:w10="urn:schemas-microsoft-com:office:word" '
        'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        '<w:p><w:pPr><w:rPr><w:rFonts w:hint="eastAsia"/><w:noProof/></w:rPr></w:pPr>'
        '<w:r><w:rPr><w:rFonts w:hint="eastAsia"/><w:noProof/></w:rPr><w:pict>'
        '<v:shapetype id="_x0000_t136" coordsize="21600,21600" o:spt="136" adj="10800" '
        'path="m@7,l@8,m@5,21600l@6,21600e"><v:formulas>'
        '<v:f eqn="sum #0 0 10800"/><v:f eqn="prod #0 2 1"/><v:f eqn="sum 21600 0 @1"/>'
        '<v:f eqn="sum 0 0 @2"/><v:f eqn="sum 21600 0 @3"/><v:f eqn="if @0 @3 0"/>'
        '<v:f eqn="if @0 21600 @1"/><v:f eqn="if @0 0 @2"/><v:f eqn="if @0 @4 @1"/>'
        '<v:f eqn="mid @5 @6"/><v:f eqn="mid @8 @5"/><v:f eqn="mid @7 @8"/>'
        '<v:f eqn="mid @6 @7"/><v:f eqn="sum @6 0 @5"/></v:formulas>'
        '<v:path o:extrusionok="f" gradientshapeok="t" o:connecttype="custom" '
        'o:connectlocs="@9,0;@10,10800;@11,21600;@12,10800" o:connectangles="270,180,90,0" '
        'textpathok="t"/><v:textpath on="t" fitshape="t"/>'
        '<v:handles><v:h position="#0,bottomRight" xrange="6629,14971"/></v:handles>'
        '<o:lock v:ext="edit" text="t" shapetype="t"/></v:shapetype>'
        '<v:shape id="PowerPlusWaterMarkObject" o:spid="_x0000_s2049" type="#_x0000_t136" '
        f'style="position:absolute;margin-left:0;margin-top:0;width:{width}pt;height:{height}pt;'
        'rotation:315;z-index:-251654144;mso-position-horizontal:center;'
        'mso-position-horizontal-relative:margin;mso-position-vertical:center;'
        'mso-position-vertical-relative:margin" o:allowincell="f" '
        'fillcolor="#c0c0c0" stroked="f"><v:fill opacity=".5"/>'
        f'<v:textpath style="font-family:&quot;宋体&quot;;font-size:1pt" string="{text}"/>'
        '<w10:wrap anchorx="margin" anchory="margin"/></v:shape></w:pict></w:r></w:p></w:hdr>'
    )


# ----------------------------------------------------------------- CLI --
def regroup_by_ship(source):
    """把「一船一险种一行」的表重组为 {船名: {标量字段 + t:险种:{险种字段}}}。"""
    wb = load_workbook(source, data_only=True)
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))
    hdr, colmap = None, {}
    for i, row in enumerate(rows):
        cand = {v: j for j, c in enumerate(row) if (v := COLUMNS.get(_norm_header(c)))}
        if "name_cn" in cand and "type" in cand:
            hdr, colmap = i, cand
            break
    if hdr is None:
        raise SystemExit(f"未能识别表头：{source}")
    ships = {}
    for row in rows[hdr + 1:]:
        get = lambda k: row[colmap[k]] if k in colmap and colmap[k] < len(row) else None
        name = get("name_cn")
        if not name or str(name).strip() in ("", "(null)"):
            continue
        name = str(name).strip()
        tname = str(get("type") or "").strip()
        rec = ships.setdefault(name, {"_name": name})
        for key in ("ship_id", "imo", "name_en", "insurers", "insurer_code"):
            v = get(key)
            if v not in (None, "") and rec.get(key) in (None, ""):
                rec[key] = v
        if tname and tname != "(null)":
            rec.setdefault("_types", [])
            if tname not in rec["_types"]:
                rec["_types"].append(tname)
            per = {}
            for key in ("rate_settled", "rate_total", "cause", "amount", "band",
                        "m0", "m2", "m3", "sum_insured", "premium"):
                v = get(key)
                if v is not None:
                    per[key] = v
            rec["t:" + tname] = per
    wb.close()
    return ships


def process_ship(name, rec, insurers, current_year, extras=None):
    rec = dict(rec)
    rec["_name"] = name
    if extras:
        for k, v in extras.items():
            if v not in (None, ""):
                rec[k] = v
    code = str(rec.get("insurer_code") or "").strip()
    rec["_insurer_name"] = insurers.get(code) if code else None
    info = compute(rec, current_year)
    info["name"] = name
    sections = build_sections(info)
    bl, bd = grade_business(info)
    fl, fd = grade_fraud(info)
    return info, sections, {"business": bl, "business_reason": bd,
                            "fraud": fl, "fraud_reason": fd}


def verify(path, expect_watermark=True, ship_name=None):
    """交付前校验：XML 合法性、水印链、评级着色、无示例残留。

    ship_name 用于区分「示例船名残留」与「该船本就是报告对象」——
    鸿航169 既是模板示例船，也可能是数据表里的真实标的。
    """
    issues = []
    try:
        z = zipfile.ZipFile(path)
        if z.testzip() is not None:
            issues.append("zip 结构损坏")
        doc_raw = z.read("word/document.xml").decode("utf-8")
        etree.fromstring(z.read("word/document.xml"))
        if "鸿航169" in doc_raw and ship_name != "鸿航169":
            issues.append("残留示例船名「鸿航169」")
        for k in ("commentRangeStart", "commentReference"):
            if k in doc_raw:
                issues.append(f"残留批注标记 {k}")
        if "3.88倍" in doc_raw or "满期保费的" in doc_raw and "倍" in doc_raw:
            issues.append("含被禁用的倍数换算表述")
        if re.search(r"评级依据", doc_raw):
            issues.append("正文含「评级依据」段落")
        if expect_watermark:
            if "word/header1.xml" not in z.namelist():
                issues.append("缺少水印页眉部件")
            else:
                hdr = z.read("word/header1.xml").decode("utf-8")
                etree.fromstring(hdr.encode("utf-8"))
                if "rotation:315" not in hdr:
                    issues.append("水印非斜式（rotation 应为 315）")
                # 旋转 45° 后的外接框须落在页面内，否则水印会被裁切
                mw = re.search(r'width:([\d.]+)pt', hdr)
                mh = re.search(r'height:([\d.]+)pt', hdr)
                if mw and mh:
                    bbox = (float(mw.group(1)) + float(mh.group(1))) * math.sin(math.radians(45))
                    pgm = re.search(r'<w:pgSz w:w="(\d+)"', doc_raw)
                    page_pt = int(pgm.group(1)) / 20.0 if pgm else 595.3
                    if bbox > page_pt:
                        issues.append(f"水印旋转后外接框 {bbox:.0f}pt 超出页宽 {page_pt:.0f}pt")
                rels = z.read("word/_rels/document.xml.rels").decode("utf-8")
                m = re.search(r'Id="(rId[^"]+)"[^>]*Target="header1\.xml"', rels)
                if not m:
                    issues.append("水印页眉缺少关系登记")
                elif f'r:id="{m.group(1)}"' not in doc_raw:
                    issues.append("sectPr 未引用水印页眉")
                ct = z.read("[Content_Types].xml").decode("utf-8")
                if "/word/header1.xml" not in ct:
                    issues.append("Content Types 未注册水印页眉")
        colors = set(re.findall(r'<w:color w:val="([0-9A-Fa-f]{6})"/>', doc_raw))
        z.close()
        return issues, colors
    except Exception as e:  # pragma: no cover
        return [f"校验异常：{type(e).__name__}: {e}"], set()


def main(argv=None):
    ap = argparse.ArgumentParser(description="船舶险智盾解读报告生成器")
    ap.add_argument("--source", required=True, help="船舶数据表 xlsx 路径")
    ap.add_argument("--ship", action="append", default=[], help="船名，可重复；与 --all 二选一")
    ap.add_argument("--all", action="store_true", help="批量生成数据表中全部船舶")
    ap.add_argument("--out-dir", required=True, help="输出目录")
    ap.add_argument("--template", default=None,
                    help="自定义排版模板 docx（默认用技能内置 base-template.docx）")
    ap.add_argument("--insurers", default=None, help="机构代码表 xlsx，用于翻译承保公司名称")
    ap.add_argument("--extras", default=None,
                    help='可选 JSON 文件，为各船补充表中没有的字段（总吨位、船舶类型等）。'
                         '格式：{"船名": {"gt": 17167, "ship_type": "散货船"}}')
    ap.add_argument("--watermark", default=DEFAULT_WATERMARK,
                    help=f"水印文字，默认 {DEFAULT_WATERMARK}")
    ap.add_argument("--no-watermark", action="store_true",
                    help="不添加水印（比传空串更可靠：PowerShell 会丢弃空字符串参数）")
    ap.add_argument("--current-year", type=int, default=date.today().year,
                    help="船龄计算基准年，默认取当前年份")
    ap.add_argument("--date", default=None, help="报告日期，默认今天")
    ap.add_argument("--no-verify", action="store_true", help="跳过交付前校验")
    a = ap.parse_args(argv)

    tpl = Path(a.template) if a.template else Path(__file__).resolve().parent.parent / "assets" / "base-template.docx"
    if not tpl.exists():
        raise SystemExit(f"排版模板不存在：{tpl}")
    if not Path(a.source).exists():
        raise SystemExit(f"数据表不存在：{a.source}")

    insurers = load_insurers(a.insurers) if a.insurers else {}
    extras_map = {}
    if a.extras:
        p = Path(a.extras)
        if not p.exists():
            raise SystemExit(f"补充档案文件不存在：{p}")
        with open(p, encoding="utf-8") as f:
            extras_map = json.load(f)
        if not isinstance(extras_map, dict):
            raise SystemExit("补充档案 JSON 顶层必须是对象：{\"船名\": {字段: 值}}")
    all_ships = regroup_by_ship(a.source)
    targets = list(all_ships.keys()) if a.all else a.ship
    if not targets:
        raise SystemExit("请用 --ship 指定船名，或用 --all 批量生成")
    unknown = [t for t in targets if t not in all_ships]
    if unknown:
        raise SystemExit(f"数据表中未找到：{'、'.join(unknown)}（可选：{'、'.join(all_ships)}）")

    out_dir = Path(a.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    report_date = a.date or date.today().strftime("%Y年%m月%d日")
    wm = "" if a.no_watermark else (a.watermark or "").strip()
    results = []
    for name in targets:
        info, sections, grades = process_ship(
            name, all_ships[name], insurers, a.current_year, extras_map.get(name))
        out = out_dir / f"{name}智盾解读报告.docx"
        render_docx(info, sections, tpl, out, wm, report_date)
        entry = {"ship": name, "path": str(out),
                 "business_level": grades["business"], "business_reason": grades["business_reason"],
                 "fraud_level": grades["fraud"], "fraud_reason": grades["fraud_reason"],
                 "age": info["age"], "gt": info["gt"], "types": [r["type"] for r in info["rows"]]}
        if not a.no_verify:
            issues, colors = verify(out, expect_watermark=bool(wm), ship_name=name)
            entry["verify_issues"] = issues
            entry["colors_used"] = sorted(colors)
        results.append(entry)

    summary = out_dir / "_batch-summary.json"
    with open(summary, "w", encoding="utf-8") as f:
        json.dump({"generated_at": date.today().isoformat(),
                   "current_year": a.current_year, "watermark": wm,
                   "count": len(results), "reports": results}, f, ensure_ascii=False, indent=2)

    print(json.dumps({"count": len(results), "summary": str(summary),
                      "reports": results}, ensure_ascii=False, indent=2))
    bad = [r["ship"] for r in results if r.get("verify_issues")]
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
