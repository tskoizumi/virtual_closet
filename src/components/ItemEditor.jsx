import { useState } from 'react';
import { CATEGORY_LABEL } from '../lib/rules.js';
import { BlobImg } from './ui.jsx';

const SEASON_LABEL = { spring: '春', summer: '夏', autumn: '秋', winter: '冬' };
const FORMALITY = ['', '部屋着', 'ラフ', 'カジュアル', 'きれいめ', 'フォーマル'];
const WARMTH = ['', '真夏', '夏', '春秋', '秋冬', '真冬'];

export default function ItemEditor({ initial, image, onSave, onCancel, saveLabel = '保存', extra }) {
  const [f, setF] = useState(() => ({
    name: '', category: 'tops', subcategory: '', colors: [], material: '', pattern: '',
    formality: 3, warmth: 3, seasons: [], notes: '', isFixed: false, ...initial,
  }));
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));

  return (
    <form
      className="editor"
      onSubmit={(e) => {
        e.preventDefault();
        if (!f.name.trim()) return alert('名前を入力してください');
        onSave({ ...f, formality: Number(f.formality), warmth: Number(f.warmth) });
      }}
    >
      {image && (
        <div className="editor-img">
          <BlobImg blob={image} alt={f.name} />
        </div>
      )}
      <label className="field">
        <span>名前</span>
        <input value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="例: 白のオックスフォードシャツ" />
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
            value={(f.colors || []).join(', ')}
            onChange={(e) => set('colors', e.target.value.split(/[,、]/).map((s) => s.trim()).filter(Boolean))}
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
        <button type="submit" className="btn btn-primary">{saveLabel}</button>
      </div>
    </form>
  );
}
