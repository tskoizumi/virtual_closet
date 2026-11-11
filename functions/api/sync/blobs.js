import { syncHandler, readJSON } from '../../../lib/store.js';
import { HttpError } from '../../../lib/gemini.js';

// 送られた画像キーのうち、サーバーにまだ無いものを返す
export const onRequestPost = syncHandler(async ({ request, db, closet }) => {
  const { keys } = await readJSON(request);
  if (!Array.isArray(keys) || keys.length > 90) throw new HttpError(400, 'keys は90件までの配列で送ってください');
  const valid = keys.filter((k) => /^[0-9a-f]{64}$/.test(k));
  if (!valid.length) return { missing: [] };
  const { results } = await db
    .prepare(`SELECT key FROM blobs WHERE closet = ? AND part = 0 AND key IN (${valid.map(() => '?').join(',')})`)
    .bind(closet, ...valid)
    .all();
  const have = new Set(results.map((r) => r.key));
  return { missing: valid.filter((k) => !have.has(k)) };
});
