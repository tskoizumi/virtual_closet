import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getProfile, newId, compactItem } from '../lib/db.js';
import { getWeather } from '../lib/weather.js';
import { buildCandidates, validateOutfit, historyLines, OCCASIONS, CATEGORY_LABEL } from '../lib/rules.js';
import { forAI } from '../lib/image.js';
import { api } from '../lib/api.js';
import { PERSONAS } from '../lib/personas.js';
import { Chips, ErrorBox, Modal, Spinner, Thumb } from './ui.jsx';
import OutfitCard from './OutfitCard.jsx';

export default function Today({ goCloset }) {
  const items = useLiveQuery(() => db.items.toArray(), []);
  const byId = useMemo(() => Object.fromEntries((items || []).map((i) => [i.id, i])), [items]);
  const [weather, setWeather] = useState(null);
  const [wErr, setWErr] = useState(null);
  const [manualTemp, setManualTemp] = useState({ max: 20, min: 12 });
  const [occasion, setOccasion] = useState('学校');
  const [extra, setExtra] = useState('');
  const [must, setMust] = useState([]);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState(null);
  const [notes, setNotes] = useState([]);
  const [resultIds, setResultIds] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem('vc_today') || '[]'); } catch { return []; }
  });
  const results = useLiveQuery(
    async () => (resultIds.length ? (await db.outfits.bulkGet(resultIds)).filter(Boolean) : []),
    [resultIds]
  );
  const recent = useLiveQuery(() => db.outfits.orderBy('createdAt').reverse().limit(30).toArray(), []) || [];

  const loadWeather = async () => {
    setWErr(null);
    try {
      const p = await getProfile();
      setWeather(await getWeather(p.city));
    } catch (e) {
      setWErr(e);
    }
  };
  useEffect(() => { loadWeather(); }, []);

  if (!items) return <Spinner />;

  const counts = {};
  items.forEach((i) => !i.isFixed && (counts[i.category] = (counts[i.category] || 0) + 1));
  const lacking = ['tops', 'bottoms', 'shoes'].filter((c) => !counts[c]);

  const generate = async () => {
    setError(null);
    setNotes([]);
    try {
      const w = weather || { tempMax: Number(manualTemp.max), tempMin: Number(manualTemp.min), weatherText: '手入力', precipProb: null };
      const profile = await getProfile();
      const { candidates, missing, notes: n } = buildCandidates(items, { weather: w, occasion, mustInclude: must, recentDays: profile.recentDays });
      if (missing.length) throw new Error(`今日の条件に合う${missing.map((c) => CATEGORY_LABEL[c]).join('・')}がありません。登録を増やすか条件を変えてください`);
      const nts = [...n];

      setBusy('アイテム画像を準備中…');
      const images = [];
      for (const c of candidates.slice(0, 40)) images.push({ id: c.id, ...(await forAI(c.image, 256)) });

      const fixed = items.filter((i) => i.isFixed);
      const history = historyLines(recent, byId);
      const payload = {
        candidates: candidates.map((c) => ({ ...compactItem(c), recent: c.recent, wearCount: c.wearCount || 0 })),
        images,
        context: {
          date: new Date().toLocaleDateString('ja-JP', { month: 'long', day: 'numeric', weekday: 'short' }),
          tempMax: w.tempMax, tempMin: w.tempMin, precipProb: w.precipProb, weatherText: w.weatherText,
          occasion, extra, mustInclude: must,
        },
        profile: { personaPrompt: PERSONAS[profile.persona]?.prompt, styleNotes: profile.styleNotes },
        history,
        fixed: fixed.map((f) => f.name),
      };
      const candById = Object.fromEntries(candidates.map((c) => [c.id, c]));

      const valid = [];
      const seen = new Set();
      let retryNote = '';
      for (let attempt = 0; attempt < 3 && valid.length < 3; attempt++) {
        setBusy(attempt === 0 ? 'スタイリストが考え中…' : `条件を満たさない案があったので再提案中…（${attempt + 1}回目）`);
        const res = await api('outfits', { ...payload, retryNote });
        const problems = [];
        for (const o of res.outfits || []) {
          const v = validateOutfit(o.itemIds || [], candById, { mustInclude: must });
          const key = [...v.ids].sort().join(',');
          if (v.ok && !seen.has(key)) {
            seen.add(key);
            valid.push({ ...o, itemIds: v.ids });
          } else if (!v.ok) problems.push(`「${o.title}」: ${v.problems.join('、')}`);
        }
        retryNote = problems.join('\n') + (valid.length ? `\nすでに採用した案と被らないこと: ${valid.map((v) => v.itemIds.join('+')).join(' / ')}` : '');
      }
      if (valid.length === 0) throw new Error('条件を満たすコーデを作れませんでした。登録アイテムを増やすか条件を変えてください');
      if (valid.length < 3) nts.push(`条件を満たすコーデが${valid.length}案しか作れませんでした`);

      const now = Date.now();
      const records = valid.slice(0, 3).map((o, i) => ({
        id: newId(),
        createdAt: now + i,
        title: o.title,
        itemIds: o.itemIds,
        fixedIds: fixed.map((f) => f.id),
        reason: o.reason,
        styling_tip: o.styling_tip,
        context: { ...payload.context, persona: profile.persona },
        rating: null,
        worn: false,
      }));
      await db.outfits.bulkAdd(records);
      const ids = records.map((r) => r.id);
      setResultIds(ids);
      sessionStorage.setItem('vc_today', JSON.stringify(ids));
      setNotes(nts);
    } catch (e) {
      setError(e);
    } finally {
      setBusy('');
    }
  };

  const history = recent.filter((o) => !resultIds.includes(o.id) && (o.worn || o.rating));

  return (
    <section>
      <div className="page-head">
        <div>
          <h2 className="title">今日のコーデ</h2>
          <p className="muted">{new Date().toLocaleDateString('ja-JP', { month: 'long', day: 'numeric', weekday: 'long' })}</p>
        </div>
      </div>

      <div className="weather">
        {weather ? (
          <>
            <div className="weather-temp">{weather.current}°</div>
            <div>
              <div>{weather.place} ・ {weather.weatherText}</div>
              <div className="muted small">最高 {weather.tempMax}° / 最低 {weather.tempMin}° ・ 降水 {weather.precipProb ?? '–'}%</div>
            </div>
          </>
        ) : wErr ? (
          <div className="weather-manual">
            <span className="muted small">天気を取得できませんでした（{wErr.message}）。気温を手入力：</span>
            <div className="row">
              <label>最高 <input type="number" value={manualTemp.max} onChange={(e) => setManualTemp({ ...manualTemp, max: e.target.value })} />°</label>
              <label>最低 <input type="number" value={manualTemp.min} onChange={(e) => setManualTemp({ ...manualTemp, min: e.target.value })} />°</label>
              <button className="btn btn-small" onClick={loadWeather}>再取得</button>
            </div>
          </div>
        ) : (
          <Spinner label="天気を取得中…" />
        )}
      </div>

      {lacking.length > 0 ? (
        <div className="empty">
          <p>コーデ提案には {lacking.map((c) => CATEGORY_LABEL[c]).join('・')} の登録が必要です。</p>
          <button className="btn btn-primary" onClick={goCloset}>服を登録する</button>
        </div>
      ) : (
        <div className="panel">
          <div className="field">
            <span>今日の行き先</span>
            <Chips options={OCCASIONS.map((o) => o.key)} value={occasion} onChange={setOccasion} />
          </div>
          <label className="field">
            <span>補足（任意）</span>
            <input value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="例: 夜は寒くなる / 歩くことが多い / 黒で揃えたい" />
          </label>
          <div className="field">
            <span>今日着たいアイテム（任意）</span>
            <div className="row wrap">
              {must.map((id) => (
                <Thumb key={id} item={byId[id]} size="xs" onClick={() => setMust(must.filter((m) => m !== id))} badge="×" />
              ))}
              <button className="btn btn-small" onClick={() => setPicking(true)}>選ぶ</button>
            </div>
          </div>
          {busy ? <Spinner label={busy} /> : (
            <button className="btn btn-primary btn-block" onClick={generate}>コーデを3つ考えて</button>
          )}
          <ErrorBox error={error} />
        </div>
      )}

      {notes.map((n) => <p key={n} className="note">{n}</p>)}

      {results && results.length > 0 && (
        <div className="outfits">
          {results.map((o, i) => <OutfitCard key={o.id} outfit={o} byId={byId} index={i} />)}
        </div>
      )}

      {history.length > 0 && (
        <details className="history">
          <summary>これまでのコーデ（{history.length}）</summary>
          {history.map((o) => (
            <div key={o.id} className="history-row">
              <span className="muted small">{new Date(o.createdAt).toLocaleDateString('ja-JP')}</span>
              <div className="row">
                {o.itemIds.map((id) => <Thumb key={id} item={byId[id]} size="xs" />)}
              </div>
              <span>{[o.rating === 'up' ? '好き' : o.rating === 'down' ? '微妙' : '', o.worn ? '着た' : ''].filter(Boolean).join('・')}</span>
            </div>
          ))}
        </details>
      )}

      {picking && (
        <Modal title="今日着たいアイテム" onClose={() => setPicking(false)} wide>
          <div className="grid">
            {items.filter((i) => !i.isFixed).map((it) => (
              <div key={it.id} className="grid-cell">
                <Thumb
                  item={it}
                  selected={must.includes(it.id)}
                  onClick={() => setMust(must.includes(it.id) ? must.filter((m) => m !== it.id) : [...must, it.id])}
                />
                <div className="cell-name">{it.name}</div>
              </div>
            ))}
          </div>
          <button className="btn btn-primary btn-block" onClick={() => setPicking(false)}>決定</button>
        </Modal>
      )}
    </section>
  );
}
