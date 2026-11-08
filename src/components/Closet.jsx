import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, markWorn } from '../lib/db.js';
import { CATEGORY_LABEL } from '../lib/rules.js';
import { Chips, Modal, Thumb } from './ui.jsx';
import ItemEditor from './ItemEditor.jsx';
import AddItem, { useUploadJobs } from './AddItem.jsx';
import { enqueueRedo } from '../lib/uploadQueue.js';
import DetectFromPhoto from './DetectFromPhoto.jsx';

const SORTS = [
  { value: 'new', label: '新しい順' },
  { value: 'unworn', label: '着てない順' },
  { value: 'often', label: 'よく着る順' },
];

function daysAgo(t) {
  if (!t) return '未着用';
  const d = Math.floor((Date.now() - t) / 86400000);
  return d === 0 ? '今日' : `${d}日前`;
}

export default function Closet({ addFiles, onAddHandled }) {
  const items = useLiveQuery(() => db.items.toArray(), []) || [];
  const [cat, setCat] = useState('');
  const [sort, setSort] = useState('new');
  const [editing, setEditing] = useState(null);
  const [adding, setAdding] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const showAdd = adding || (addFiles && addFiles.length > 0);
  const jobs = useUploadJobs();
  const pending = jobs.filter((j) => j.status === 'working' || j.status === 'waiting').length;
  const jobErrors = jobs.filter((j) => j.status === 'error').length;
  const unchecked = items.filter((i) => i.unchecked).length;
  const oldPhotos = items.filter((i) => (i.photoVersion || 0) < 2);

  const list = useMemo(() => {
    let l = cat === 'unchecked' ? items.filter((i) => i.unchecked) : cat ? items.filter((i) => i.category === cat) : items;
    l = [...l];
    if (sort === 'new') l.sort((a, b) => b.createdAt - a.createdAt);
    if (sort === 'unworn') l.sort((a, b) => (a.lastWornAt || 0) - (b.lastWornAt || 0));
    if (sort === 'often') l.sort((a, b) => (b.wearCount || 0) - (a.wearCount || 0));
    return l;
  }, [items, cat, sort]);

  const counts = useMemo(() => {
    const c = {};
    items.forEach((i) => (c[i.category] = (c[i.category] || 0) + 1));
    return c;
  }, [items]);

  const sleeping = items.filter((i) => !i.isFixed && (!i.lastWornAt || Date.now() - i.lastWornAt > 30 * 86400000)).length;

  return (
    <section>
      <div className="page-head">
        <div>
          <h2 className="title">Closet</h2>
          <p className="muted">
            {items.length}点
            {items.length > 0 && ` ・ 30日以上着てない服 ${sleeping}点`}
          </p>
        </div>
        <div className="row wrap head-actions">
          <button className="btn" onClick={() => setDetecting(true)}>📸 コーデ写真から</button>
          <button className="btn btn-primary" onClick={() => setAdding(true)}>＋ 服を追加</button>
        </div>
      </div>

      {(pending > 0 || jobErrors > 0) && (
        <button className="upload-banner" onClick={() => setAdding(true)}>
          {pending > 0 && <span className="spinner" />}
          <span>{pending > 0 ? `${pending}点を処理中…` : ''}{jobErrors > 0 ? ` 失敗${jobErrors}点（タップで確認）` : ''}</span>
        </button>
      )}

      {oldPhotos.length > 0 && pending === 0 && (
        <div className="redo-box">
          <span className="small">{oldPhotos.length}点がAI撮り直し前の写真です</span>
          <button
            className="btn btn-small btn-primary"
            onClick={() => {
              if (confirm(`${oldPhotos.length}点の写真を、公式ブティック風の商品写真にAIで撮り直します（1点ごとに画像生成APIを使います）。よろしいですか？`)) enqueueRedo(oldPhotos);
            }}
          >
            ✨ まとめて撮り直す
          </button>
        </div>
      )}

      {items.length === 0 ? (
        <div className="empty">
          <p>まだ服が登録されていません。</p>
          <p className="muted">まずはトップス・ボトムス・靴を数点ずつ登録すると、コーデ提案が使えるようになります。</p>
          <div className="row" style={{ justifyContent: 'center', flexWrap: 'wrap' }}>
            <button className="btn btn-primary" onClick={() => setAdding(true)}>最初の1着を登録する</button>
            <button className="btn" onClick={() => setDetecting(true)}>📸 コーデ写真からまとめて登録</button>
          </div>
        </div>
      ) : (
        <>
          <Chips
            options={[
              ...(unchecked ? [{ value: 'unchecked', label: `未確認 ${unchecked}` }] : []),
              ...Object.entries(CATEGORY_LABEL)
                .filter(([k]) => counts[k])
                .map(([k, v]) => ({ value: k, label: `${v} ${counts[k]}` })),
            ]}
            value={cat}
            onChange={setCat}
          />
          <div className="sort-row">
            <select value={sort} onChange={(e) => setSort(e.target.value)}>
              {SORTS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>
          <div className="grid">
            {list.map((it) => (
              <div key={it.id} className="grid-cell">
                <Thumb item={it} onClick={() => setEditing(it)} badge={it.unchecked ? 'NEW' : it.isFixed ? '固定' : null} />
                {it.brand && <div className="cell-brand">{it.brand}</div>}
                <div className="cell-name">{it.name}</div>
                <div className="cell-meta">{daysAgo(it.lastWornAt)} ・ {it.wearCount || 0}回</div>
              </div>
            ))}
          </div>
        </>
      )}

      <datalist id="brand-list">
        {[...new Set(items.map((i) => i.brand).filter(Boolean))].map((b) => <option key={b} value={b} />)}
      </datalist>

      {editing && (
        <Modal title="アイテムを編集" onClose={() => setEditing(null)}>
          <ItemEditor
            initial={editing}
            image={editing.image}
            onCancel={() => setEditing(null)}
            onSave={async (f) => {
              const { id, ...rest } = f;
              if (!rest.original) delete rest.original;
              await db.items.update(editing.id, { ...rest, unchecked: false });
              setEditing(null);
            }}
            extra={
              <>
                <button type="button" className="btn btn-ghost" onClick={async () => { await markWorn([editing.id]); setEditing(null); }}>
                  今日着た
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={async () => {
                    if (confirm(`「${editing.name}」を削除しますか？`)) {
                      await db.items.delete(editing.id);
                      setEditing(null);
                    }
                  }}
                >
                  削除
                </button>
              </>
            }
          />
        </Modal>
      )}

      {detecting && (
        <Modal title="コーデ写真から登録" onClose={() => setDetecting(false)} wide>
          <DetectFromPhoto onClose={() => setDetecting(false)} />
        </Modal>
      )}

      {showAdd && (
        <Modal title="服を追加" onClose={() => { setAdding(false); onAddHandled?.(); }} wide>
          <AddItem initialFiles={addFiles || []} onClose={() => { setAdding(false); onAddHandled?.(); }} />
        </Modal>
      )}
    </section>
  );
}
