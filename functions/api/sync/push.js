import { syncHandler, readJSON, COLLECTIONS, MAX_RECORD } from '../../../lib/store.js';
import { HttpError } from '../../../lib/gemini.js';

const MAX_PER_PUSH = 40; // D1 の1リクエストあたりのクエリ数制限に収める

// 端末の変更を書き込む。同じレコードは updated_at が新しい方を採用（後勝ち）
export const onRequestPost = syncHandler(async ({ request, db, closet }) => {
  const { records } = await readJSON(request);
  if (!Array.isArray(records)) throw new HttpError(400, 'records がありません');
  if (records.length > MAX_PER_PUSH) throw new HttpError(400, `1回の送信は${MAX_PER_PUSH}件までです`);

  const stmts = [];
  for (const r of records) {
    if (!COLLECTIONS.includes(r.collection)) throw new HttpError(400, `不明なコレクション: ${r.collection}`);
    if (typeof r.id !== 'string' || !r.id || r.id.length > 200) throw new HttpError(400, 'IDが不正です');
    const updatedAt = Number(r.updatedAt);
    if (!Number.isFinite(updatedAt)) throw new HttpError(400, 'updatedAt が不正です');
    const deleted = r.deleted ? 1 : 0;
    const data = deleted ? null : JSON.stringify(r.data ?? null);
    if (data && data.length > MAX_RECORD) throw new HttpError(413, `レコードが大きすぎます (${r.collection}/${r.id})`);
    stmts.push(
      db
        .prepare(
          `INSERT INTO records (closet, collection, id, data, updated_at, deleted, seq)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, (SELECT COALESCE(MAX(seq), 0) + 1 FROM records WHERE closet = ?1))
           ON CONFLICT (closet, collection, id) DO UPDATE SET
             data = excluded.data, updated_at = excluded.updated_at, deleted = excluded.deleted, seq = excluded.seq
           WHERE excluded.updated_at >= records.updated_at`
        )
        .bind(closet, r.collection, r.id, data, updatedAt, deleted)
    );
  }
  if (stmts.length) await db.batch(stmts);
  return { ok: true, count: stmts.length };
});
