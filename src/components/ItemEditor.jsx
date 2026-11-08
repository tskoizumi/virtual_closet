import { useState } from 'react';
import { CATEGORY_LABEL } from '../lib/rules.js';
import { getProfile } from '../lib/db.js';
import { api } from '../lib/api.js';
import { forAI, prepareItemImage } from '../lib/image.js';
import { makeProductPhoto } from '../lib/productPhoto.js';
import { BlobImg, ErrorBox, FilePick, Spinner } from './ui.jsx';

const SEASON_LABEL = { spring: '春', summer: '夏', autumn: '秋', winter: '冬' };
const FORMALITY = ['', '部屋着', 'ラフ', 'カジュアル', 'きれいめ', 'フォーマル'];
const WARMTH = ['', '真夏', '夏', '春秋', '秋冬', '真冬'];
const FIELDS = ['name', 'brand', 'category', 'subcategory', 'colors', 'material', 'pattern', 'formality', 'warmth', 'seasons', 'notes'];

// アイテムの編集フォーム。写真の差し替え・AI再解析・商品写真化もここでできる
export default function ItemEditor({ initial, image, onSave, onCancel, saveLabel = '保存', extra }) {
  const [f, setF] = useState(() => ({
    name: '', brand: '', category: 'tops', subcategory: '', colors: [], material: '', pattern: '',
    formality: 3, warmth: 3, seasons: [], notes: '', isFixed: false, ...initial,
  }));
  const [img, setImg] = useState(image || null);
  const [prevImg, setPrevImg] = useState(null);
  const [original, setOriginal] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState(null);
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));

  const task = async (label, fn) => {
    setBusy(label);
    setError(null);
    try { await fn(); } catch (e) { setError(e); } finally { setBusy(''); }
  };

  const replace = (files) =>
    task('写真を処理中…', async () => {
      const p = await getProfile();
      let r;
      try {
        r = await prepareItemImage(files[0], { useCutout: p.photoMode === 'cutout' });
      } catch {
        r = await prepareItemImage(files[0], { useCutout: false });
      }
      let image = r.image;
      if (p.photoMode === 'ai') {
        try {
          image = await makeProductPhoto(r.original, { name: f.name, category: f.category, brand: f.brand, onStage: setBusy });
        } catch (e) {
          setError(new Error(`商品写真化に失敗したので元の写真にしました（${e.message}）`));
        }
      }
      setPrevImg(img);
      setImg(image);
      setOriginal(r.original);
    });

  const reanalyze = () =>
    task('AIが再解析中…', async () => {
      const { item } = await api('tag', { image: await forAI(img) });
      setF((p) => {
        const n = { ...p };
        FIELDS.forEach((k) => item[k] !== undefined && (n[k] = item[k]));
        return n;
      });
    });

  const productize = () =>
    task('AIが商品写真を撮影中…（10〜30秒）', async () => {
      const src = original || initial?.original || img;
      const out = await makeProductPhoto(src, { name: f.name, category: f.category, brand: f.brand, onStage: setBusy });
      setPrevImg(img);
      setImg(out);
    });

  return (
    <form
      className="editor"
      onSubmit={(e) => {
        e.preventDefault();
        if (!f.name.trim()) return alert('名前を入力してください');
        if (busy) return;
        onSave({ ...f, formality: Number(f.formality), warmth: Number(f.warmth), image: img, ...(original ? { original } : {}) });
      }}
    >
      {img && (
        <div className="editor-img">
          <BlobImg blob={img} alt={f.name} />
        </div>
      )}
      <div className="row wrap editor-tools">
        <FilePick label={img ? '写真を差し替え' : '写真を追加'} onFiles={replace} className="btn btn-small" />
        {img && <button type="button" className="btn btn-small" onClick={reanalyze} disabled={!!busy}>AIで再解析</button>}
        {img && <button type="button" className="btn btn-small" onClick={productize} disabled={!!busy}>✨ AIで撮り直す</button>}
        {prevImg && <button type="button" className="btn btn-small btn-ghost" onClick={() => { setImg(prevImg); setPrevImg(null); setOriginal(null); }}>写真を元に戻す</button>}
      </div>
      {busy && <Spinner label={busy} />}
      <ErrorBox error={error} />

      <label className="field">
        <span>名前</span>
        <input value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="例: 白のオックスフォードシャツ" />
      </label>
      <label className="field">
        <span>ブランド</span>
        <input value={f.brand || ''} onChange={(e) => set('brand', e.target.value)} placeholder="例: Ralph Lauren（分からなければ空欄）" list="brand-list" />
      </label>
      <div className="field-row">
        <label className="field">
          <span>カテゴリ</span>
          <select value={f.category} onChange={(e) => set('category', e.target.value)}>
            {Object.entries(CATEGORY_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>種類</span>
          <input value={f.subcategory} onChange={(e) => set('subcategory', e.target.value)} />
        </label>
      </div>
      <div className="field-row">
        <label className="field">
          <span>色（カンマ区切り）</span>
          <input
            defaultValue={(f.colors || []).join(', ')}
            key={(f.colors || []).join('|')}
            onBlur={(e) => set('colors', e.target.value.split(/[,、]/).map((s) => s.trim()).filter(Boolean))}
          />
        </label>
        <label className="field">
          <span>素材</span>
          <input value={f.material} onChange={(e) => set('material', e.target.value)} />
        </label>
      </div>
      <label className="field">
        <span>柄</span>
        <input value={f.pattern} onChange={(e) => set('pattern', e.target.value)} />
      </label>
      <label className="field">
        <span>きれいめ度: {FORMALITY[f.formality]}</span>
        <input type="range" min="1" max="5" value={f.formality} onChange={(e) => set('formality', Number(e.target.value))} />
      </label>
      <label className="field">
        <span>暖かさ: {WARMTH[f.warmth]}向け</span>
        <input type="range" min="1" max="5" value={f.warmth} onChange={(e) => set('warmth', Number(e.target.value))} />
      </label>
      <div className="field">
        <span>季節</span>
        <div className="chips">
          {Object.entries(SEASON_LABEL).map(([k, v]) => (
            <button
              type="button"
              key={k}
              className={`chip ${f.seasons?.includes(k) ? 'is-active' : ''}`}
              onClick={() => set('seasons', f.seasons?.includes(k) ? f.seasons.filter((s) => s !== k) : [...(f.seasons || []), k])}
            >
              {v}
            </button>
          ))}
        </div>
      </div>
      <label className="field">
        <span>メモ</span>
        <input value={f.notes} onChange={(e) => set('notes', e.target.value)} />
      </label>
      <label className="check">
        <input type="checkbox" checked={!!f.isFixed} onChange={(e) => set('isFixed', e.target.checked)} />
        <span>毎日つける固定アイテム（ピアス・ブレスなど）</span>
      </label>
      <div className="editor-actions">
        {onCancel && <button type="button" className="btn btn-ghost" onClick={onCancel}>キャンセル</button>}
        {extra}
        <button type="submit" className="btn btn-primary" disabled={!!busy}>{saveLabel}</button>
      </div>
    </form>
  );
}
