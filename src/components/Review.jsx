import { useCallback, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getProfile, compactItem } from '../lib/db.js';
import { api } from '../lib/api.js';
import { forAI } from '../lib/image.js';
import { PERSONAS } from '../lib/personas.js';
import { ErrorBox, FilePick, Spinner, Thumb, useBlobUrl, usePaste } from './ui.jsx';

export default function Review() {
  const items = useLiveQuery(() => db.items.toArray(), []) || [];
  const byId = useMemo(() => Object.fromEntries(items.map((i) => [i.id, i])), [items]);
  const [file, setFile] = useState(null);
  const url = useBlobUrl(file);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [res, setRes] = useState(null);
  const [persona, setPersona] = useState(null);

  const pick = useCallback((f) => { setFile(f); setRes(null); setError(null); }, []);
  usePaste(pick);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const profile = await getProfile();
      setPersona(PERSONAS[profile.persona]?.label);
      const r = await api('review', {
        image: await forAI(file, 1280),
        question: q,
        closet: items.filter((i) => !i.isFixed).map(compactItem),
        profile: { personaPrompt: PERSONAS[profile.persona]?.prompt, styleNotes: profile.styleNotes },
      });
      setRes(r);
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
          <h2 className="title">コーデ相談</h2>
          <p className="muted">今日のコーデを見せて相談</p>
        </div>
      </div>
      <div className="panel">
        <div className="row">
          <FilePick label="鏡の前で撮る" capture="user" onFiles={(f) => pick(f[0])} className="btn" />
          <FilePick label="写真を選ぶ" onFiles={(f) => pick(f[0])} className="btn" />
        </div>
        {url && <img src={url} alt="コーデ写真" className="shop-img" />}
        <label className="field">
          <span>相談したいこと（任意）</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="例: 靴これで合ってる？ / もう少し大人っぽくしたい" />
        </label>
        {file && !busy && <button className="btn btn-primary btn-block" onClick={run}>相談する</button>}
        {busy && <Spinner label="スタイリストが見ています…" />}
        <ErrorBox error={error} />
      </div>
      {res && (
        <div className="panel review">
          {persona && <span className="persona-tag">{persona}</span>}
          <p className="review-comment">{res.comment}</p>
          {res.good_points?.length > 0 && (
            <>
              <h4>いいところ</h4>
              <ul>{res.good_points.map((g, i) => <li key={i}>{g}</li>)}</ul>
            </>
          )}
          {res.improvements?.length > 0 && (
            <>
              <h4>こうするともっと良い</h4>
              {res.improvements.map((m, i) => (
                <div key={i} className="similar">
                  {byId[m.swapInId] && <Thumb item={byId[m.swapInId]} size="sm" />}
                  <p>{m.suggestion}{byId[m.swapInId] && <strong>（手持ち: {byId[m.swapInId].name}）</strong>}</p>
                </div>
              ))}
            </>
          )}
          {res.styling_tip && <p className="outfit-tip">{res.styling_tip}</p>}
        </div>
      )}
    </section>
  );
}
