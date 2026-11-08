import { useCallback, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getProfile, compactItem } from '../lib/db.js';
import { api } from '../lib/api.js';
import { forAI } from '../lib/image.js';
import { validateOutfit, CATEGORY_LABEL } from '../lib/rules.js';
import { PERSONAS } from '../lib/personas.js';
import { ErrorBox, FilePick, Spinner, Thumb, useBlobUrl, usePaste } from './ui.jsx';

export default function Shop({ onBought }) {
  const items = useLiveQuery(() => db.items.toArray(), []) || [];
  const byId = useMemo(() => Object.fromEntries(items.map((i) => [i.id, i])), [items]);
  const [file, setFile] = useState(null);
  const url = useBlobUrl(file);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [res, setRes] = useState(null);

  const pick = useCallback((f) => { setFile(f); setRes(null); setError(null); }, []);
  usePaste(pick);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const profile = await getProfile();
      const closet = items.filter((i) => !i.isFixed).map(compactItem);
      const r = await api('shop', {
        image: await forAI(file, 1280),
        closet,
        profile: { personaPrompt: PERSONAS[profile.persona]?.prompt, styleNotes: profile.styleNotes },
      });
      const seen = new Set();
      const outfits = [];
      for (const o of r.outfits || []) {
        const v = validateOutfit(o.itemIds || [], byId, { extraCategories: [r.product.category] });
        const key = [...v.ids].sort().join(',');
        if (v.ok && !seen.has(key)) {
          seen.add(key);
          outfits.push({ ...o, itemIds: v.ids });
        }
      }
      const similar = (r.similar || []).filter((s) => byId[s.id]);
      setRes({ ...r, outfits, similar, rejected: (r.outfits || []).length - outfits.length });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <div className="page-head">
        <div>
          <h2 className="title">Shopping</h2>
          <p className="muted">買う前に、手持ちとの相性をチェック</p>
        </div>
      </div>

      <div className="panel">
        <p className="muted small">ECサイトの商品ページのスクショか、店頭で撮った写真を選んでください（PCなら貼り付けもOK）。</p>
        <div className="row">
          <FilePick label="🖼 スクショを選ぶ" onFiles={(f) => pick(f[0])} className="btn" />
          <FilePick label="📷 店頭で撮る" capture="environment" onFiles={(f) => pick(f[0])} className="btn" />
        </div>
        {url && <img src={url} alt="候補の商品" className="shop-img" />}
        {file && !busy && (
          <button className="btn btn-primary btn-block" onClick={run} disabled={items.length === 0}>
            {items.length === 0 ? 'まずクローゼットに服を登録してください' : '手持ちと照合する'}
          </button>
        )}
        {busy && <Spinner label="手持ちと照合中…" />}
        <ErrorBox error={error} />
      </div>

      {res && (
        <div className="shop-result">
          <div className={`verdict verdict-${res.verdict}`}>
            <span className="verdict-label">{res.verdict}</span>
            <div>
              <div className="verdict-name">{res.product.name}</div>
              <div className="muted small">{CATEGORY_LABEL[res.product.category]} ・ {res.product.colors?.join('/')} ・ {res.product.material}</div>
            </div>
          </div>
          <p>{res.summary}</p>

          <div className="stat">
            <span className="stat-num">{res.outfits.length}</span>
            <span>手持ちと組めるコーデ</span>
          </div>
          {res.rejected > 0 && <p className="muted small">※ AIの案のうち{res.rejected}件は構成が不完全なため除外しました</p>}

          {res.similar.length > 0 && (
            <>
              <h4>似たアイテムを持っています</h4>
              {res.similar.map((s) => (
                <div key={s.id} className="similar">
                  <Thumb item={byId[s.id]} size="sm" />
                  <div>
                    <strong>{byId[s.id].name}</strong>
                    <p className="muted small">{s.reason}</p>
                  </div>
                </div>
              ))}
            </>
          )}

          {res.outfits.length > 0 && (
            <>
              <h4>組めるコーデ</h4>
              {res.outfits.map((o, i) => (
                <div key={i} className="shop-outfit">
                  <div className="row wrap">
                    <div className="thumb thumb-xs thumb-new"><img src={url} alt="" /><span className="thumb-badge">NEW</span></div>
                    {o.itemIds.map((id) => <Thumb key={id} item={byId[id]} size="xs" />)}
                  </div>
                  <p className="muted small">{o.reason}</p>
                </div>
              ))}
            </>
          )}

          <button className="btn btn-block" onClick={() => onBought(file)}>買った！クローゼットに登録する</button>
        </div>
      )}
    </section>
  );
}
