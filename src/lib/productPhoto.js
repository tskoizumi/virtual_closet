import { api } from './api.js';
import { forAI, base64ToBlob, resize } from './image.js';
import { getProfile } from './db.js';
import { hasWornShot } from '../../lib/accessories.js';

export const PHOTO_VERSION = 3; // 3 = 公式ブティック風（モデル着用・3:4）

// AIでブランド公式オンラインブティック風の商品写真を1枚生成する
// view: 'front'（メイン） | 'back'（背面）
// refs: 同じアイテムの別の写真 [{ image: Blob, label }]（ロゴや色の確認用） / focus: ディテールカットで寄る部分
export async function makeProductPhoto(blob, { name, subcategory, category, brand, details, backDetail, view = 'front', focus = '', refs = [], onStage } = {}) {
  onStage?.(view === 'back' ? 'AIが背面の写真を撮影中…' : view === 'worn' ? 'AIが着用カットを撮影中…' : view === 'detail' ? `AIがディテール（${focus}）を撮影中…` : 'AIが商品写真を撮影中…');
  const refImgs = [];
  for (const r of refs.slice(0, 3)) refImgs.push({ ...(await forAI(r.image, 768)), label: r.label });
  const { modelGender } = await getProfile();
  const { image } = await api('productize', {
    image: await forAI(blob, 1280),
    name,
    subcategory,
    category,
    brand,
    details: details || [],
    backDetail: backDetail || '',
    view,
    focus,
    refs: refImgs,
    gender: modelGender || 'auto',
  });
  return resize(base64ToBlob(image), 1400, { type: 'image/jpeg', quality: 0.9 });
}

// 写真の役割
export const ROLE_LABEL = { main: 'メイン', back: '背面', detail: 'ディテール', tag: 'タグ', styling: '着こなし', worn: '着用' };
const MAX_DETAIL_SHOTS = 3;

// アイテム1点分の写真一式を作る
// extras: ユーザーが撮った同じアイテムの追加写真 [{ image: Blob, role, label, note }]
//  - back   → 背面の商品写真に撮り直す
//  - detail → ディテールカット（裏地・ボタン・ロゴなど）に撮り直す（最大3枚）
//  - worn   → 着用カットに撮り直す
//  - tag / styling → 撮り直さない（属性の判断材料・着こなしメモとして元写真のまま残す）
export async function makeProductSet(blob, item, { onStage, extras = [] } = {}) {
  const opts = { name: item.name, subcategory: item.subcategory, category: item.category, brand: item.brand, details: item.details, backDetail: item.backDetail, onStage };
  const ofRole = (r) => extras.filter((x) => x.role === r);
  // メイン撮影の参考: ロゴや部分が分かる写真
  const refs = [...ofRole('detail'), ...ofRole('tag'), ...ofRole('back')].slice(0, 3).map((x) => ({ image: x.image, label: x.label || ROLE_LABEL[x.role] }));
  const safe = async (label, fn) => {
    try {
      return { label, image: await fn() };
    } catch {
      return null; // 追加の写真が失敗してもメインは使う
    }
  };

  const backPhoto = ofRole('back')[0];
  if (item.shownSide === 'back' && !backPhoto) {
    // 背面しか写っていない場合は、分かる範囲（背面）をメインにする
    return { image: await makeProductPhoto(blob, { ...opts, view: 'back', refs }), gallery: [] };
  }
  const image = await makeProductPhoto(blob, { ...opts, refs });
  const tasks = [];
  if (backPhoto) {
    tasks.push(() => safe('背面', () => makeProductPhoto(backPhoto.image, { ...opts, view: 'back', refs: [{ image: blob, label: '正面' }] })));
  } else if (item.shownSide === 'both' && item.backDetail) {
    tasks.push(() => safe('背面', () => makeProductPhoto(blob, { ...opts, view: 'back' })));
  }
  for (const d of ofRole('detail').slice(0, MAX_DETAIL_SHOTS)) {
    tasks.push(() => safe(d.label || 'ディテール', () => makeProductPhoto(d.image, { ...opts, view: 'detail', focus: d.note || d.label, refs: [{ image: blob, label: '全体' }] })));
  }
  const wornPhoto = ofRole('worn')[0];
  if (wornPhoto) {
    tasks.push(() => safe('着用', () => makeProductPhoto(wornPhoto.image, { ...opts, view: 'worn', refs: [{ image: blob, label: '全体' }] })));
  } else if (hasWornShot(item)) {
    // 小物は2枚目に着用カット（サイズ感や付け方が分かるように）
    tasks.push(() => safe('着用', () => makeProductPhoto(blob, { ...opts, view: 'worn' })));
  }
  const gallery = [];
  for (const t of tasks) {
    const r = await t(); // 1枚ずつ順番に（背面 → ディテール → 着用）。並列にするとAPIの制限に当たりやすい
    if (r) gallery.push(r);
  }
  return { image, gallery };
}

// 撮り直しなし（切り抜き・そのままモード）のときの追加写真の並び
export async function plainGallery(extras) {
  const out = [];
  for (const x of extras.filter((e) => ['back', 'detail', 'worn'].includes(e.role))) {
    out.push({ label: x.label || ROLE_LABEL[x.role], image: await resize(x.image, 1400, { type: 'image/jpeg', quality: 0.9 }) });
  }
  return out;
}
