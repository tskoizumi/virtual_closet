import { api } from './api.js';
import { forAI, base64ToBlob, resize } from './image.js';
import { getProfile } from './db.js';
import { hasWornShot } from '../../lib/accessories.js';

export const PHOTO_VERSION = 3; // 3 = 公式ブティック風（モデル着用・3:4）

// AIでブランド公式オンラインブティック風の商品写真を1枚生成する
// view: 'front'（メイン） | 'back'（背面）
export async function makeProductPhoto(blob, { name, subcategory, category, brand, details, backDetail, view = 'front', onStage } = {}) {
  onStage?.(view === 'back' ? 'AIが背面の写真を撮影中…' : view === 'worn' ? 'AIが着用カットを撮影中…' : 'AIが商品写真を撮影中…');
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
    gender: modelGender || 'auto',
  });
  return resize(base64ToBlob(image), 1400, { type: 'image/jpeg', quality: 0.9 });
}

// アイテム1点分の写真一式（メイン＋必要なら背面）を作る
// 元写真に背面の特徴的なデザインが写っていれば、2枚目として背面の写真も作る
export async function makeProductSet(blob, item, { onStage } = {}) {
  const opts = { name: item.name, subcategory: item.subcategory, category: item.category, brand: item.brand, details: item.details, backDetail: item.backDetail, onStage };
  if (item.shownSide === 'back') {
    // 背面しか写っていない場合は、分かる範囲（背面）をメインにする
    return { image: await makeProductPhoto(blob, { ...opts, view: 'back' }), gallery: [] };
  }
  const image = await makeProductPhoto(blob, opts);
  const gallery = [];
  if (item.shownSide === 'both' && item.backDetail) {
    try {
      gallery.push({ label: '背面', image: await makeProductPhoto(blob, { ...opts, view: 'back' }) });
    } catch {
      // 背面が失敗してもメインは使う
    }
  }
  // 小物は2枚目に着用カット（サイズ感や付け方が分かるように）
  if (hasWornShot(item)) {
    try {
      gallery.push({ label: '着用', image: await makeProductPhoto(blob, { ...opts, view: 'worn' }) });
    } catch {}
  }
  return { image, gallery };
}
