import { useState } from 'react';
import { db, getKV, markWorn } from '../lib/db.js';
import { api } from '../lib/api.js';
import { forAI, base64ToBlob } from '../lib/image.js';
import { BlobImg, ErrorBox, Modal, Spinner, Thumb } from './ui.jsx';
import { IconCheck } from './icons.jsx';

export default function OutfitCard({ outfit, byId, index }) {
  const [askWhy, setAskWhy] = useState(false);
  const [why, setWhy] = useState('');
  const [tryOpen, setTryOpen] = useState(false);
  const all = [...outfit.itemIds, ...(outfit.fixedIds || [])];

  const rate = async (r) => {
    const rating = outfit.rating === r ? null : r;
    await db.outfits.update(outfit.id, { rating });
    setAskWhy(rating === 'down');
  };

  return (
    <article className="outfit">
      <header className="outfit-head">
        <span className="outfit-no">LOOK {String(index + 1).padStart(2, '0')}</span>
        <h3>{outfit.title}</h3>
      </header>
      <div className="outfit-items">
        {all.map((id) => (
          <div key={id} className="outfit-item">
            <Thumb item={byId[id]} size="sm" badge={outfit.fixedIds?.includes(id) ? '固定' : null} />
            <span>{byId[id]?.name || '削除済み'}</span>
          </div>
        ))}
      </div>
      <p className="outfit-reason">{outfit.reason}</p>
      {outfit.styling_tip && <p className="outfit-tip">{outfit.styling_tip}</p>}
      {outfit.tryon && (
        <button className="tryon-preview" onClick={() => setTryOpen(true)}>
          <BlobImg blob={outfit.tryon} alt="着用イメージ" />
        </button>
      )}
      <div className="outfit-actions">
        <button className={`btn btn-small ${outfit.rating === 'up' ? 'is-on' : ''}`} onClick={() => rate('up')}>好き</button>
        <button className={`btn btn-small ${outfit.rating === 'down' ? 'is-on' : ''}`} onClick={() => rate('down')}>微妙</button>
        <button className="btn btn-small" onClick={() => setTryOpen(true)}>試着</button>
        <button
          className={`btn btn-small ${outfit.worn ? 'is-on' : 'btn-primary'}`}
          disabled={outfit.worn}
          onClick={async () => {
            await markWorn(all);
            await db.outfits.update(outfit.id, { worn: true, wornAt: Date.now() });
          }}
        >
          {outfit.worn ? <><IconCheck /> 着た</> : 'これ着る'}
        </button>
      </div>
      {askWhy && (
        <form
          className="why"
          onSubmit={async (e) => {
            e.preventDefault();
            await db.outfits.update(outfit.id, { feedbackNote: why.trim() });
            setAskWhy(false);
          }}
        >
          <input value={why} onChange={(e) => setWhy(e.target.value)} placeholder="どこが微妙？（次回の提案に反映）" />
          <button className="btn btn-small">送信</button>
        </form>
      )}
      {tryOpen && <TryOn outfit={outfit} byId={byId} ids={all} onClose={() => setTryOpen(false)} />}
    </article>
  );
}

function TryOn({ outfit, byId, ids, onClose }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [styling, setStyling] = useState(outfit.styling_tip || '');

  const gen = async () => {
    setBusy(true);
    setError(null);
    try {
      const person = await getKV('personPhoto');
      if (!person) throw new Error('本人の全身写真が未登録です。設定タブで登録してください');
      const items = [];
      for (const id of ids) {
        const it = byId[id];
        if (!it) continue;
        items.push({ ...(await forAI(it.image, 768)), name: it.name });
      }
      const { image } = await api('tryon', { person: await forAI(person, 1024), items, styling });
      await db.outfits.update(outfit.id, { tryon: base64ToBlob(image) });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="着用イメージ" onClose={onClose}>
      {outfit.tryon && <BlobImg blob={outfit.tryon} alt="着用イメージ" className="tryon-full" />}
      <p className="muted small">AI生成のイメージです。細部は実物と異なる場合があります。</p>
      <label className="field">
        <span>着こなし（着崩しの指示）</span>
        <input value={styling} onChange={(e) => setStyling(e.target.value)} placeholder="例: 袖をまくって、シャツは前だけタックイン" />
      </label>
      {busy ? <Spinner label="生成中…（10〜30秒）" /> : (
        <button className="btn btn-primary" onClick={gen}>{outfit.tryon ? 'この指示で作り直す' : '着用イメージを生成'}</button>
      )}
      <ErrorBox error={error} />
    </Modal>
  );
}
