import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getProfile, setKV, getKV } from '../lib/db.js';
import { api, getPasscode, setPasscode } from '../lib/api.js';
import { resize, blobToDataURL, dataURLToBlob } from '../lib/image.js';
import { PERSONAS } from '../lib/personas.js';
import SyncPanel from './SyncPanel.jsx';
import { BlobImg, ErrorBox, FilePick, Spinner } from './ui.jsx';

// バックアップ用: 入れ子のどこにあるBlobも data URL に（読み込み時は逆に）変換する
async function blobsToData(v) {
  if (v instanceof Blob) return { $dataURL: await blobToDataURL(v) };
  if (Array.isArray(v)) return Promise.all(v.map(blobsToData));
  if (v && typeof v === 'object') {
    const o = {};
    for (const [k, x] of Object.entries(v)) o[k] = await blobsToData(x);
    return o;
  }
  return v;
}
async function dataToBlobs(v) {
  if (Array.isArray(v)) return Promise.all(v.map(dataToBlobs));
  if (v && typeof v === 'object') {
    if (typeof v.$dataURL === 'string') return dataURLToBlob(v.$dataURL);
    const o = {};
    for (const [k, x] of Object.entries(v)) o[k] = await dataToBlobs(x);
    return o;
  }
  // 旧形式のバックアップ（image/original が data URL 文字列）
  return v;
}

export default function Settings() {
  const [p, setP] = useState(null);
  const [pass, setPass] = useState(getPasscode());
  const [health, setHealth] = useState(null);
  const [hErr, setHErr] = useState(null);
  const [busy, setBusy] = useState('');
  const person = useLiveQuery(() => getKV('personPhoto'), []);
  const counts = useLiveQuery(async () => ({ items: await db.items.count(), outfits: await db.outfits.count() }), []);

  useEffect(() => { getProfile().then(setP); }, []);
  const check = async () => {
    setHErr(null);
    try { setHealth(await api('health')); } catch (e) { setHErr(e); }
  };
  useEffect(() => { check(); }, []);

  if (!p) return <Spinner />;
  const update = async (k, v) => {
    const np = { ...p, [k]: v };
    setP(np);
    await setKV('profile', np);
  };

  const exportData = async () => {
    setBusy('書き出し中…');
    try {
      const items = [];
      for (const it of await db.items.toArray()) {
        const { _dirty, ...row } = it;
        items.push(await blobsToData(row));
      }
      const outfits = [];
      for (const o of await db.outfits.toArray()) {
        const { _dirty, ...row } = o;
        outfits.push({ ...row, tryon: o.tryon ? await blobToDataURL(o.tryon) : null });
      }
      const personPhoto = person ? await blobToDataURL(person) : null;
      const blob = new Blob([JSON.stringify({ app: 'virtual_closet', version: 2, items, outfits, profile: p, personPhoto })], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `closet-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    } finally {
      setBusy('');
    }
  };

  const importData = async (file) => {
    if (!confirm('バックアップを読み込みます。同じIDのデータは上書きされます。よろしいですか？')) return;
    setBusy('読み込み中…');
    try {
      const j = JSON.parse(await file.text());
      if (j.app !== 'virtual_closet') throw new Error('このアプリのバックアップファイルではありません');
      for (const it of j.items || []) {
        const row = await dataToBlobs(it);
        // 旧形式（version 1）は image / original / gallery[].image が data URL の文字列
        const fix = async (x) => (typeof x === 'string' && x.startsWith('data:') ? dataURLToBlob(x) : x);
        row.image = await fix(row.image);
        row.original = await fix(row.original);
        if (Array.isArray(row.gallery)) row.gallery = await Promise.all(row.gallery.map(async (g) => ({ ...g, image: await fix(g.image), original: await fix(g.original) })));
        await db.items.put(row);
      }
      for (const o of j.outfits || []) {
        await db.outfits.put({ ...o, tryon: o.tryon ? await dataURLToBlob(o.tryon) : null });
      }
      if (j.profile) { await setKV('profile', j.profile); setP({ ...p, ...j.profile }); }
      if (j.personPhoto) await setKV('personPhoto', await dataURLToBlob(j.personPhoto));
      alert(`読み込み完了: アイテム${j.items?.length || 0}点`);
    } catch (e) {
      alert('読み込みに失敗しました: ' + e.message);
    } finally {
      setBusy('');
    }
  };

  return (
    <section>
      <div className="page-head">
        <div>
          <h2 className="title">設定</h2>
          <p className="muted">データは端末のブラウザ内に保存されます（クラウド同期をONにすると他の端末とも共有）</p>
        </div>
      </div>

      <div className="panel">
        <h4>スタイリストの性格</h4>
        <div className="personas">
          {Object.entries(PERSONAS).map(([k, v]) => (
            <button key={k} className={`persona ${p.persona === k ? 'is-active' : ''}`} onClick={() => update('persona', k)}>
              <strong>{v.label}</strong>
              <span>{v.desc}</span>
            </button>
          ))}
        </div>
        <label className="field">
          <span>好み・NG（提案に毎回反映）</span>
          <textarea rows="3" value={p.styleNotes} onChange={(e) => update('styleNotes', e.target.value)} placeholder="例: オールドマネー系は避けたい / 黒スキニーは履かない / 上下で色を揃えすぎない" />
        </label>
      </div>

      <div className="panel">
        <h4>試着用の全身写真</h4>
        <p className="muted small">正面・全身が写った明るい写真1枚。着用イメージの生成に使います（生成時のみAIに送信）。</p>
        {person && <BlobImg blob={person} alt="本人" className="person-img" />}
        <div className="row">
          <FilePick label={person ? '写真を変更' : '写真を登録'} onFiles={async (f) => setKV('personPhoto', await resize(f[0], 1400, { type: 'image/jpeg', quality: 0.9 }))} />
          {person && <button className="btn btn-ghost" onClick={() => db.kv.delete('personPhoto')}>削除</button>}
        </div>
      </div>

      <div className="panel">
        <h4>基本設定</h4>
        <label className="field">
          <span>位置情報が使えない時の地名（天気用）</span>
          <input value={p.city} onChange={(e) => update('city', e.target.value)} />
        </label>
        <label className="field">
          <span>「最近着た」とみなす日数: {p.recentDays}日</span>
          <input type="range" min="1" max="14" value={p.recentDays} onChange={(e) => update('recentDays', Number(e.target.value))} />
        </label>
        <div className="field">
          <span>登録時の写真の扱い</span>
          {[
            ['ai', 'AIで公式ブティック風に撮り直す（おすすめ）', 'ハンガー・床置き・シワがあってもOK。服はモデル着用のクロップ、靴やバッグはスタジオ撮影に。背面に特徴があれば2枚目も作ります。1枚ごとに画像生成APIを使います'],
            ['cutout', '背景だけ切り抜く', 'APIを使わずブラウザ内で処理。ハンガーなどは残ることがあります'],
            ['none', 'そのまま', '撮った写真をそのまま使う'],
          ].map(([v, l, d]) => (
            <label key={v} className="check">
              <input type="radio" name="photoMode" checked={p.photoMode === v} onChange={() => update('photoMode', v)} />
              <span>{l}<br /><span className="muted small">{d}</span></span>
            </label>
          ))}
        </div>
        {p.photoMode === 'ai' && (
          <div className="field">
            <span>商品写真のモデル</span>
            <div className="chips">
              {[['auto', '服に合わせて自動'], ['mens', 'メンズ'], ['womens', 'レディース']].map(([v, l]) => (
                <button key={v} type="button" className={`chip ${(p.modelGender || 'auto') === v ? 'is-active' : ''}`} onClick={() => update('modelGender', v)}>{l}</button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="panel">
        <h4>サーバー接続</h4>
        <label className="field">
          <span>合言葉（サーバーで APP_PASSCODE を設定した場合）</span>
          <input value={pass} onChange={(e) => { setPass(e.target.value); setPasscode(e.target.value); }} type="password" />
        </label>
        <button className="btn btn-small" onClick={check}>接続を確認</button>
        {health && (
          <p className="muted small">
            {health.hasKey ? 'Gemini APIキー設定済み' : 'GEMINI_API_KEY が未設定'} ・ モデル: {health.textModels.join(' → ')} / 画像: {health.imageModels.join(' → ')}
            {health.passcodeRequired && ' ・ 合言葉が必要'}
            {health.hasDB ? ' ・ 同期用DB接続済み' : ' ・ 同期用DB(D1)は未設定'}
          </p>
        )}
        <ErrorBox error={hErr} />
      </div>

      <SyncPanel />

      <div className="panel">
        <h4>データ</h4>
        <p className="muted small">アイテム {counts?.items ?? '–'}点 ・ コーデ履歴 {counts?.outfits ?? '–'}件</p>
        {busy ? <Spinner label={busy} /> : (
          <div className="row wrap">
            <button className="btn" onClick={exportData}>バックアップを書き出す</button>
            <label className="btn">
              バックアップを読み込む
              <input type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) importData(f); }} />
            </label>
            <button
              className="btn btn-danger"
              onClick={async () => {
                if (confirm('すべてのアイテムと履歴を削除します（クラウド同期中なら他の端末からも消えます）。元に戻せません。よろしいですか？')) {
                  // clear() は削除の記録が残らず同期されないため、キーを指定して消す
                  await db.items.bulkDelete(await db.items.toCollection().primaryKeys());
                  await db.outfits.bulkDelete(await db.outfits.toCollection().primaryKeys());
                }
              }}
            >
              全データを削除
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
