import { useRef, useState } from 'react';
import { CATEGORY_LABEL } from '../lib/rules.js';
import { BlobImg } from './ui.jsx';

const SEASON_LABEL = { spring: '春', summer: '夏', autumn: '秋', winter: '冬' };
const FORMALITY = ['', '部屋着', 'ラフ', 'カジュアル', 'きれいめ', 'フォーマル'];
const WARMTH = ['', '真夏', '夏', '春秋', '秋冬', '真冬'];

function daysAgo(t) {
  if (!t) return '未着用';
  const d = Math.floor((Date.now() - t) / 86400000);
  return d === 0 ? '今日' : `${d}日前`;
}

// ブランド公式オンラインブティックの商品ページ風の詳細表示
export default function ItemPage({ item, onEdit, onWorn, onDelete }) {
  const shots = [{ label: 'メイン', image: item.image }, ...(item.gallery || [])].filter((s) => s.image);
  const styling = (item.photos || []).filter((x) => x.role === 'styling');
  const others = (item.photos || []).filter((x) => x.role !== 'styling');
  const [idx, setIdx] = useState(0);
  const track = useRef(null);
  const go = (i) => {
    setIdx(i);
    const el = track.current;
    if (el) el.scrollTo({ left: el.clientWidth * i, behavior: 'smooth' });
  };

  const specs = [
    ['カテゴリ', [CATEGORY_LABEL[item.category], item.subcategory].filter(Boolean).join(' / ')],
    ['カラー', (item.colors || []).join(', ')],
    ['素材', item.material],
    ['柄', item.pattern],
    ['シーズン', (item.seasons || []).map((s) => SEASON_LABEL[s]).join('・')],
    ['テイスト', `${FORMALITY[item.formality] || ''}${item.warmth ? ` ・ ${WARMTH[item.warmth]}向け` : ''}`],
  ].filter(([, v]) => v);

  return (
    <div className="pdp">
      <div className="pdp-gallery">
        <div
          className="pdp-track"
          ref={track}
          onScroll={(e) => {
            const el = e.currentTarget;
            const i = Math.round(el.scrollLeft / el.clientWidth);
            if (i !== idx) setIdx(i);
          }}
        >
          {shots.map((s, i) => (
            <div key={i} className="pdp-slide">
              <BlobImg blob={s.image} alt={`${item.name} ${s.label}`} />
            </div>
          ))}
        </div>
        {shots.length > 1 && (
          <div className="pdp-dots">
            {shots.map((s, i) => (
              <button key={i} type="button" className={i === idx ? 'is-active' : ''} onClick={() => go(i)} aria-label={s.label} />
            ))}
          </div>
        )}
      </div>
      {shots.length > 1 && (
        <div className="pdp-thumbs">
          {shots.map((s, i) => (
            <button key={i} type="button" className={i === idx ? 'is-active' : ''} onClick={() => go(i)}>
              <BlobImg blob={s.image} alt={s.label} />
            </button>
          ))}
        </div>
      )}

      <div className="pdp-info">
        <div className="pdp-brand">
          {item.brand ? item.brand : <span className="muted">ブランド不明</span>}
          {item.brand && item.brandConfidence === 'guess' && <span className="pdp-guess">AI推測</span>}
        </div>
        <h3 className="pdp-name">{item.name}</h3>
        <p className="muted small">
          {daysAgo(item.lastWornAt)} ・ 着用{item.wearCount || 0}回{item.isFixed ? ' ・ 固定アイテム' : ''}
        </p>

        <div className="pdp-actions">
          <button className="btn btn-primary" onClick={onWorn}>今日着た</button>
          <button className="btn" onClick={onEdit}>編集</button>
        </div>

        {item.notes && <p className="pdp-desc">{item.notes}</p>}

        {(item.details?.length > 0 || item.backDetail) && (
          <>
            <h4>ディテール</h4>
            <ul className="pdp-details">
              {(item.details || []).map((d, i) => <li key={i}>{d}</li>)}
              {item.backDetail && !(item.details || []).some((d) => d.includes(item.backDetail)) && <li>背面: {item.backDetail}</li>}
            </ul>
          </>
        )}

        {(item.stylingNotes || styling.length > 0) && (
          <>
            <h4>いつもの着こなし</h4>
            <div className="pdp-styling">
              {styling.map((x, i) => (
                <div key={i} className="pdp-styling-row">
                  <BlobImg blob={x.image} alt={x.label} />
                  <span>{x.note || x.label}</span>
                </div>
              ))}
              {item.stylingNotes && !styling.length && <p className="pdp-desc">{item.stylingNotes}</p>}
            </div>
          </>
        )}

        {others.length > 0 && (
          <>
            <h4>あなたが撮った写真</h4>
            <div className="pdp-photos">
              {others.map((x, i) => (
                <figure key={i}>
                  <BlobImg blob={x.image} alt={x.label} />
                  <figcaption>{x.label}</figcaption>
                </figure>
              ))}
            </div>
          </>
        )}

        <h4>アイテム情報</h4>
        <dl className="pdp-specs">
          {specs.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>

        <button className="btn btn-small btn-ghost pdp-delete" onClick={onDelete}>このアイテムを削除</button>
      </div>
    </div>
  );
}
