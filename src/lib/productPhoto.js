import { api } from './api.js';
import { forAI, base64ToBlob, resize, removeBg, trimTransparent } from './image.js';

let chain = Promise.resolve();
function serial(fn) {
  const p = chain.then(fn, fn);
  chain = p.catch(() => {});
  return p;
}

// AIでプロ品質の商品写真を生成し、白背景を透過させる
export async function makeProductPhoto(blob, { name, category, brand, transparent = true, onStage } = {}) {
  onStage?.('AIが商品写真を撮影中…');
  const { image } = await api('productize', { image: await forAI(blob, 1280), name, category, brand });
  const white = base64ToBlob(image);
  if (!transparent) return resize(white, 900, { type: 'image/jpeg', quality: 0.9 });
  try {
    onStage?.('背景を透過中…');
    const cut = await serial(() => removeBg(white));
    return await resize(await trimTransparent(cut, 16), 900, { type: 'image/png' });
  } catch {
    return resize(white, 900, { type: 'image/jpeg', quality: 0.9 });
  }
}
