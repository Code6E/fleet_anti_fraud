import { useState, useEffect, useCallback, useRef } from 'react';
import {
  api, setToken, formatSize, formatDate, basename, parentPrefix, riskBadge, statusLabel, roleLabel, saveResponse,
} from './api.js';

// ====================== 登录页 ======================
function LoginPage({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const r = await api.login(username, password);
      if (r.status === 'ok') {
        setToken(r.token);
        onLogin(r);
      } else {
        setError(r.message || '登录失败');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={submit}>
        <div className="login-logo">⚓</div>
        <h1>船舶险反欺诈查询智能体</h1>
        <p className="login-sub">请输入账号与口令登录</p>
        <input
          type="text" className="login-input" placeholder="账号"
          value={username} onChange={(e) => setUsername(e.target.value)} autoFocus
        />
        <input
          type="password" className="login-input" placeholder="口令"
          value={password} onChange={(e) => setPassword(e.target.value)}
        />
        {error && <div className="login-error">{error}</div>}
        <button className="login-btn" disabled={loading || !password}>
          {loading ? '验证中...' : '进入'}
        </button>
      </form>
    </div>
  );
}

// ====================== 面包屑 ======================
function Breadcrumb({ prefix, onNavigate }) {
  const parts = prefix ? prefix.replace(/\/+$/, '').split('/') : [];
  const crumbs = [{ label: '根目录', prefix: '' }];
  let acc = '';
  for (const p of parts) {
    if (!p) continue;
    acc += p + '/';
    crumbs.push({ label: p, prefix: acc });
  }
  return (
    <div className="breadcrumb">
      {crumbs.map((c, i) => (
        <span key={i} className="crumb-wrap">
          {i > 0 && <span className="crumb-sep">/</span>}
          <span className={i === crumbs.length - 1 ? 'crumb current' : 'crumb'} onClick={() => onNavigate(c.prefix)}>
            {c.label}
          </span>
        </span>
      ))}
    </div>
  );
}

// ====================== 通用对话框 ======================
function RenameDialog({ item, prefix, onClose, onDone }) {
  const [name, setName] = useState(item.name);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const submit = async () => {
    if (!name.trim() || name === item.name) { onClose(); return; }
    setLoading(true); setError('');
    try {
      const base = prefix || '';
      const from = item.key;
      const to = item.type === 'folder' ? (base + name.trim() + '/') : (base + name.trim());
      await api.rename(from, to, item.type);
      onDone();
    } catch (err) { setError(err.message); } finally { setLoading(false); }
  };
  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h3>重命名 {item.type === 'folder' ? '文件夹' : '文件'}</h3>
        <input className="dialog-input" value={name} onChange={(e) => setName(e.target.value)} autoFocus
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} />
        {error && <div className="dialog-error">{error}</div>}
        <div className="dialog-actions">
          <button className="btn btn-secondary" onClick={onClose}>取消</button>
          <button className="btn btn-primary" onClick={submit} disabled={loading}>{loading ? '处理中...' : '确认'}</button>
        </div>
      </div>
    </div>
  );
}

function NewFolderDialog({ prefix, onClose, onDone }) {
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const submit = async () => {
    if (!name.trim()) { onClose(); return; }
    setLoading(true); setError('');
    try { await api.createFolder(prefix, name.trim()); onDone(); }
    catch (err) { setError(err.message); } finally { setLoading(false); }
  };
  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h3>新建文件夹</h3>
        <input className="dialog-input" placeholder="文件夹名称" value={name} onChange={(e) => setName(e.target.value)} autoFocus
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} />
        {error && <div className="dialog-error">{error}</div>}
        <div className="dialog-actions">
          <button className="btn btn-secondary" onClick={onClose}>取消</button>
          <button className="btn btn-primary" onClick={submit} disabled={loading}>{loading ? '创建中...' : '创建'}</button>
        </div>
      </div>
    </div>
  );
}

function ConfirmDialog({ title, message, onClose, onConfirm, loading }) {
  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        <p className="dialog-message">{message}</p>
        <div className="dialog-actions">
          <button className="btn btn-secondary" onClick={onClose}>取消</button>
          <button className="btn btn-danger" onClick={onConfirm} disabled={loading}>{loading ? '删除中...' : '删除'}</button>
        </div>
      </div>
    </div>
  );
}

// ====================== 文件管理 ======================
function FileRow({ item, onNavigate, onDownload, onDelete, onRename }) {
  return (
    <tr className="file-row">
      <td className="col-icon">
        <span className={item.type === 'folder' ? 'icon folder-icon' : 'icon file-icon'}>
          {item.type === 'folder' ? '\u{1F4C1}' : '\u{1F4C4}'}
        </span>
        <span className={item.type === 'folder' ? 'file-name folder-name' : 'file-name'}
          onClick={() => item.type === 'folder' && onNavigate(item.key)}>
          {item.name}
        </span>
      </td>
      <td className="col-size">{item.type === 'file' ? formatSize(item.size) : '-'}</td>
      <td className="col-date">{item.type === 'file' ? formatDate(item.lastModified) : '-'}</td>
      <td className="col-actions">
        <button className="action-btn" onClick={() => onDownload(item)}>下载</button>
        <button className="action-btn" onClick={() => onRename(item)}>重命名</button>
        <button className="action-btn danger" onClick={() => onDelete(item)}>删除</button>
      </td>
    </tr>
  );
}

function FileManager({ me }) {
  const [config, setConfig] = useState(null);
  const [prefix, setPrefix] = useState('');
  const [items, setItems] = useState({ folders: [], files: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef(null);
  const [renameTarget, setRenameTarget] = useState(null);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const loadConfig = useCallback(async () => { try { setConfig(await api.getConfig()); } catch { /* ignore */ } }, []);
  const loadFiles = useCallback(async (p) => {
    setLoading(true); setError('');
    try {
      const data = await api.listFiles(p);
      setItems({ folders: data.folders || [], files: data.files || [] });
    } catch (err) { setError(err.message); setItems({ folders: [], files: [] }); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadConfig(); loadFiles(prefix); }, []); // eslint-disable-line
  const navigate = useCallback((p) => { setPrefix(p); loadFiles(p); }, [loadFiles]);

  const handleUpload = async (files) => {
    if (!files || files.length === 0) return;
    setUploading(true); setError('');
    try { await api.upload(prefix, files); await loadFiles(prefix); }
    catch (err) { setError(err.message); } finally { setUploading(false); }
  };
  const onFileSelect = (e) => { const files = Array.from(e.target.files || []); if (files.length) handleUpload(files); e.target.value = ''; };
  const onDrop = (e) => { e.preventDefault(); setDragging(false); const files = Array.from(e.dataTransfer.files || []); if (files.length) handleUpload(files); };
  const handleDownload = async (item) => {
    try {
      const res = await api.downloadUrl(item.key);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = item.name;
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    } catch (err) { setError('下载失败: ' + err.message); }
  };
  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try { await api.remove(deleteTarget.key, deleteTarget.type); setDeleteTarget(null); await loadFiles(prefix); }
    catch (err) { setError(err.message); } finally { setDeleting(false); }
  };

  const allItems = [...items.folders, ...items.files];
  const isAdmin = me?.role === 'admin';

  return (
    <div className="module">
      <div className="toolbar">
        <Breadcrumb prefix={prefix} onNavigate={navigate} />
        <div className="toolbar-actions">
          {isAdmin && <button className="btn btn-primary btn-sm" onClick={() => fileInputRef.current?.click()} disabled={uploading}>{uploading ? '上传中...' : '上传文件'}</button>}
          {isAdmin && <input ref={fileInputRef} type="file" multiple style={{ display: 'none' }} onChange={onFileSelect} />}
          {isAdmin && <button className="btn btn-secondary btn-sm" onClick={() => setNewFolderOpen(true)}>新建文件夹</button>}
          <button className="btn btn-secondary btn-sm" onClick={() => loadFiles(prefix)} disabled={loading}>刷新</button>
          {prefix && <button className="btn btn-secondary btn-sm" onClick={() => navigate(parentPrefix(prefix))}>上级</button>}
        </div>
      </div>

      {error && <div className="error-bar">{error}<button className="error-close" onClick={() => setError('')}>x</button></div>}
      {!isAdmin && me?.role === 'sub_org' && (
        <div className="info-bar">中支机构账号：文件区仅显示以本中支机构命名的文件；查询结果与 AI 解读报告请通过「船舶查询」页查看（提交的查询随所属分公司文件统一上传与返回）。</div>
      )}
      {!isAdmin && me?.role !== 'sub_org' && (
        <div className="info-bar">分公司账号仅可见文件名含本分公司名的文件（含所属中支机构查询的汇总文件）；写操作仅管理员可执行。</div>
      )}

      <div className="file-list-wrap" onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop}>
        {loading ? <div className="empty-state">加载中...</div>
          : allItems.length === 0 ? <div className="empty-state">{dragging ? '松开鼠标即可上传' : '此文件夹为空'}</div>
          : (
            <table className="file-table">
              <thead><tr><th className="col-icon">名称</th><th className="col-size">大小</th><th className="col-date">修改时间</th><th className="col-actions">操作</th></tr></thead>
              <tbody>
                {allItems.map((item) => (
                  <FileRow key={item.key} item={item} onNavigate={navigate} onDownload={handleDownload} onDelete={setDeleteTarget} onRename={setRenameTarget} />
                ))}
              </tbody>
            </table>
          )}
      </div>

      {renameTarget && <RenameDialog item={renameTarget} prefix={prefix} onClose={() => setRenameTarget(null)} onDone={() => { setRenameTarget(null); loadFiles(prefix); }} />}
      {newFolderOpen && <NewFolderDialog prefix={prefix} onClose={() => setNewFolderOpen(false)} onDone={() => { setNewFolderOpen(false); loadFiles(prefix); }} />}
      {deleteTarget && <ConfirmDialog title="确认删除" message={`确定删除${deleteTarget.type === 'folder' ? '文件夹' : '文件'} "${deleteTarget.name}" 吗？`} loading={deleting} onClose={() => setDeleteTarget(null)} onConfirm={handleDelete} />}
    </div>
  );
}

// ====================== 船舶查询 ======================
function RiskBadge({ level }) {
  const b = riskBadge(level);
  return <span className={'risk-badge ' + b.cls}>{b.text}</span>;
}

// 风险标签分色（v1.5：双维度体系，·高红 / ·中黄 / ·低与「低风险」绿；v1.7：无数据灰）
function riskTagCls(t) {
  if (t.endsWith('·高')) return 'risk-type-tag tag-high';
  if (t.endsWith('·中')) return 'risk-type-tag tag-mid';
  if (t === '无数据' || t.endsWith('·无数据')) return 'risk-type-tag tag-nodata';
  return 'risk-type-tag tag-low'; // ·低 与「低风险」
}

// 风险类型标签（v1.5：双维度标签——业务品质风险·高/中/低、欺诈风险·高/中/低、低风险）
function RiskTypeTags({ raw }) {
  let types = [];
  if (raw) {
    try { types = JSON.parse(raw).filter((t) => typeof t === 'string'); } catch { types = []; }
  }
  if (!types.length) return null;
  return (
    <div className="risk-type-tags">
      {types.map((t) => <span key={t} className={riskTagCls(t)}>{t}</span>)}
    </div>
  );
}

// 风险列渲染（v1.4b：有风险类型的仅显示类型标签，等级徽章仅保留「低风险」；
// 非低等级但无类型为数据异常，兜底显示等级徽章避免信息丢失；v1.5a 起仅命中复用明细弹窗等处使用，列表改用双维度两列 RiskDimCell）
function RiskCell({ level, typesRaw }) {
  let types = [];
  if (typesRaw) {
    try { types = JSON.parse(typesRaw).filter((t) => typeof t === 'string'); } catch { types = []; }
  }
  if (types.length) return <RiskTypeTags raw={typesRaw} />;
  if (!level) return '-';
  return <RiskBadge level={level} />;
}

// v1.5a：单维度风险单元格（列表风险列拆为「业务品质风险」「欺诈风险」两列后，各列显示该维度高/中/低/无数据等级徽章；
// 无维度标签但整船低风险（双低船标签仅为「低风险」）时显示绿色「低」；整船无数据（无投保记录，v1.7）显示灰色「无」；无任何风险数据时显示 '-'）
function RiskDimCell({ typesRaw, level, dim }) {
  let types = [];
  if (typesRaw) {
    try { types = JSON.parse(typesRaw).filter((t) => typeof t === 'string'); } catch { types = []; }
  }
  const hit = types.find((t) => t.startsWith(dim + '·'));
  if (hit) {
    const lv = hit.split('·')[1];
    return <span className={riskTagCls(hit)}>{lv === '无数据' ? '无' : lv}</span>;
  }
  if (level === 'none' || types.includes('无数据')) return <span className="risk-type-tag tag-nodata" title="无数据">无</span>;
  if (level === 'low' || types.includes('低风险')) return <span className="risk-type-tag tag-low">低</span>;
  return <span className="ship-meta">-</span>;
}

// AI 报告人工评价组件（v1.3g：星级评级 + 准确性标签 + 评语，用于反馈 AI 分析是否准确）
function ReportFeedback({ shipId }) {
  const [fb, setFb] = useState(null);
  const [rating, setRating] = useState(0);
  const [accuracy, setAccuracy] = useState('');
  const [comment, setComment] = useState('');
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setLoading(true);
    api.shipFeedback(shipId)
      .then((d) => {
        setFb(d);
        if (d.mine) { setRating(d.mine.rating || 0); setAccuracy(d.mine.accuracy || ''); setComment(d.mine.comment || ''); }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [shipId]);

  const submit = async () => {
    if (!rating) { setMsg('请先选择星级评级'); return; }
    setSubmitting(true); setMsg('');
    try {
      const r = await api.submitShipFeedback(shipId, { rating, accuracy, comment });
      setMsg(r.message || '评价已提交');
      const d = await api.shipFeedback(shipId);
      setFb(d);
    } catch (e) { setMsg(e.message); } finally { setSubmitting(false); }
  };

  if (loading) return null;
  return (
    <div className="report-section" style={{ borderTop: '1px dashed var(--border, #e0e0e0)', paddingTop: 10, marginTop: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 600 }}>人工评价：</span>
        <span title={fb?.count ? `已有 ${fb.count} 人评价，平均 ${fb.avgRating} 星` : '暂无评价'} style={{ cursor: 'default' }}>
          {[1, 2, 3, 4, 5].map((i) => (
            <span key={i} style={{ cursor: 'pointer', fontSize: 18, color: i <= rating ? '#f5a623' : '#ccc' }}
              onClick={() => { setRating(i); setMsg(''); }}>{i <= rating ? '★' : '☆'}</span>
          ))}
          {fb?.count > 0 && <span className="ship-meta" style={{ marginLeft: 8 }}>{fb.count} 人评价 · 平均 {fb.avgRating} 星</span>}
        </span>
        {['准确', '部分准确', '不准确'].map((a) => (
          <span key={a} className={'rule-chip ' + (accuracy === a ? 'risk-medium' : 'risk-none')}
            style={{ cursor: 'pointer' }} onClick={() => setAccuracy(accuracy === a ? '' : a)}>
            {a}
          </span>
        ))}
      </div>
      <textarea
        placeholder="补充评语（可选）：AI 分析是否准确、哪里需要改进…"
        value={comment}
        maxLength={500}
        onChange={(e) => setComment(e.target.value)}
        style={{ width: '100%', minHeight: 56, marginTop: 8, padding: '6px 8px', fontSize: 13, boxSizing: 'border-box' }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6 }}>
        <button className="btn btn-primary btn-sm" onClick={submit} disabled={submitting}>{submitting ? '提交中...' : (fb?.mine ? '更新评价' : '提交评价')}</button>
        {msg && <span className="ship-meta">{msg}</span>}
        {fb?.mine && !msg && <span className="ship-meta">已提交过评价（{formatDate(fb.mine.created_at)}），可修改后重新提交</span>}
      </div>
    </div>
  );
}

// 船舶详情主体（险种结果表 + AI 报告，查询命中与详情弹窗共用；v1.3g 加数据导出/报告下载/人工评价）
// v1.6：报告区域叠加水印（分公司 + 账号，对齐《船舶险智盾报告模板》要求）
function ShipDetailBody({ data, me }) {
  const s = data.ship || {};
  const policies = data.policies || [];
  const report = data.report;
  const [dlErr, setDlErr] = useState('');
  // 水印文本：机构 + 账号（未登录/无用户信息时退化为「内部资料」）
  const watermarkText = (me && me.username) ? `${me.org || '内部'} · ${me.username}` : '内部资料';
  const watermarkBg = (() => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="160"><text x="0" y="80" font-size="14" fill="rgba(100,116,139,0.12)" font-family="PingFang SC, sans-serif" transform="rotate(-24 80 80)">${watermarkText}</text></svg>`;
    return `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}")`;
  })();

  const downloadData = async () => {
    setDlErr('');
    try {
      const res = await api.shipExportData(s.id);
      await saveResponse(res, `船舶数据_${s.name_cn || s.name_en || s.ship_id_no || s.id}.xlsx`);
    } catch (e) { setDlErr('下载数据失败: ' + e.message); }
  };
  const downloadReport = async () => {
    setDlErr('');
    try {
      const res = await api.shipExportReport(s.id);
      await saveResponse(res, `AI解读报告_${s.name_cn || s.name_en || s.ship_id_no || s.id}.pdf`);
    } catch (e) { setDlErr('下载报告失败: ' + e.message); }
  };

  return (
    <div className="ship-result">
      <div className="ship-header">
        <span className="ship-name">{s.name_cn || s.name_en || s.ship_id_no || '-'}</span>
        {/* v1.5：报告弹窗头部显示双维度风险标签（与列表风险列一致；旧等级徽章仅作无标签时兜底） */}
        {s.latest_risk_types ? <RiskTypeTags raw={s.latest_risk_types} /> : <RiskBadge level={s.latest_risk_level} />}
        {s.ship_id_no && <span className="ship-meta">识别号：{s.ship_id_no}</span>}
        {s.imo_no && <span className="ship-meta">IMO：{s.imo_no}</span>}
        {s.last_query_time && <span className="ship-meta">数据更新：{formatDate(s.last_query_time)}</span>}
        <span style={{ flex: 1 }} />
        <button className="action-btn" onClick={downloadData} title="下载中银保信返回的该船舶全部信息列（Excel）">⬇ 下载返回数据（Excel）</button>
      </div>
      {dlErr && <div className="error-bar" onClick={() => setDlErr('')}>{dlErr} ✕</div>}
      {policies.length > 0 && (
        <table className="file-table">
          <thead><tr><th>险种小类</th><th>满期赔付率(已决+未决)</th><th>起保当月出险</th><th>保险公司数</th><th>单均保额/保费</th><th>出险原因</th></tr></thead>
          <tbody>
            {policies.map((p, i) => (
              <tr key={i} className="file-row">
                <td>{p.insurance_subtype || '-'}</td>
                <td>{Array.isArray(p.loss_ratio_total) ? p.loss_ratio_total.join(' / ') : '无数据'}</td>
                <td>{p.early_ratio_1m ? `${p.early_ratio_1m.count}单/${p.early_ratio_1m.pct}%` : '无数据'}</td>
                <td>{p.insurer_count_3y ?? '无'}</td>
                <td>{p.avg_amount_premium ? `${p.avg_amount_premium.amount} / ${p.avg_amount_premium.premium}` : '无数据'}</td>
                <td>{p.accident_causes?.raw || '无'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {report ? (
        <div className="report-section">
          <div className="report-header" style={{ cursor: 'default' }}>
            <span>📋 AI 解读报告（{report.model}）· 生成于 {formatDate(report.generated_at)}</span>
            <button className="action-btn" onClick={downloadReport} title="下载 AI 解读报告（PDF 文档，含斜向水印）">⬇ 下载AI报告（PDF）</button>
          </div>
          {report.rule_hits && report.rule_hits.length > 0 && (
            <div className="rule-hits">命中规则：{report.rule_hits.map((h, i) => (
              <span key={i} className={'rule-chip ' + riskBadge(h.level).cls}>{h.rule} {h.name}</span>
            ))}</div>
          )}
          <div className="report-md-wrap">
            <pre className="report-md">{report.report_md}</pre>
            {/* v1.6：水印层（机构 + 账号），跟随滚动、不遮挡交互 */}
            <div className="report-watermark" style={{ backgroundImage: watermarkBg }} aria-hidden="true" />
          </div>
          <ReportFeedback shipId={s.id} />
          <div className="report-footer">
            <button className="action-btn" title="智能航运风控平台-风控评级">智能航运风控平台-风控评级</button>
          </div>
        </div>
      ) : <div className="info-bar">该船舶暂无 AI 解读报告（结果未返回或解读未完成）</div>}
    </div>
  );
}

// 船舶详情弹窗（按 shipId 加载）
function ShipDetailDialog({ shipId, onClose, me }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!shipId) return;
    setLoading(true); setError(''); setData(null);
    api.getShip(shipId)
      .then((d) => setData(d))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [shipId]);
  if (!shipId) return null;
  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog dialog-lg" onClick={(e) => e.stopPropagation()}>
        <h3>船舶详情与解读报告</h3>
        {loading ? <p className="panel-hint">加载中...</p>
          : error ? <p className="dialog-error">{error}</p>
          : data && <ShipDetailBody data={data} me={me} />}
        <div className="dialog-actions">
          <button className="btn btn-secondary" onClick={onClose}>关闭</button>
        </div>
      </div>
    </div>
  );
}

// v1.4e：命中复用明细弹窗——近半年内重复查询的船舶 + 之前被哪些机构查询过
function HitReuseDialog({ onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api.hitReuse().then(setData).catch((e) => setError(e.message));
  }, []);
  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog dialog-lg" onClick={(e) => e.stopPropagation()}>
        <h3>命中复用明细（近半年）</h3>
        <p className="panel-hint">统计近 180 天内命中全量库复用旧数据的船舶（按船舶去重）；「之前查询过的机构」列出该船舶历史上被哪些机构查询过（含复用与发起查询）。</p>
        {error && <p className="dialog-error">{error}</p>}
        {!error && !data && <p className="panel-hint">加载中...</p>}
        {data && (data.rows.length ? (
          <table className="file-table">
            <thead>
              <tr><th>船舶</th><th>识别号</th><th>IMO</th><th>风险</th><th>复用次数</th><th>最近复用</th><th>之前查询过的机构</th></tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.ship.id}>
                  <td>{r.ship.name_cn || r.ship.name_en || '-'}</td>
                  <td>{r.ship.ship_id_no || '-'}</td>
                  <td>{r.ship.imo_no || '-'}</td>
                  <td><RiskCell level={r.ship.latest_risk_level} typesRaw={r.ship.latest_risk_types} /></td>
                  <td>{r.hit_count}</td>
                  <td>{formatDate(r.last_hit_time)}</td>
                  <td>{r.queried_orgs.length ? r.queried_orgs.map((o) => `${o.org}（${o.count} 次）`).join('、') : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="panel-hint">近半年内暂无命中复用的船舶。</p>)}
        <div className="dialog-actions">
          <button className="btn btn-secondary" onClick={onClose}>关闭</button>
        </div>
      </div>
    </div>
  );
}

// 机构运行概览面板（v1.3e：分公司=本分公司+所属中支范围；中支=本中支范围）
// v1.5a：风险统计改为单独一行两张大卡片（业务品质风险/欺诈风险），卡片内分别展示高/中/低数量
// 「低」口径与列表风险筛选一致：维度·低标签 + 整船低风险（双低船无维度标签，仅「低风险」）
function RiskDimStatCard({ dim, types }) {
  const t = types || {};
  const high = t[dim + '·高'] ?? 0;
  const mid = t[dim + '·中'] ?? 0;
  const low = (t[dim + '·低'] ?? 0) + (t['低风险'] ?? 0);
  const nodata = (t[dim + '·无数据'] ?? 0) + (t['无数据'] ?? 0);
  const cells = [
    { label: '高', value: high, cls: 'lv-high' },
    { label: '中', value: mid, cls: 'lv-mid' },
    { label: '低', value: low, cls: 'lv-low' },
    { label: '无数据', value: nodata, cls: 'lv-nodata' },
  ];
  return (
    <div className="risk-dim-card">
      <div className="risk-dim-title">{dim}</div>
      <div className="risk-dim-body">
        {cells.map((c) => (
          <div key={c.label} className={'risk-dim-cell ' + c.cls}>
            <div className="risk-dim-value">{c.value}</div>
            <div className="risk-dim-cell-label">{c.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function RiskDimStatRow({ types }) {
  return (
    <div className="risk-dim-cards">
      <RiskDimStatCard dim="业务品质风险" types={types} />
      <RiskDimStatCard dim="欺诈风险" types={types} />
    </div>
  );
}

function OrgOverviewPanel({ me }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  // v1.4e：命中复用卡片可点击，弹窗查看明细
  const [showHits, setShowHits] = useState(false);

  useEffect(() => {
    api.shipOverview()
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);

  if (error) return null;
  if (!data) return null;

  const isBranch = me?.role === 'org';
  const scopeText = isBranch
    ? '本分公司及所属中支机构'
    : '本中支机构';

  const cards = [
    { label: '累计查询', value: data.stats.total, cls: '' },
    { label: '待返回', value: data.stats.pending, cls: '' },
    { label: '命中复用（近半年）', value: data.stats.hit, cls: 'stat-good', onClick: () => setShowHits(true) },
    { label: '已返回/解读', value: data.stats.returned, cls: '' },
  ];

  return (
    <div className="panel">
      <h3 className="panel-title">运行概览（{scopeText}）</h3>
      <div className="stat-cards">
        {cards.map((c, i) => (
          <div
            key={i}
            className={'stat-card ' + c.cls + (c.onClick ? ' stat-clickable' : '')}
            onClick={c.onClick}
            title={c.onClick ? '点击查看命中复用明细' : undefined}
          >
            <div className="stat-value">{c.value}</div>
            <div className="stat-label">{c.label}</div>
          </div>
        ))}
      </div>
      {/* v1.5a：风险统计单独一行，分业务品质/欺诈两张大卡片，各展示高/中/低数量（本机构范围关联船舶） */}
      <RiskDimStatRow types={data.stats.riskTypes} />
      {showHits && <HitReuseDialog onClose={() => setShowHits(false)} />}
      <p className="panel-hint" style={{ marginTop: 8 }}>
        {isBranch
          ? '分公司账号可见本分公司及所属全部中支机构的查询记录、返回结果与各风险类型船舶情况；所有机构的查询统一汇总成总公司单文件上传（v1.3f）。'
          : '中支机构账号仅可见本中支机构的查询记录与返回结果；提交的查询将随总公司汇总文件统一上传（v1.3f），中银保信 T+1 返回。'}
        当前上传模式：{data.upload_mode === 'auto' ? `自动（每日 ${data.upload_time}）` : '管理员手动'}。
      </p>
    </div>
  );
}

function ShipQuery({ me }) {
  const [form, setForm] = useState({ ship_id_no: '', imo_no: '', name_cn: '', name_en: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [pendingList, setPendingList] = useState([]);
  // v1.3k：我的查询默认仅展示近 7 天记录（所有账号），可切换近 30 天 / 全部
  const [pendingDays, setPendingDays] = useState(7);
  // v1.5a：风险双维度筛选（业务品质/欺诈各自选高/中/低；待返回未关联船舶的记录无风险数据，两列均为 '-'）
  const [riskFilter, setRiskFilter] = useState({ business: [], fraud: [] });
  const [toast, setToast] = useState('');
  const [detailShipId, setDetailShipId] = useState(null);
  // v1.4d：命中全量库时弹窗确认——使用旧数据（记 hit）或重新查询（入待查询队列）
  const [hitPrompt, setHitPrompt] = useState(null);
  // v1.8：全量库未命中时——调用智能航运风控平台船舶档案，弹窗确认是否回填查询窗口
  const [profilePrompt, setProfilePrompt] = useState(null);
  const [profileLoading, setProfileLoading] = useState(false);

  const emptyForm = { ship_id_no: '', imo_no: '', name_cn: '', name_en: '' };

  const loadPending = useCallback(async () => {
    try {
      const p = await api.listShipPending({
        days: pendingDays || undefined,
        business: riskFilter.business, fraud: riskFilter.fraud,
      });
      setPendingList(p.rows || []);
    } catch (err) { setError(err.message); }
  }, [pendingDays, riskFilter]);
  useEffect(() => { loadPending(); }, [loadPending]);

  const update = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const doQuery = async () => {
    setError(''); setResult(null); setConfirming(false); setHitPrompt(null);
    setProfilePrompt(null); setProfileLoading(false);
    const f = { ...form };
    if (!f.ship_id_no && !f.imo_no && !f.name_cn && !f.name_en) { setError('请至少填写一项查询条件'); return; }
    setLoading(true);
    try {
      const r = await api.shipQuery(f);
      setResult(r);
      if (r.found) {
        setHitPrompt(r);
      } else {
        // v1.8：全量库未命中——调用智能航运风控平台船舶档案，弹窗确认是否回填
        setProfileLoading(true);
        try {
          const pr = await api.shipProfile(f);
          if (pr.found && pr.profile) setProfilePrompt(pr);
        } catch (e) { /* 档案获取失败不阻断，降级为直接展示中银保信确认面板 */ }
        finally { setProfileLoading(false); }
      }
    }
    catch (err) { setError(err.message); } finally { setLoading(false); }
  };

  // v1.8：弹窗选「是」——将船舶档案四要素回填到查询窗口（已有输入优先保留，缺失字段用档案补齐），再进入向中银保信发起查询确认
  const applyProfile = () => {
    const p = profilePrompt?.profile || {};
    const merged = {
      ship_id_no: (p.ship_id_no || form.ship_id_no || '').trim(),
      imo_no: (p.imo_no || form.imo_no || '').trim(),
      name_cn: (p.name_cn || form.name_cn || '').trim(),
      name_en: (p.name_en || form.name_en || '').trim(),
    };
    setForm(merged);
    setResult((r) => (r ? { ...r, conditions: merged } : r));
    setProfilePrompt(null);
  };

  // v1.8：弹窗选「否」——不回填，保留原输入，由用户自行点击向中银保信发起查询
  const skipProfile = () => setProfilePrompt(null);

  // v1.4d：弹窗选「使用旧数据」——记录本机构命中行为后直接查看旧数据
  const useOldData = async () => {
    const shipId = hitPrompt?.results?.[0]?.ship?.id;
    setHitPrompt(null);
    if (!shipId) return;
    try { await api.shipHit(shipId); }
    catch (err) { setError(err.message); }
  };

  // v1.4d：弹窗选「重新查询」——按当前表单条件录入待查询队列，T+1 返回最新数据
  const reQuery = async () => {
    setHitPrompt(null);
    setResult(null);
    setLoading(true);
    try {
      const r = await api.shipPending({ ...form });
      setToast(r.message || '已提交重新查询');
      setForm(emptyForm);
      await loadPending();
    } catch (err) { setError(err.message); } finally { setLoading(false); }
  };

  const confirmQuery = async () => {
    setLoading(true);
    try {
      const c = result.conditions || form;
      const r = await api.shipPending(c);
      setToast(r.message || '已提交');
      setResult(null); setForm(emptyForm);
      await loadPending();
    } catch (err) { setError(err.message); } finally { setLoading(false); }
  };

  return (
    <div className="module">
      {toast && <div className="toast-bar" onClick={() => setToast('')}>{toast} ✓</div>}
      {error && <div className="error-bar">{error}<button className="error-close" onClick={() => setError('')}>x</button></div>}

      {me?.role !== 'admin' && <OrgOverviewPanel me={me} />}

      <div className="panel">
        <h3 className="panel-title">船舶查询</h3>
        <p className="panel-hint">
          按 <b>船舶识别号 / IMO号 / 船舶中文名称 / 船舶英文名称</b> 任一项或多项查询（多项间为 AND）。
          优先查全量库——任何机构查过的船舶直接秒回（免 T+1）；未命中可确认向中银保信发起查询，结果次日返回。
          当前机构：<b>{me?.org || 'DEFAULT'}</b>
        </p>
        <div className="ship-form">
          <label>船舶识别号<input value={form.ship_id_no} onChange={(e) => update('ship_id_no', e.target.value)} placeholder="如 CN20044347636" /></label>
          <label>IMO号<input value={form.imo_no} onChange={(e) => update('imo_no', e.target.value)} placeholder="如 9123456" /></label>
          <label>船舶中文名称<input value={form.name_cn} onChange={(e) => update('name_cn', e.target.value)} placeholder="如 洋朋66" /></label>
          <label>船舶英文名称<input value={form.name_en} onChange={(e) => update('name_en', e.target.value)} placeholder="如 yangpeng66" /></label>
        </div>
        <div className="toolbar-actions">
          <button className="btn btn-primary btn-sm" onClick={doQuery} disabled={loading}>查询</button>
          <button className="btn btn-secondary btn-sm" onClick={() => { setForm(emptyForm); setResult(null); setProfilePrompt(null); }}>清空</button>
        </div>
      </div>

      {hitPrompt && (
        <div className="dialog-overlay">
          <div className="dialog">
            <h3>命中全量库</h3>
            <p className="dialog-message">
              该船舶已于 <b>{formatDate(hitPrompt.last_query_time || hitPrompt.results?.[0]?.ship?.last_query_time)}</b> 查询过
              {hitPrompt.results?.length > 1 ? `（命中 ${hitPrompt.results.length} 条记录）` : ''}。
              {hitPrompt.expired
                ? `数据已超过 ${hitPrompt.results?.[0]?.ttl_days || 90} 天有效期，建议重新查询获取最新数据。`
                : '数据在有效期内，可直接复用旧数据（免 T+1）。'}
              是否使用旧数据？
            </p>
            <div className="dialog-actions">
              <button className="btn btn-secondary" onClick={reQuery} disabled={loading}>重新查询</button>
              <button className="btn btn-primary" onClick={useOldData} disabled={loading}>使用旧数据</button>
            </div>
          </div>
        </div>
      )}

      {profilePrompt && (
        <div className="dialog-overlay">
          <div className="dialog">
            <h3>智能航运风控平台·船舶档案</h3>
            <p className="dialog-message">
              全量库未找到该船舶。已从<b>智能航运风控平台</b>查询到该船舶档案，是否将以下四项查询参数回填到查询窗口？
            </p>
            <ul className="cond-list">
              <li>船舶识别号：<b>{profilePrompt.profile.ship_id_no || '（档案未提供）'}</b></li>
              <li>IMO号：<b>{profilePrompt.profile.imo_no || '（档案未提供）'}</b></li>
              <li>船舶中文名称：<b>{profilePrompt.profile.name_cn || '（档案未提供）'}</b></li>
              <li>船舶英文名称：<b>{profilePrompt.profile.name_en || '（档案未提供）'}</b></li>
            </ul>
            <div className="dialog-actions">
              <button className="btn btn-secondary" onClick={skipProfile}>不回填</button>
              <button className="btn btn-primary" onClick={applyProfile}>确认回填</button>
            </div>
          </div>
        </div>
      )}

      {result && result.found && !hitPrompt && (
        <div className="panel">
          {result.expired && <div className="warn-bar">⚠ {result.message}</div>}
          {!result.expired && <div className="info-bar">{result.message}</div>}
          {result.results.map((r, idx) => (
            <ShipDetailBody key={r.ship?.id || idx} data={r} me={me} />
          ))}
        </div>
      )}

      {result && !result.found && profileLoading && (
        <div className="panel">
          <p className="panel-hint">正在从智能航运风控平台获取该船舶档案…</p>
        </div>
      )}

      {result && !result.found && !profilePrompt && !profileLoading && (
        <div className="panel">
          <p className="panel-hint">{result.message}</p>
          {!confirming ? (
            <div className="toolbar-actions">
              <button className="btn btn-primary btn-sm" onClick={() => setConfirming(true)}>确认向中银保信发起查询</button>
              <button className="btn btn-secondary btn-sm" onClick={() => setResult(null)}>取消</button>
            </div>
          ) : (
            <div className="confirm-box">
              <p>提交后进入本机构待查询队列，由 Agent 按机构配置时刻自动汇总上传（或管理员手动触发）；中银保信 T+1 返回结果后自动导入并生成 AI 解读报告。</p>
              <ul className="cond-list">
                {result.conditions.ship_id_no && <li>船舶识别号：{result.conditions.ship_id_no}</li>}
                {result.conditions.imo_no && <li>IMO号：{result.conditions.imo_no}</li>}
                {result.conditions.name_cn && <li>船舶中文名称：{result.conditions.name_cn}</li>}
                {result.conditions.name_en && <li>船舶英文名称：{result.conditions.name_en}</li>}
              </ul>
              <div className="toolbar-actions">
                <button className="btn btn-primary btn-sm" onClick={confirmQuery} disabled={loading}>提交查询</button>
                <button className="btn btn-secondary btn-sm" onClick={() => setConfirming(false)}>再想想</button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="panel">
        <h3 className="panel-title">
          {me?.role === 'org'
            ? `我的查询（${me?.org || 'DEFAULT'} 及所属中支）`
            : `我的查询（${me?.org || 'DEFAULT'}）`}
        </h3>
        <p className="panel-hint">点击「查看报告」可查看该船舶的险种结果与 AI 解读报告（已解读/命中记录可查看）。「发起机构」列显示该条查询由哪个机构发起；「风险」列下分业务品质风险/欺诈风险两个子列，各自支持按高/中/低筛选（v1.5a）。
          {me?.role === 'admin' && '管理员可见全部机构提交的查询。'}
          {me?.role === 'org' && '分公司账号可见本分公司及所属全部中支机构提交的查询。'}
          {me?.role === 'sub_org' && '中支机构账号仅可见本中支机构提交的查询。'}
        </p>
        <div className="range-select">
          {[{ v: 7, t: '近7天' }, { v: 30, t: '近30天' }, { v: 0, t: '全部' }].map((o) => (
            <button
              key={o.v}
              type="button"
              className={'range-btn' + (pendingDays === o.v ? ' active' : '')}
              onClick={() => setPendingDays(o.v)}
            >{o.t}</button>
          ))}
        </div>
        <table className="file-table">
          <thead>
            {/* v1.5a：「风险」两级表头——第一行合并跨两列，第二行分业务品质/欺诈两个子列，各自支持高/中/低筛选 */}
            <tr>
              <th rowSpan={2}>船舶</th><th rowSpan={2}>识别号</th><th rowSpan={2}>IMO</th>
              <th colSpan={2} className="risk-group-th">风险</th>
              <th rowSpan={2}>发起机构</th><th rowSpan={2}>状态</th><th rowSpan={2}>提交时间</th><th rowSpan={2}>操作</th>
            </tr>
            <tr>
              <th className="risk-sub-th">业务品质风险</th><th className="risk-sub-th">欺诈风险</th>
            </tr>
            <tr className="filter-row">
              <th colSpan={3}></th>
              <th><LevelMultiSelect title="业务品质" values={riskFilter.business} onChange={(business) => setRiskFilter({ ...riskFilter, business })} /></th>
              <th><LevelMultiSelect title="欺诈" values={riskFilter.fraud} onChange={(fraud) => setRiskFilter({ ...riskFilter, fraud })} /></th>
              <th colSpan={4}>
                {(riskFilter.business.length || riskFilter.fraud.length)
                  ? <button className="action-btn" onClick={() => setRiskFilter({ business: [], fraud: [] })}>清除</button>
                  : null}
              </th>
            </tr>
          </thead>
          <tbody>
            {pendingList.length === 0 && (
              <tr><td colSpan={9} className="empty-state">
                {(pendingDays || riskFilter.business.length || riskFilter.fraud.length)
                  ? (riskFilter.business.length || riskFilter.fraud.length
                    ? '暂无符合风险筛选的查询记录（可调整或清除筛选）'
                    : `近 ${pendingDays} 天暂无查询记录`)
                  : '暂无查询记录'}
              </td></tr>
            )}
            {pendingList.map((p) => (
              <tr key={p.id} className="file-row">
                {/* v1.9：命中全量库的记录四要素列为空，后端用关联船舶回填为 eff_*；兼容旧后端无 eff_* 时回退到入参字段 */}
                <td>{p.eff_name_cn || p.name_cn || p.eff_name_en || p.name_en || '-'}</td>
                <td>{p.eff_ship_id_no || p.ship_id_no || '-'}</td>
                <td>{p.eff_imo_no || p.imo_no || '-'}</td>
                {/* v1.5a：风险列拆双维度两列，各显示高/中/低等级徽章 */}
                <td><RiskDimCell typesRaw={p.latest_risk_types} level={p.latest_risk_level} dim="业务品质风险" /></td>
                <td><RiskDimCell typesRaw={p.latest_risk_types} level={p.latest_risk_level} dim="欺诈风险" /></td>
                <td>{p.org || '-'}</td>
                <td>{statusLabel(p.status)}</td>
                <td>{p.created_at ? formatDate(p.created_at) : '-'}</td>
                <td>{p.ship_id
                  ? <button className="action-btn" onClick={() => setDetailShipId(p.ship_id)}>查看报告</button>
                  : <span className="ship-meta">待返回</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* v1.3j：分公司/中支也展示船舶库列表（功能与管理员一致，仅见权限范围内数据，后端按机构范围过滤） */}
      {me?.role !== 'admin' && <ShipLibraryPanel me={me} />}

      {detailShipId && <ShipDetailDialog shipId={detailShipId} onClose={() => setDetailShipId(null)} me={me} />}
    </div>
  );
}

// ====================== 管理员面板 ======================
// v1.5a：风险列拆双维度两列后的等级多选下拉（业务品质/欺诈各自选高/中/低/无数据；值传后端 business/fraud 参数）
const LEVEL_OPTIONS = [
  { v: 'high', t: '高', cls: 'risk-type-tag tag-high' },
  { v: 'medium', t: '中', cls: 'risk-type-tag tag-mid' },
  { v: 'low', t: '低', cls: 'risk-type-tag tag-low' },
  { v: 'none', t: '无数据', cls: 'risk-type-tag tag-nodata' },
];

function LevelMultiSelect({ title, values, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const toggle = (lv) => onChange(values.includes(lv) ? values.filter((v) => v !== lv) : [...values, lv]);
  const label = values.length
    ? values.map((v) => (LEVEL_OPTIONS.find((o) => o.v === v) || {}).t).join('/')
    : (title || '全部');

  return (
    <div className="risk-select" ref={ref}>
      <button type="button" className={'risk-select-btn' + (values.length ? ' active' : '')} onClick={() => setOpen(!open)}>
        {label} ▾
      </button>
      {open && (
        <div className="risk-select-menu">
          {LEVEL_OPTIONS.map((o) => (
            <label key={o.v} className="risk-select-item">
              <input type="checkbox" checked={values.includes(o.v)} onChange={() => toggle(o.v)} />
              <span className={o.cls}>{o.t}</span>
            </label>
          ))}
          <button type="button" className="action-btn" style={{ marginTop: 6 }} onClick={() => onChange([])}>清除</button>
        </div>
      )}
    </div>
  );
}

const emptyShipFilter = { name: '', ship_id_no: '', imo_no: '', org: '', business: [], fraud: [], date_from: '', date_to: '' };

// 当前是否有任一筛选条件生效（用于空态文案区分）
function shipFilterActive(f) {
  return !!(f.name || f.ship_id_no || f.imo_no || f.org || f.business.length || f.fraud.length || f.date_from || f.date_to);
}

// 船舶库列表面板（v1.3j：功能与管理员一致；分公司/中支仅见权限范围内查询行为关联的船舶，后端 /api/ships 已按机构范围过滤）
function ShipLibraryPanel({ me, refreshKey = 0 }) {
  const [ships, setShips] = useState([]);
  const [detailShipId, setDetailShipId] = useState(null);
  const [error, setError] = useState('');
  // v1.3i：船舶库列筛选（除操作列外每列可筛）
  const [shipFilter, setShipFilter] = useState(emptyShipFilter);
  const shipFilterRef = useRef(emptyShipFilter);
  const firstFilterRender = useRef(true);

  const updateShipFilter = (patch) => {
    setShipFilter((f) => {
      const n = { ...f, ...patch };
      shipFilterRef.current = n;
      return n;
    });
  };

  const loadShips = useCallback(async () => {
    const f = shipFilterRef.current;
    try {
      const sh = await api.listShips({
        name: f.name, ship_id_no: f.ship_id_no, imo_no: f.imo_no, org: f.org,
        business: f.business, fraud: f.fraud, date_from: f.date_from, date_to: f.date_to,
      });
      setShips(sh.rows || []);
    } catch (err) { setError(err.message); }
  }, []);

  // 首次加载 + refreshKey 变化时重载（管理员操作后由父组件触发刷新）
  useEffect(() => { loadShips(); }, [loadShips, refreshKey]);

  // 筛选变更后防抖重新加载（首次渲染已由上面的挂载加载兜底，避免重复请求）
  useEffect(() => {
    if (firstFilterRender.current) { firstFilterRender.current = false; return; }
    const t = setTimeout(loadShips, 300);
    return () => clearTimeout(t);
  }, [shipFilter, loadShips]);

  const role = me?.role;
  const scopeText = role === 'admin' ? '全量' : role === 'org' ? '本分公司及所属中支' : '本中支';

  return (
    <div className="panel">
      <h3 className="panel-title">船舶库（{scopeText}，{ships.length} 艘）</h3>
      <p className="panel-hint">
        {role === 'admin'
          ? '所有机构查询过的船舶汇总（数据共享层）。除操作列外每列支持筛选：船舶/识别号/IMO/首次查询机构输入内容筛选，「风险」列下分业务品质风险/欺诈风险两个子列、各自选高/中/低（v1.5a），数据更新列选时间范围。点击「查看报告」查看险种结果与 AI 解读报告。'
          : `${scopeText}范围内查询行为关联的船舶（仅权限范围内可见）。除操作列外每列支持筛选：船舶/识别号/IMO/首次查询机构输入内容筛选，「风险」列下分业务品质风险/欺诈风险两个子列、各自选高/中/低（v1.5a），数据更新列选时间范围。点击「查看报告」查看险种结果与 AI 解读报告。`}
      </p>
      {error && <div className="error-bar">{error}<button className="error-close" onClick={() => setError('')}>x</button></div>}
      <table className="file-table">
        <thead>
          {/* v1.5a：「风险」两级表头——第一行合并跨两列，第二行分业务品质/欺诈两个子列；筛选行每列一一对应 */}
          <tr>
            <th rowSpan={2}>船舶</th><th rowSpan={2}>识别号</th><th rowSpan={2}>IMO</th>
            <th colSpan={2} className="risk-group-th">风险</th>
            <th rowSpan={2}>首次查询机构</th><th rowSpan={2}>数据更新</th><th rowSpan={2}>操作</th>
          </tr>
          <tr>
            <th className="risk-sub-th">业务品质风险</th><th className="risk-sub-th">欺诈风险</th>
          </tr>
          <tr className="filter-row">
            <th><input className="filter-input" placeholder="输入筛选" value={shipFilter.name} onChange={(e) => updateShipFilter({ name: e.target.value })} /></th>
            <th><input className="filter-input" placeholder="输入筛选" value={shipFilter.ship_id_no} onChange={(e) => updateShipFilter({ ship_id_no: e.target.value })} /></th>
            <th><input className="filter-input" placeholder="输入筛选" value={shipFilter.imo_no} onChange={(e) => updateShipFilter({ imo_no: e.target.value })} /></th>
            <th><LevelMultiSelect title="业务品质" values={shipFilter.business} onChange={(business) => updateShipFilter({ business })} /></th>
            <th><LevelMultiSelect title="欺诈" values={shipFilter.fraud} onChange={(fraud) => updateShipFilter({ fraud })} /></th>
            <th><input className="filter-input" placeholder="输入筛选" value={shipFilter.org} onChange={(e) => updateShipFilter({ org: e.target.value })} /></th>
            <th>
              <div className="date-range">
                <input type="date" className="date-input" title="起始日期" value={shipFilter.date_from} onChange={(e) => updateShipFilter({ date_from: e.target.value })} />
                <span className="ship-meta">至</span>
                <input type="date" className="date-input" title="结束日期" value={shipFilter.date_to} onChange={(e) => updateShipFilter({ date_to: e.target.value })} />
              </div>
            </th>
            <th><button className="action-btn" onClick={() => updateShipFilter({ ...emptyShipFilter })}>清除筛选</button></th>
          </tr>
        </thead>
        <tbody>
          {ships.length === 0 && (
            <tr><td colSpan="8" className="empty-state">
              {shipFilterActive(shipFilter) ? '没有符合筛选条件的船舶记录（可调整或清除筛选）'
                : role === 'admin' ? '暂无船舶记录（导入结果文件后自动入库）'
                : '暂无权限范围内的船舶记录（本机构发起的查询返回后自动入库）'}
            </td></tr>
          )}
          {ships.map((s) => (
            <tr key={s.id} className="file-row">
              <td>{s.name_cn || s.name_en || s.ship_id_no || '-'}</td>
              <td>{s.ship_id_no || '-'}</td>
              <td>{s.imo_no || '-'}</td>
              {/* v1.5a：风险列拆双维度两列，各显示高/中/低等级徽章 */}
              <td><RiskDimCell typesRaw={s.latest_risk_types} level={s.latest_risk_level} dim="业务品质风险" /></td>
              <td><RiskDimCell typesRaw={s.latest_risk_types} level={s.latest_risk_level} dim="欺诈风险" /></td>
              <td>{s.first_queried_org || '-'}</td>
              <td>{s.last_query_time ? formatDate(s.last_query_time) : '-'}</td>
              <td><button className="action-btn" onClick={() => setDetailShipId(s.id)}>查看报告</button></td>
            </tr>
          ))}
        </tbody>
      </table>

      {detailShipId && <ShipDetailDialog shipId={detailShipId} onClose={() => setDetailShipId(null)} me={me} />}
    </div>
  );
}

function AdminPage({ me }) {
  const [stats, setStats] = useState(null);
  const [logs, setLogs] = useState([]);
  const [agentOn, setAgentOn] = useState(true);
  const [uploadCfg, setUploadCfg] = useState({ upload_mode: 'manual', upload_time: '14:30' });
  const [editingUpload, setEditingUpload] = useState(false);
  const [editMode, setEditMode] = useState('manual');
  const [editTime, setEditTime] = useState('14:30');
  const [opLoading, setOpLoading] = useState(false);
  const [opMsg, setOpMsg] = useState('');
  const [error, setError] = useState('');
  const [importDate, setImportDate] = useState('');
  // v1.4e：命中复用卡片可点击，弹窗查看明细
  const [showHits, setShowHits] = useState(false);
  // v1.3j：船舶库列表抽取为 ShipLibraryPanel，数据变更操作后通过 shipRefresh 通知其重载
  const [shipRefresh, setShipRefresh] = useState(0);
  const refreshShips = () => setShipRefresh((k) => k + 1);

  const loadAll = useCallback(async () => {
    try {
      const [s, l, a, uc] = await Promise.all([api.adminStats(), api.adminLogs(50), api.agentEnabled(), api.adminUploadConfig()]);
      setStats(s.stats); setLogs(l.rows || []); setAgentOn(a.enabled);
      setUploadCfg({ upload_mode: uc.upload_mode, upload_time: uc.upload_time });
      setEditMode(uc.upload_mode); setEditTime(uc.upload_time);
    } catch (err) { setError(err.message); }
  }, []);
  useEffect(() => { loadAll(); }, [loadAll]);

  const runExport = async () => {
    setOpLoading(true); setOpMsg(''); setError('');
    try {
      // v1.3f：统一汇总成总公司单文件（去重后一个文件）
      const r = await api.exportNow();
      const dedup = r.dedupCount ? `·去重合并 ${r.dedupCount} 条重复查询` : '';
      const f = (r.files || [])[0];
      setOpMsg(f ? `已汇总上传 1 个总公司文件：${f.fileName}（${f.count} 条）${dedup}` : `无待提交查询${dedup}`);
      await loadAll(); refreshShips();
    } catch (err) { setError(err.message); } finally { setOpLoading(false); }
  };
  const runImport = async () => {
    setOpLoading(true); setOpMsg(''); setError('');
    try {
      const r = await api.importNow(importDate || undefined);
      const ok = (r.imported || []).length;
      const skip = (r.skipped || []).length;
      const fail = (r.failed || []).length;
      setOpMsg(`轮询完成：导入 ${ok} 个文件（跳过 ${skip}、失败 ${fail}），共处理 ${r.matched} 个结果文件`);
      await loadAll(); refreshShips();
    } catch (err) { setError(err.message); } finally { setOpLoading(false); }
  };
  const runSimulate = async () => {
    setOpLoading(true); setOpMsg(''); setError('');
    try {
      const r = await api.simulateReturn(importDate || undefined);
      const gen = (r.generated || []).length;
      const fail = (r.failed || []).length;
      const ships = (r.generated || []).reduce((a, g) => a + (g.shipCount || 0), 0);
      let msg = `模拟中银保信返回：处理 ${r.matched} 个待查询文件，生成 ${gen} 个结果文件（${ships} 艘船）`;
      if (r.importResult) {
        const ok = (r.importResult.imported || []).length;
        msg += `；自动导入 ${ok} 个文件并触发 AI 解读`;
      }
      if (fail) msg += `；失败 ${fail}`;
      setOpMsg(msg);
      await loadAll(); refreshShips();
    } catch (err) { setError(err.message); } finally { setOpLoading(false); }
  };
  const toggleAgent = async () => {
    try { const r = await api.setAgentEnabled(!agentOn); setAgentOn(r.enabled); }
    catch (err) { setError(err.message); }
  };
  const saveUploadCfg = async () => {
    try {
      const r = await api.setAdminUploadConfig(editMode, editTime);
      setUploadCfg({ upload_mode: r.upload_mode, upload_time: r.upload_time });
      setEditingUpload(false);
      setOpMsg(`已更新全局上传配置：${r.upload_mode === 'auto' ? `自动（${r.upload_time}）` : '手动'}`);
      await loadAll(); refreshShips();
    } catch (err) { setError(err.message); }
  };

  const statCards = stats ? [
    { label: '全量船舶', value: stats.ships, cls: '' },
    { label: '待返回', value: stats.pending, cls: '' },
    { label: '命中复用（近半年）', value: stats.hitQueries, cls: 'stat-good', onClick: () => setShowHits(true) },
  ] : [];

  return (
    <div className="module">
      {error && <div className="error-bar">{error}<button className="error-close" onClick={() => setError('')}>x</button></div>}
      {opMsg && <div className="toast-bar" onClick={() => setOpMsg('')}>{opMsg} ✓</div>}

      <div className="panel">
        <h3 className="panel-title">运行概览</h3>
        <div className="stat-cards">
          {statCards.map((c, i) => (
            <div
              key={i}
              className={'stat-card ' + c.cls + (c.onClick ? ' stat-clickable' : '')}
              onClick={c.onClick}
              title={c.onClick ? '点击查看命中复用明细' : undefined}
            >
              <div className="stat-value">{c.value}</div>
              <div className="stat-label">{c.label}</div>
            </div>
          ))}
        </div>
        {/* v1.5a：风险统计单独一行，分业务品质/欺诈两张大卡片，各展示高/中/低数量（全量船舶库） */}
        {stats && <RiskDimStatRow types={stats.riskTypes} />}
        {showHits && <HitReuseDialog onClose={() => setShowHits(false)} />}
        <div className="toolbar-actions" style={{ marginTop: 12 }}>
          <button className={agentOn ? 'btn btn-danger btn-sm' : 'btn btn-primary btn-sm'} onClick={toggleAgent}>
            {agentOn ? '停用 Agent 调度' : '启用 Agent 调度'}
          </button>
          <span className="ship-meta">当前状态：{agentOn ? '运行中' : '已停用'}</span>
          <span className="ship-meta" style={{ marginLeft: 16 }}>
            全局上传：{uploadCfg.upload_mode === 'auto' ? `自动（每日 ${uploadCfg.upload_time} 触发）` : '手动'}
          </span>
          <button className="btn btn-secondary btn-sm" onClick={() => { setEditMode(uploadCfg.upload_mode); setEditTime(uploadCfg.upload_time); setEditingUpload(true); }}>编辑上传配置</button>
        </div>
        <p className="panel-hint" style={{ marginTop: 8 }}>
          v1.3b：所有机构统一时刻或管理员手动触发，不再差异化机构时刻；汇总前自动按船舶四要素去重（每条返回成本 4 元，减少查询次数直接省钱）。
        </p>
      </div>

      <div className="panel">
        <h3 className="panel-title">手动触发</h3>
        <p className="panel-hint">v1.3f：所有机构（总公司/分公司/中支）待查询汇总成<b>一个总公司查询文件</b>上传（汇总前按船舶四要素去重）；检索导入扫描 download/ 全量 _result 文件。</p>
        <div className="toolbar-actions">
          <button className="btn btn-primary btn-sm" onClick={runExport} disabled={opLoading}>上传待查询（汇总总公司）</button>
          <span className="ship-meta">结果日期（空=全部）</span>
          <input type="date" className="date-input" value={importDate} onChange={(e) => setImportDate(e.target.value)} />
          <button className="btn btn-secondary btn-sm" onClick={runImport} disabled={opLoading}>检索导入结果</button>
        </div>
        <div className="toolbar-actions" style={{ marginTop: 8 }}>
          <button className="btn btn-primary btn-sm" onClick={runSimulate} disabled={opLoading}>⚡ 模拟中银保信返回</button>
          <span className="ship-meta">读取 upload/ 待查询文件 → 生成模拟 result 文件放入 download/ → 自动导入并触发 AI 解读</span>
        </div>
      </div>

      {/* v1.3j：船舶库列表抽取为 ShipLibraryPanel（管理员=全量；分公司/中支=权限范围，见船舶查询页）；v1.6 传入真实 me 供报告水印使用 */}
      <ShipLibraryPanel me={me || { role: 'admin' }} refreshKey={shipRefresh} />

      {editingUpload && (
        <UploadConfigDialog
          mode={editMode} setMode={setEditMode}
          time={editTime} setTime={setEditTime}
          onClose={() => setEditingUpload(false)} onSave={saveUploadCfg}
        />
      )}

      <div className="panel">
        <h3 className="panel-title">Agent 运行日志（最近 50 条）</h3>
        <table className="file-table">
          <thead><tr><th>时间</th><th>任务</th><th>机构</th><th>状态</th><th>详情</th></tr></thead>
          <tbody>
            {logs.length === 0 && <tr><td colSpan="5" className="empty-state">暂无运行日志</td></tr>}
            {logs.map((l) => (
              <tr key={l.id} className="file-row">
                <td>{formatDate(l.finished_at || l.started_at)}</td>
                <td>{l.task_type}</td>
                <td>{l.org || '-'}</td>
                <td><span className={l.status === 'ok' ? 'status-ok' : 'status-err'}>{l.status}</span></td>
                <td className="log-detail">{l.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// v1.3b 新增：全局上传配置弹窗
function UploadConfigDialog({ mode, setMode, time, setTime, onClose, onSave }) {
  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h3>全局上传配置</h3>
        <p className="panel-hint">所有机构统一时刻或管理员手动触发；汇总前自动按船舶四要素去重（4 元/次返回成本，减少重复查询即省钱）。</p>
        <label className="dialog-label">上传模式
          <select className="dialog-input" value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="manual">手动（管理员触发）</option>
            <option value="auto">自动（每日定时）</option>
          </select>
        </label>
        {mode === 'auto' && (
          <label className="dialog-label">自动上传时刻（限 12:00-14:50，中银保信 15:00 截单）
            <input className="dialog-input" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </label>
        )}
        {mode === 'manual' && (
          <p className="panel-hint">手动模式下：管理员在「手动触发」面板点「上传待查询」一键上传所有机构；或单机构用户在查询页内手动触发本机构。</p>
        )}
        <div className="dialog-actions">
          <button className="btn btn-secondary" onClick={onClose}>取消</button>
          <button className="btn btn-primary" onClick={onSave}>保存</button>
        </div>
      </div>
    </div>
  );
}

// ====================== 顶层 App ======================
export default function App() {
  const [authed, setAuthed] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [me, setMe] = useState(null);
  const [view, setView] = useState('ships'); // ships | files | admin
  const [sourceInfo, setSourceInfo] = useState(null);
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const required = await api.authRequired();
        if (!required) { setNeedsAuth(false); setAuthed(true); }
        else if (localStorage.getItem('s3fm_token')) {
          try {
            const m = await api.me(); setMe(m); setNeedsAuth(true); setAuthed(true);
          } catch { setNeedsAuth(true); setAuthed(false); }
        } else { setNeedsAuth(true); setAuthed(false); }
      } catch { setNeedsAuth(false); setAuthed(true); }
      finally { setCheckingAuth(false); }
      api.getSource().then(setSourceInfo).catch(() => {});
    })();
  }, []);

  const switchSource = async (id) => {
    if (!id || switching || sourceInfo?.source === id) return;
    setSwitching(true);
    try { const info = await api.setSource(id); setSourceInfo(info); }
    catch (err) { alert('切换数据源失败：' + err.message); }
    finally { setSwitching(false); }
  };

  const onLogin = async (loginRes) => {
    try { const m = await api.me(); setMe(m); }
    catch { setMe({ username: loginRes?.username, org: loginRes?.org, role: loginRes?.role, parent_org: loginRes?.parent_org || '' }); }
    setAuthed(true);
  };

  if (checkingAuth) return <div className="loading-screen">正在初始化...</div>;
  if (needsAuth && !authed) return <LoginPage onLogin={onLogin} />;

  const currentSource = sourceInfo?.source || 's3';
  const isAdmin = me?.role === 'admin';
  // v1.3f：非管理员不展示文件管理模块（权限收口），强制回退到船舶查询
  const safeView = (!isAdmin && view !== 'ships') ? 'ships' : view;

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-left">
          <span className="logo">⚓</span>
          <span className="title">船舶险反欺诈查询智能体</span>
          <nav className="nav">
            <button className={safeView === 'ships' ? 'nav-btn active' : 'nav-btn'} onClick={() => setView('ships')}>船舶查询</button>
            {isAdmin && <button className={safeView === 'files' ? 'nav-btn active' : 'nav-btn'} onClick={() => setView('files')}>文件管理</button>}
            {isAdmin && <button className={safeView === 'admin' ? 'nav-btn active' : 'nav-btn'} onClick={() => setView('admin')}>管理员</button>}
          </nav>
        </div>
        <div className="topbar-right">
          {sourceInfo && (
            <div className="source-switch" title="切换数据源（生产内网桶 / 本地离线数据库）">
              {sourceInfo.sources.map((s) => (
                <button key={s.id} className={'src-btn' + (sourceInfo.source === s.id ? ' active' : '') + (s.id === 'local' ? ' src-local' : '')}
                  disabled={!s.available || switching} onClick={() => switchSource(s.id)}
                  title={s.available ? s.detail : ('不可用：' + s.detail)}>
                  {s.label}
                </button>
              ))}
            </div>
          )}
          {me && <span className="bucket-info">{me.username} · {me.org} · {roleLabel(me.role)}</span>}
          {needsAuth && <button className="btn btn-secondary btn-sm" onClick={() => { setToken(''); setAuthed(false); }}>退出</button>}
        </div>
      </header>

      {currentSource === 'local' && (
        <div className="local-banner">本地数据库模式（离线调试）：正在浏览「{sourceInfo?.sources?.find((s) => s.id === 'local')?.detail || '本地S3数据库'}」的镜像文件，操作仅影响本地目录。</div>
      )}

      {safeView === 'ships' ? <ShipQuery key={currentSource} me={me} />
        : safeView === 'files' ? <FileManager key={currentSource} me={me} />
        : <AdminPage key={currentSource} me={me} />}
    </div>
  );
}
