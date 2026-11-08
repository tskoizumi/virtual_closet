import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, markWorn } from '../lib/db.js';
import { CATEGORY_LABEL } from '../lib/rules.js';
import { Chips, Modal, Thumb } from './ui.jsx';
import ItemEditor from './ItemEditor.jsx';
import AddItem from './AddItem.jsx';
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

  const list = useMemo(() => {
    let l = cat ? items.filter((i) => i.category === cat) : items;
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
            options={Object.entries(CATEGORY_LABEL)
              .filter(([k]) => counts[k])
              .map(([k, v]) => ({ value: k, label: `${v} ${counts[k]}` }))}
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
                <Thumb item={it} onClick={() => setEditing(it)} badge={it.isFixed ? '固定' : null} />
                <div className="cell-name">{it.name}</div>
                <div className="cell-meta">{daysAgo(it.lastWornAt)} ・ {it.wearCount || 0}回</div>
              </div>
            ))}
          </div>
        </>
      )}

      {editing && (
        <Modal title="アイテムを編集" onClose={() => setEditing(null)}>
          <ItemEditor
            initial={editing}
            image={editing.image}
            onCancel={() => setEditing(null)}
            onSave={async (f) => {
              const { id, ...rest } = f;
              if (!rest.original) delete rest.original;
              await db.items.update(editing.id, rest);
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
