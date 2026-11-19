#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""为《作品介绍-船舶险反欺诈查询智能体.pptx》新增一页端到端流程闭环图。

设计语言完全复用 slide6（四、业务逻辑（2）Agent 每日调度闭环）：
- 深蓝 1F3864 头部横幅 + 4FC3F7 竖条 + 白色标题(2400) + 右上角页码徽章
- 左侧深蓝阶段芯片(1400 白字) + 4 张 EDF2FA 圆角卡片(1300 标题/1050 灰字)
- 蓝色 ▶ / 琥珀 D6A419 ▼ 连接符
- 底部闭环回流条(2E75B6) + 白色圆角说明框 + 页脚
"""
import re

WORK = '/tmp/pptx_work'
SLIDE = f'{WORK}/ppt/slides/slide13.xml'

FONT = ('<a:latin typeface="微软雅黑" pitchFamily="34" charset="0"/>'
        '<a:ea typeface="微软雅黑" pitchFamily="34" charset="-122"/>'
        '<a:cs typeface="微软雅黑" pitchFamily="34" charset="-120"/>')

def esc(t):
    return t.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')

_ids = iter(range(2, 200))
def nid():
    return next(_ids)

def plain_shape(x, y, cx, cy, fill, geom='rect', adj=None, ln=None):
    i = nid()
    av = f'<a:avLst><a:gd name="adj" fmla="val {adj}"/></a:avLst>' if adj is not None else '<a:avLst/>'
    lnxml = ln if ln else '<a:ln/>'
    return (f'<p:sp><p:nvSpPr><p:cNvPr id="{i}" name="Shape {i}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>'
            f'<p:spPr><a:xfrm><a:off x="{x}" y="{y}"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm>'
            f'<a:prstGeom prst="{geom}">{av}</a:prstGeom>'
            f'<a:solidFill><a:srgbClr val="{fill}"/></a:solidFill>{lnxml}</p:spPr></p:sp>')

def run(t, sz, color, b=False):
    bold = ' b="1"' if b else ''
    return (f'<a:r><a:rPr lang="en-US" sz="{sz}"{bold} dirty="0">'
            f'<a:solidFill><a:srgbClr val="{color}"/></a:solidFill>{FONT}</a:rPr>'
            f'<a:t>{esc(t)}</a:t></a:r>')

def para(runs_xml, sz, algn='ctr', spc=False):
    p = f'<a:pPr marL="0" indent="0" algn="{algn}">'
    if spc:
        p += '<a:lnSpc><a:spcPct val="110000"/></a:lnSpc>'
    p += '<a:buNone/></a:pPr>'
    end = f'<a:endParaRPr lang="en-US" sz="{sz}" dirty="0"/>'
    return f'<a:p>{p}{runs_xml}{end}</a:p>'

def text_shape(x, y, cx, cy, paras, fill=None, ln=None):
    i = nid()
    fillxml = f'<a:solidFill><a:srgbClr val="{fill}"/></a:solidFill>' if fill else '<a:noFill/>'
    lnxml = ln if ln else '<a:ln/>'
    return (f'<p:sp><p:nvSpPr><p:cNvPr id="{i}" name="Text {i}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>'
            f'<p:spPr><a:xfrm><a:off x="{x}" y="{y}"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm>'
            f'<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>{fillxml}{lnxml}</p:spPr>'
            f'<p:txBody><a:bodyPr wrap="square" rtlCol="0" anchor="ctr"/><a:lstStyle/>{paras}</p:txBody></p:sp>')

def card(x, y, title, sub_lines, title_color):
    W, H = 2240280, 1234440
    card_ln = ('<a:ln w="12700"><a:solidFill><a:srgbClr val="EDF2FA"/></a:solidFill>'
               '<a:prstDash val="solid"/></a:ln>')
    shapes = plain_shape(x, y, W, H, 'EDF2FA', geom='roundRect', adj=4444, ln=card_ln)
    shapes += text_shape(x, y + 73152, W, 365760, para(run(title, 1300, title_color, b=True), 1300))
    sub = ''.join(para(run(t, 1050, '666666'), 1050, spc=True) for t in sub_lines)
    shapes += text_shape(x, y + 457200, W, 685800, sub)
    return shapes

# ---------- 组装 slide13 ----------
CARD_X = [2148840, 4663440, 7178040, 9692640]
ARROW_X = [4361688, 6876288, 9390888]
NAVY, BLUE, AMBER = '1F3864', '2E75B6', 'D6A419'

s = ''
# 头部（复刻 slide6）
s += plain_shape(0, 0, 12191695, 822960, NAVY)
s += plain_shape(502920, 256032, 82296, 329184, '4FC3F7')
s += text_shape(713232, 146304, 8229600, 548640, para(run('四、业务逻辑（3）：查询到报告端到端闭环', 2400, 'FFFFFF', b=True), 2400))
s += text_shape(11185855, 201168, 640080, 457200, para(run('07', 1200, 'A9C4E8'), 1200, algn='r'))
# 页脚
s += plain_shape(502920, 6537960, 11185855, 10973, 'C9D6EA')
s += text_shape(502920, 6510528, 2743200, 274320, para(run('船舶险反欺诈智盾', 900, '9AA7B8'), 900, algn='l'))

# ---- 第一行：T-0 查询发起 ----
ROW1_Y = 1143000
s += text_shape(502920, ROW1_Y, 1463040, 411480,
                para(run('T-0 查询发起', 1400, 'FFFFFF', b=True), 1400), fill=NAVY)
row1 = [
    ('① 输入查询请求',   ['Web 表单 · 船舶四要素', '识别号/IMO/中英文名任一']),
    ('② 全量库优先检索', ['命中未过期 → 秒回报告', '过期 → 历史或重查二选一']),
    ('③ 确认收单入队',   ['二次确认发起查询', '本机构队列 · 机构隔离']),
    ('④ Agent 汇总去重', ['聚合全司当日待查询', '同船四要素去重 · 省成本']),
]
for x, (t, sub) in zip(CARD_X, row1):
    s += card(x, ROW1_Y, t, sub, NAVY)
for x in ARROW_X:
    s += text_shape(x, 1572768, 329184, 365760, para(run('▶', 1200, BLUE), 1200))

# ---- S3 连接符 ----
s += text_shape(2651760, 2500000, 6900000, 365760,
                para(run('▼ 总公司单文件三重校验 → 15:00 截单前上传 S3 → T+1 返回 _result ▼', 1300, AMBER), 1300))

# ---- 第二行：T+1 报告生成 ----
ROW2_Y = 3000000
s += text_shape(502920, ROW2_Y, 1463040, 411480,
                para(run('T+1 报告生成', 1400, 'FFFFFF', b=True), 1400), fill=NAVY)
row2 = [
    ('⑤ 轮询下载结果',  ['09:00/11:00/14:00 三次', '下载 _result 结果文件']),
    ('⑥ 解析入全量库',  ['一船 × 多险种结构化', '复合值拆解 · 去重入库']),
    ('⑦ AI 解读引擎',   ['船讯网档案 + 规则引擎', '双维度评估 + LLM 报告']),
    ('⑧ 报告交付 · 评价', ['高风险标红提醒核保人', 'Word/Excel 下载 · 星级评价']),
]
for x, (t, sub) in zip(CARD_X, row2):
    s += card(x, ROW2_Y, t, sub, BLUE)
for x in ARROW_X:
    s += text_shape(x, 3429768, 329184, 365760, para(run('▶', 1200, BLUE), 1200))

# ---- ⑧ 下引 ▼，指向闭环回流条 ----
s += text_shape(10662780, 4264440, 300000, 300000, para(run('▼', 900, BLUE), 900))

# ---- 闭环回流条（指向左侧 ② 全量库，形成闭环）----
s += plain_shape(3400000, 4620000, 7412780, 500000, BLUE)
s += text_shape(3400000, 4620000, 7412780, 500000,
                para(run('◀ 闭环回流：结果 + AI 报告沉淀全量库 · 任何机构下次查询命中即秒回', 1300, 'FFFFFF', b=True), 1300))

# ---- 底部闭环增益说明框（复刻 slide6 白色圆角框）----
note_ln = ('<a:ln w="12700"><a:solidFill><a:srgbClr val="C9D6EA"/></a:solidFill>'
           '<a:prstDash val="solid"/></a:ln>')
s += plain_shape(502920, 5280000, 11183112, 900000, 'FFFFFF', geom='roundRect', adj=7059, ln=note_ln)
p1 = run('闭环增益：', 1150, NAVY, b=True) + run('同船新结果 → 增量更新 AI 报告 · 跨机构去重副本自动回填全机构状态 · 人工评价（1-5 星 + 准确性标签）反哺规则阈值与 Prompt 迭代', 1150, '333333')
p2 = run('资产沉淀：', 1150, NAVY, b=True) + run('全量库随查询持续积累为公司级船舶风险资产 —— 查得越多 · 沉淀越厚 · 秒回越多', 1150, '333333')
note_paras = para(p1, 1150, algn='l', spc=True) + para(p2, 1150, algn='l', spc=True)
s += text_shape(731520, 5280000, 10789920, 900000, note_paras)

# ---------- 组装 slide XML 骨架（复刻 slide6 结构） ----------
skeleton = open(f'{WORK}/ppt/slides/slide6.xml', encoding='utf-8').read()
head = skeleton[:skeleton.index('<p:spTree>') + len('<p:spTree>')]
tail = skeleton[skeleton.rindex('</p:spTree>'):]
slide_xml = head + s + tail
slide_xml = slide_xml.replace('<p:cSld name="Slide 6">', '<p:cSld name="Slide 13">')
open(SLIDE, 'w', encoding='utf-8').write(slide_xml)

# ---------- rels ----------
rels = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout"'
        ' Target="../slideLayouts/slideLayout1.xml"/></Relationships>')
open(f'{WORK}/ppt/slides/_rels/slide13.xml.rels', 'w', encoding='utf-8').write(rels)

# ---------- [Content_Types].xml ----------
ct_path = f'{WORK}/[Content_Types].xml'
ct = open(ct_path, encoding='utf-8').read()
if 'slide13.xml' not in ct:
    ct = ct.replace('</Types>',
        '<Override PartName="/ppt/slides/slide13.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/></Types>')
    open(ct_path, 'w', encoding='utf-8').write(ct)

# ---------- presentation.xml.rels：新增 rId19 → slide13 ----------
pr_path = f'{WORK}/ppt/_rels/presentation.xml.rels'
pr = open(pr_path, encoding='utf-8').read()
if 'rId19' not in pr:
    pr = pr.replace('</Relationships>',
        '<Relationship Id="rId19" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide"'
        ' Target="slides/slide13.xml"/></Relationships>')
    open(pr_path, 'w', encoding='utf-8').write(pr)

# ---------- presentation.xml：插入新页 + 修正章节顺序（六应在七、八之前） ----------
pp_path = f'{WORK}/ppt/presentation.xml'
pp = open(pp_path, encoding='utf-8').read()
old_lst = re.search(r'<p:sldIdLst>.*?</p:sldIdLst>', pp, re.S).group()
new_lst = ('<p:sldIdLst>'
    '<p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId3"/><p:sldId id="258" r:id="rId4"/>'
    '<p:sldId id="259" r:id="rId5"/><p:sldId id="260" r:id="rId6"/><p:sldId id="261" r:id="rId7"/>'
    '<p:sldId id="268" r:id="rId19"/>'
    '<p:sldId id="262" r:id="rId8"/>'
    '<p:sldId id="263" r:id="rId11"/>'
    '<p:sldId id="264" r:id="rId9"/>'
    '<p:sldId id="265" r:id="rId10"/>'
    '<p:sldId id="266" r:id="rId12"/>'
    '<p:sldId id="267" r:id="rId13"/></p:sldIdLst>')
assert old_lst != new_lst, 'sldIdLst unchanged?'
pp = pp.replace(old_lst, new_lst)
open(pp_path, 'w', encoding='utf-8').write(pp)

# ---------- 页码徽章顺延 ----------
BADGE = {7: ('07', '08'), 10: ('08', '09'), 8: ('09', '10'), 9: ('10', '11'), 11: ('11', '12')}
for n, (old, new) in BADGE.items():
    p = f'{WORK}/ppt/slides/slide{n}.xml'
    x = open(p, encoding='utf-8').read()
    tag_old, tag_new = f'<a:t>{old}</a:t>', f'<a:t>{new}</a:t>'
    assert x.count(tag_old) == 1, f'slide{n} badge {old} not unique'
    open(p, 'w', encoding='utf-8').write(x.replace(tag_old, tag_new))
print('slide13 + ordering + badges done')
