import { useState } from 'react';
import { CATEGORY_LABEL } from '../lib/rules.js';
import { getProfile } from '../lib/db.js';
import { api } from '../lib/api.js';
import { forAI, prepareItemImage } from '../lib/image.js';
import { makeProductPhoto, makeProductSet, PHOTO_VERSION, ROLE_LABEL } from '../lib/productPhoto.js';
import { resize } from '../lib/image.js';
import { BlobImg, ErrorBox, FilePick, Spinner } from './ui.jsx';

const SEASON_LABEL = { spring: '春', summer: '夏', autumn: '秋', winter: '冬' };
const FORMALITY = ['', '部屋着', 'ラフ', 'カジュアル', 'きれいめ', 'フォーマル'];
const WARMTH = ['', '真夏', '夏', '春秋', '秋冬', '真冬'];
const FIELDS = ['name', 'brand', 'brandConfidence', 'category', 'subcategory', 'colors', 'material', 'pattern', 'formality', 'warmth', 'seasons', 'notes', 'details', 'shownSide', 'backDetail'];

// アイテムの編集フォーム。写真の差し替え・AI再解析・商品写真化もここでできる
export default function ItemEditor({ initial, image, onSave, onCancel, saveLabel = '保存', extra }) {
  const [f, setF] = useState(() => ({
    name: '', brand: '', category: 'tops', subcategory: '', colors: [], material: '', pattern: '',
    formality: 3, warmth: 3, seasons: [], notes: '', isFixed: false, details: [], ...initial,
  }));
  const [gallery, setGallery] = useState(() => initial?.gallery || []);
  const [photos, setPhotos] = useState(() => initial?.photos || []);
  const [img, setImg] = useState(image || null);
  const [prevImg, setPrevImg] = useState(null);
  const [aiPhoto, setAiPhoto] = useState(false);
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
          image = await makeProductPhoto(r.original, { ...f, onStage: setBusy });
          setAiPhoto(true);
        } catch (e) {
          setError(new Error(`商品写真化に失敗したので元の写真にしました（${e.message}）`));
        }
      }
      setPrevImg(img);
      setImg(image);
      setOriginal(r.original);
    });

  const extrasForAI = async () => {
    const ex = [];
    for (const x of photos.slice(0, 6)) ex.push({ image: await forAI(x.image, x.role === 'tag' ? 1024 : 768), role: x.role, note: x.note });
    return ex;
  };

  const reanalyze = () =>
    task('AIが再解析中…', async () => {
      const { item } = await api('tag', { image: await forAI(original || initial?.original || img), extras: await extrasForAI() });
      setF((p) => {
        const n = { ...p };
        FIELDS.forEach((k) => item[k] !== undefined && (n[k] = item[k]));
        return n;
      });
    });

  const productize = () =>
    task('AIが商品写真を撮影中…（10〜30秒）', async () => {
      const src = original || initial?.original || img;
      const set = await makeProductSet(src, f, { extras: photos, onStage: setBusy });
      setPrevImg(img);
      setImg(set.image);
      // 以前の版で自分で追加した写真（originalつき）は残し、それ以外は作り直した写真に入れ替える
      setGallery((g) => [...set.gallery, ...g.filter((x) => x.original)]);
      setAiPhoto(true);
      if (!original && initial?.original == null) setOriginal(src);
    });

  // 写真を追加（背面・裏地やボタンのアップ・タグ・着こなし見本など）。AIが役割を判定して、必要なら公式ブティック風に撮り直す
  const addPhotos = (files) =>
    task('写真を確認中…', async () => {
      const p = await getProfile();
      const srcs = [];
      for (const file of files) srcs.push(await resize(file, 1600, { type: 'image/jpeg', quality: 0.88 }));
      const main = original || initial?.original || img;
      let roles;
      try {
        const images = [await forAI(main, 512)];
        for (const b of srcs) images.push(await forAI(b, 512));
        roles = (await api('group', { images, anchor: true })).photos;
      } catch (e) {
        setError(new Error(`写真の種類を判定できなかったので「ディテール」として追加しました（${e.message}）`));
        roles = srcs.map((_, i) => ({ index: i + 1, role: 'detail', label: '追加写真', note: '' }));
      }
      const added = roles.map((r) => ({ image: srcs[r.index - 1], role: r.role, label: r.label || ROLE_LABEL[r.role], note: r.note || '' }));
      setPhotos((x) => [...x, ...added]);
      const styling = added.filter((x) => x.role === 'styling' && x.note).map((x) => x.note);
      if (styling.length) setF((x) => ({ ...x, stylingNotes: [x.stylingNotes, ...styling].filter(Boolean).join(' / ') }));
      for (const x of added) {
        if (!['back', 'detail', 'worn'].includes(x.role)) continue;
        let image = await resize(x.image, 1400, { type: 'image/jpeg', quality: 0.9 });
        if (p.photoMode === 'ai') {
          try {
            image = await makeProductPhoto(x.image, { ...f, view: x.role === 'detail' ? 'detail' : x.role, focus: x.note || x.label, refs: [{ image: main, label: '全体' }], onStage: setBusy });
          } catch (e) {
            setError(new Error(`商品写真化に失敗したので元の写真にしました（${e.message}）`));
          }
        }
        setGallery((g) => [...g, { label: x.label, image }]);
      }
    });

  return (
    <form
      className="editor"
      onSubmit={(e) => {
        e.preventDefault();
        if (!f.name.trim()) return alert('名前を入力してください');
        if (busy) return;
        onSave({ ...f, formality: Number(f.formality), warmth: Number(f.warmth), image: img, gallery, photos, ...(original ? { original } : {}), ...(aiPhoto ? { photoVersion: PHOTO_VERSION } : {}) });
      }}
    >
      {img && (
        <div className="editor-img">
          <BlobImg blob={img} alt={f.name} />
        </div>
      )}
      {gallery.length > 0 && (
        <div className="editor-gallery">
          {gallery.map((g, i) => (
            <div key={i} className="editor-shot">
              <BlobImg blob={g.image} alt={g.label} />
              <span className="small">{g.label}</span>
              <button type="button" className="btn btn-small btn-ghost" onClick={() => setGallery((x) => x.filter((_, j) => j !== i))}>削除</button>
            </div>
          ))}
        </div>
      )}
      <div className="row wrap editor-tools">
        <FilePick label={img ? '写真を差し替え' : '写真を追加'} onFiles={replace} className="btn btn-small" />
        {img && <button type="button" className="btn btn-small" onClick={reanalyze} disabled={!!busy}>AIで再解析</button>}
        {img && <button type="button" className="btn btn-small" onClick={productize} disabled={!!busy}>✨ AIで撮り直す</button>}
        {img && <FilePick label="＋ 写真を追加（背面・裏地・ボタン・タグ・着こなし）" multiple onFiles={addPhotos} className="btn btn-small" />}
        {prevImg && <button type="button" className="btn btn-small btn-ghost" onClick={() => { setImg(prevImg); setPrevImg(null); setOriginal(null); }}>写真を元に戻す</button>}
      </div>
      {busy && <Spinner label={busy} />}
      <ErrorBox error={error} />
      {photos.length > 0 && (
        <div className="field">
          <span>あなたが撮った写真（AIの判断材料・着こなし見本）</span>
          <div className="editor-gallery">
            {photos.map((x, i) => (
              <div key={i} className="editor-shot">
                <BlobImg blob={x.image} alt={x.label} />
                <select value={x.role} onChange={(e) => setPhotos((ps) => ps.map((y, j) => (j === i ? { ...y, role: e.target.value } : y)))}>
                  {Object.entries(ROLE_LABEL).filter(([k]) => k !== 'main').map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <button type="button" className="btn btn-small btn-ghost" onClick={() => setPhotos((ps) => ps.filter((_, j) => j !== i))}>削除</button>
              </div>
            ))}
          </div>
        </div>
      )}

      <label className="field">
        <span>名前</span>
        <input value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="例: 白のオックスフォードシャツ" />
      </label>
      <label className="field">
        <span>ブランド</span>
        <div className="row">
          <input
            style={{ flex: 1 }}
            value={f.brand || ''}
            onChange={(e) => setF((p) => ({ ...p, brand: e.target.value, brandConfidence: e.target.value.trim() ? 'sure' : 'unknown' }))}
            placeholder="不明（分からなければ空欄）"
            list="brand-list"
          />
          {f.brand && f.brandConfidence === 'guess' && (
            <button type="button" className="chip" title="タップで確定" onClick={() => set('brandConfidence', 'sure')}>
              AI推測 → 確定にする
            </button>
          )}
        </div>
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
        <span>目印のディテール（ロゴ・刺繍・プリントなど。1行に1つ。AI撮り直しで必ず再現します）</span>
        <textarea
          rows="3"
          defaultValue={(f.details || []).join('\n')}
          key={(f.details || []).join('|')}
          onBlur={(e) => set('details', e.target.value.split('\n').map((s) => s.trim()).filter(Boolean))}
          placeholder="例: 左胸に小さな紺の馬の刺繍ロゴ"
        />
      </label>
      <label className="field">
        <span>背面の特徴（あれば）</span>
        <input value={f.backDetail || ''} onChange={(e) => set('backDetail', e.target.value)} placeholder="例: 背中上部に白い筆記体のプリント文字" />
      </label>
      <label className="field">
        <span>いつもの着こなし（袖のまくり方・タックインなど。コーデ提案に反映）</span>
        <input value={f.stylingNotes || ''} onChange={(e) => set('stylingNotes', e.target.value)} placeholder="例: 袖は2回折って肘下まで / 前だけタックイン" />
      </label>
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
