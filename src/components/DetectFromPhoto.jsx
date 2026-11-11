import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, newId, compactItem, markWorn, getProfile } from '../lib/db.js';
import { makeProductSet, PHOTO_VERSION } from '../lib/productPhoto.js';
import { api } from '../lib/api.js';
import { resize, forAI, cropBox } from '../lib/image.js';
import { CATEGORY_LABEL } from '../lib/rules.js';
import ItemEditor from './ItemEditor.jsx';
import { BlobImg, ErrorBox, FilePick, Modal, Spinner, Thumb, useBlobUrl } from './ui.jsx';

const FIELDS = ['name', 'brand', 'brandConfidence', 'category', 'subcategory', 'colors', 'material', 'pattern', 'formality', 'warmth', 'seasons', 'notes', 'details', 'shownSide', 'backDetail'];

// コーデ写真（着用写真）→ アイテムを検出 → 確認・編集 → まとめて登録
export default function DetectFromPhoto({ onClose }) {
  const items = useLiveQuery(() => db.items.toArray(), []) || [];
  const byId = useMemo(() => Object.fromEntries(items.map((i) => [i.id, i])), [items]);
  const [photo, setPhoto] = useState(null);
  const photoUrl = useBlobUrl(photo);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState(null);
  const [dets, setDets] = useState(null);
  const [editing, setEditing] = useState(null);
  const [recordWorn, setRecordWorn] = useState(true);
  const [done, setDone] = useState(null);

  const detect = async (file) => {
    setError(null);
    setDets(null);
    setDone(null);
    setBusy('写真を準備中…');
    try {
      const original = await resize(file, 2000, { type: 'image/jpeg', quality: 0.9 });
      setPhoto(original);
      setBusy('AIがアイテムを検出中…');
      const res = await api('detect', { image: await forAI(original, 1536), closet: items.map(compactItem) });
      if (!res.items?.length) throw new Error('アイテムを検出できませんでした。全身が明るく写った写真で試してください');
      setBusy('アイテムを切り出し中…');
      const list = [];
      for (const d of res.items) {
        let image = null;
        try {
          image = await resize(await cropBox(original, d.box_2d), 900, { type: 'image/jpeg', quality: 0.9 });
        } catch {}
        if (!image) continue;
        const fields = {};
        FIELDS.forEach((k) => (fields[k] = d[k]));
        const match = d.matchId && byId[d.matchId] ? d.matchId : '';
        list.push({ key: newId(), fields, image, crop: image, matchId: match, include: !match, partial: d.visibility === '一部が隠れている' });
      }
      if (!list.length) throw new Error('検出結果を切り出せませんでした。別の写真で試してください');
      const profile = await getProfile();
      const ai = profile.photoMode === 'ai';
      setDets(list.map((d) => ({ ...d, photoBusy: ai && !d.matchId })));
      if (ai) productizeAll(list.filter((d) => !d.matchId));
    } catch (e) {
      setError(e);
    } finally {
      setBusy('');
    }
  };

  // 切り出した画像をAIで商品写真に撮り直す（3件ずつ並列）
  const productizeAll = async (list) => {
    const queue = [...list];
    const worker = async () => {
      while (queue.length) {
        const d = queue.shift();
        try {
          const { image, gallery } = await makeProductSet(d.image, d.fields);
          update(d.key, { image, gallery, photoBusy: false, aiPhoto: true });
        } catch (e) {
          update(d.key, { photoBusy: false, photoError: e.message });
        }
      }
    };
    await Promise.all([worker(), worker(), worker()]);
  };

  const update = (key, patch) => setDets((ds) => ds.map((d) => (d.key === key ? { ...d, ...patch } : d)));

  const save = async () => {
    setBusy('登録中…');
    try {
      const now = Date.now();
      const newIds = [];
      for (const d of dets.filter((x) => x.include)) {
        const id = newId();
        await db.items.add({ ...d.fields, isFixed: !!d.fields.isFixed, id, image: d.image, gallery: d.gallery || [], original: d.crop || d.image, photoVersion: d.aiPhoto ? PHOTO_VERSION : 0, createdAt: now, wearCount: 0, lastWornAt: null });
        newIds.push(id);
      }
      const matched = dets.filter((x) => !x.include && x.matchId).map((x) => x.matchId);
      const all = [...newIds, ...matched];
      if (recordWorn && all.length) {
        await markWorn(all, now);
        await db.outfits.add({
          id: newId(), createdAt: now, title: '写真から記録', itemIds: all, fixedIds: [],
          reason: 'コーデ写真から登録したコーデ', styling_tip: '', context: {}, rating: null, worn: true, wornAt: now,
        });
      }
      setDone({ added: newIds.length, matched: matched.length });
      setDets(null);
      setPhoto(null);
    } catch (e) {
      setError(e);
    } finally {
      setBusy('');
    }
  };

  const count = dets?.filter((d) => d.include).length || 0;

  return (
    <div>
      <p className="muted">
        全身のコーデ写真（鏡の前の自撮りなど）から、写っているアイテムをまとめて登録します。手持ちと同じアイテムは自動で見分けます。
      </p>
      <div className="row">
        <FilePick label="📷 撮影" capture="environment" onFiles={(f) => detect(f[0])} className="btn btn-primary" />
        <FilePick label="🖼 写真を選ぶ" onFiles={(f) => detect(f[0])} className="btn" />
      </div>

      {photoUrl && <img src={photoUrl} alt="コーデ写真" className="shop-img" />}
      {busy && <Spinner label={busy} />}
      <ErrorBox error={error} />

      {done && (
        <div className="done-box">
          <p>新規 {done.added}点を登録{done.matched ? `、手持ち ${done.matched}点を照合` : ''}しました{recordWorn ? '（着用記録つき）' : ''}。</p>
          <div className="row" style={{ justifyContent: 'center' }}>
            <FilePick label="続けて別の写真" onFiles={(f) => detect(f[0])} className="btn" />
            <button className="btn btn-primary" onClick={onClose}>閉じる</button>
          </div>
        </div>
      )}

      {dets && (
        <>
          <h4>検出したアイテム（{dets.length}点）— タップで編集</h4>
          <div className="det-list">
            {dets.map((d) => (
              <div key={d.key} className={`det ${d.include ? '' : 'is-off'}`}>
                <button type="button" className="det-img" onClick={() => setEditing(d)}>
                  <BlobImg blob={d.image} alt={d.fields.name} />
                  {d.photoBusy && <span className="det-busy"><span className="spinner" /></span>}
                </button>
                <div className="det-body">
                  <button type="button" className="det-name" onClick={() => setEditing(d)}>
                    {d.fields.name} <span className="muted small">✎</span>
                  </button>
                  <div className="muted small">
                    {d.fields.brand ? `${d.fields.brand}${d.fields.brandConfidence === 'guess' ? '(推測)' : ''} ・ ` : ''}{CATEGORY_LABEL[d.fields.category]} ・ {d.fields.colors?.join('/')} ・ {d.fields.material}
                    {d.partial && ' ・ 一部隠れ'}
                  </div>
                  {d.photoBusy && <div className="muted small">AIで商品写真に撮り直し中…</div>}
                  {d.photoError && <div className="small" style={{ color: 'var(--bad)' }}>撮り直し失敗（切り出し画像のまま）</div>}
                  {d.matchId && (
                    <div className="det-match">
                      <Thumb item={byId[d.matchId]} size="xs" />
                      <span className="small">手持ちの「{byId[d.matchId]?.name}」と同じ？</span>
                    </div>
                  )}
                  <label className="check small">
                    <input type="checkbox" checked={d.include} onChange={(e) => update(d.key, { include: e.target.checked })} />
                    <span>{d.matchId ? '別のアイテムとして新規登録する' : '登録する'}</span>
                  </label>
                  {d.matchId && !d.include && (
                    <button type="button" className="btn btn-small btn-ghost" onClick={() => update(d.key, { matchId: '', include: true })}>
                      同じじゃない
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
          <label className="check">
            <input type="checkbox" checked={recordWorn} onChange={(e) => setRecordWorn(e.target.checked)} />
            <span>このコーデを今日の着用記録として残す</span>
          </label>
          {!busy && (
            <button className="btn btn-primary btn-block" onClick={save} disabled={dets.some((d) => d.include && d.photoBusy) || (count === 0 && !(recordWorn && dets.some((d) => d.matchId)))}>
              {dets.some((d) => d.include && d.photoBusy) ? '商品写真を撮影中…' : count > 0 ? `選んだ${count}点を登録` : '着用記録だけ残す'}
            </button>
          )}
        </>
      )}

      {editing && (
        <Modal title="検出アイテムを編集" onClose={() => setEditing(null)}>
          <ItemEditor
            initial={{ ...editing.fields, gallery: editing.gallery || [], original: editing.crop }}
            image={editing.image}
            saveLabel="この内容にする"
            onCancel={() => setEditing(null)}
            onSave={({ image, original, gallery, photoVersion, ...fields }) => {
              update(editing.key, { fields, image: image || editing.image, gallery: gallery || editing.gallery, ...(photoVersion ? { aiPhoto: true } : {}), include: true, photoBusy: false });
              setEditing(null);
            }}
          />
        </Modal>
      )}
    </div>
  );
}
