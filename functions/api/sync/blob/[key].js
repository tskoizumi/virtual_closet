import { syncHandler, sha256Hex, BLOB_CHUNK, MAX_BLOB } from '../../../../lib/store.js';
import { HttpError } from '../../../../lib/gemini.js';

// 画像は内容の SHA-256 をキーにして保存（同じ画像は1回だけ・内容は不変）
function keyOf(params) {
  const key = String(params.key || '');
  if (!/^[0-9a-f]{64}$/.test(key)) throw new HttpError(400, '画像キーが不正です');
  return key;
}

export const onRequestGet = syncHandler(async ({ db, closet, params }) => {
  const key = keyOf(params);
  const { results } = await db
    .prepare('SELECT part, parts, mime, data FROM blobs WHERE closet = ? AND key = ? ORDER BY part')
    .bind(closet, key)
    .all();
  if (!results.length || results.length !== results[0].parts) throw new HttpError(404, '画像が見つかりません');
  const chunks = results.map((r) => new Uint8Array(r.data));
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return new Response(out, {
    headers: { 'content-type': results[0].mime, 'cache-control': 'private, max-age=31536000, immutable' },
  });
});

export const onRequestPut = syncHandler(async ({ request, db, closet, params }) => {
  const key = keyOf(params);
  const mime = (request.headers.get('content-type') || 'application/octet-stream').split(';')[0].trim();
  if (!/^image\/[a-z0-9.+-]+$/i.test(mime)) throw new HttpError(415, '画像以外は保存できません');
  const buf = await request.arrayBuffer();
  if (!buf.byteLength) throw new HttpError(400, '画像が空です');
  if (buf.byteLength > MAX_BLOB) throw new HttpError(413, '画像が大きすぎます');
  if ((await sha256Hex(buf)) !== key) throw new HttpError(400, '画像の内容とキーが一致しません');

  const parts = Math.ceil(buf.byteLength / BLOB_CHUNK);
  const stmts = [db.prepare('DELETE FROM blobs WHERE closet = ? AND key = ?').bind(closet, key)];
  for (let i = 0; i < parts; i++) {
    const chunk = buf.slice(i * BLOB_CHUNK, (i + 1) * BLOB_CHUNK);
    stmts.push(
      db
        .prepare('INSERT INTO blobs (closet, key, part, parts, mime, data) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(closet, key, i, parts, mime, chunk)
    );
  }
  await db.batch(stmts);
  return { ok: true, size: buf.byteLength };
});
