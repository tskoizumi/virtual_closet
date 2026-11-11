import { syncHandler, readJSON } from '../../../lib/store.js';

const PAGE = 200;

// since より後に変更されたレコードを seq 順に返す
export const onRequestPost = syncHandler(async ({ request, db, closet }) => {
  const { since = 0 } = await readJSON(request);
  const { results } = await db
    .prepare(
      `SELECT collection, id, data, updated_at, deleted, seq FROM records
       WHERE closet = ? AND seq > ? ORDER BY seq LIMIT ?`
    )
    .bind(closet, Number(since) || 0, PAGE)
    .all();
  const records = results.map((r) => ({
    collection: r.collection,
    id: r.id,
    updatedAt: r.updated_at,
    deleted: !!r.deleted,
    data: r.data ? JSON.parse(r.data) : null,
  }));
  const cursor = results.length ? results[results.length - 1].seq : Number(since) || 0;
  return { records, cursor, more: results.length === PAGE };
});
