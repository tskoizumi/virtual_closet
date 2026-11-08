// 画像処理（すべてブラウザ内で完結）

async function bitmap(blob) {
  return await createImageBitmap(blob, { imageOrientation: 'from-image' });
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('画像の変換に失敗しました'))), type, quality)
  );
}

// 長辺 maxSide に縮小。background を指定すると透過部分を塗る
export async function resize(blob, maxSide, { type = 'image/jpeg', quality = 0.85, background = null } = {}) {
  const bmp = await bitmap(blob);
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale);
  const h = Math.round(bmp.height * scale);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (background || type === 'image/jpeg') {
    ctx.fillStyle = background || '#ffffff';
    ctx.fillRect(0, 0, w, h);
  }
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  return canvasToBlob(c, type, quality);
}

// 透過PNGの余白を切り詰める
export async function trimTransparent(blob, pad = 12) {
  const bmp = await bitmap(blob);
  const c = document.createElement('canvas');
  c.width = bmp.width;
  c.height = bmp.height;
  const ctx = c.getContext('2d');
  ctx.drawImage(bmp, 0, 0);
  const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height);
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      if (data[(y * width + x) * 4 + 3] > 24) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) throw new Error('切り抜き結果が空でした（服が認識できませんでした）');
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(width - 1, maxX + pad);
  maxY = Math.min(height - 1, maxY + pad);
  const out = document.createElement('canvas');
  out.width = maxX - minX + 1;
  out.height = maxY - minY + 1;
  out.getContext('2d').drawImage(c, minX, minY, out.width, out.height, 0, 0, out.width, out.height);
  bmp.close?.();
  return canvasToBlob(out, 'image/png');
}

let bgModule = null;
export async function removeBg(blob, onProgress) {
  if (!bgModule) bgModule = await import('@imgly/background-removal');
  const res = await bgModule.removeBackground(blob, {
    output: { format: 'image/png' },
    progress: (key, current, total) => onProgress?.(key, current, total),
  });
  return res;
}

export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result);
      const i = s.indexOf(',');
      resolve({ mime: blob.type || 'image/jpeg', data: s.slice(i + 1) });
    };
    r.onerror = () => reject(new Error('画像の読み込みに失敗しました'));
    r.readAsDataURL(blob);
  });
}

// AIに送る形式（白背景JPEG・縮小）
export async function forAI(blob, maxSide = 1024) {
  const j = await resize(blob, maxSide, { type: 'image/jpeg', quality: 0.85, background: '#ffffff' });
  return blobToBase64(j);
}

export function base64ToBlob({ mime, data }) {
  const bin = atob(data);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

export function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

export async function dataURLToBlob(url) {
  const res = await fetch(url);
  return await res.blob();
}
