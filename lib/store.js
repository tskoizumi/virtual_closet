// クラウド同期用のDB（Cloudflare D1）ヘルパー
// D1 は Pages の設定で変数名 DB としてバインドする。テーブルは初回アクセス時に自動作成。
// データは「同期キー」ごとに分かれる。サーバーにはキーそのものではなく SHA-256 だけを保存する。
import { HttpError, json } from './gemini.js';

export const BLOB_CHUNK = 900 * 1024; // D1 の1行あたり上限(2MB)に収まるよう分割
export const MAX_BLOB = 12 * 1024 * 1024;
export const MAX_RECORD = 512 * 1024;
export const COLLECTIONS = ['items', 'outfits', 'kv'];

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS records (
    closet TEXT NOT NULL,
    collection TEXT NOT NULL,
    id TEXT NOT NULL,
    data TEXT,
    updated_at INTEGER NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0,
    seq INTEGER NOT NULL,
    PRIMARY KEY (closet, collection, id)
  )`,
  `CREATE INDEX IF NOT EXISTS records_seq ON records (closet, seq)`,
  `CREATE TABLE IF NOT EXISTS blobs (
    closet TEXT NOT NULL,
    key TEXT NOT NULL,
    part INTEGER NOT NULL,
    parts INTEGER NOT NULL,
    mime TEXT NOT NULL,
    data BLOB NOT NULL,
    PRIMARY KEY (closet, key, part)
  )`,
];

let schemaReady = false;
async function ensureSchema(db) {
  if (schemaReady) return;
  await db.batch(SCHEMA.map((s) => db.prepare(s)));
  schemaReady = true;
}

export async function sha256Hex(buf) {
  const d = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function closetOf(request) {
  const key = (request.headers.get('x-closet-key') || '').trim();
  if (key.length < 16) throw new HttpError(401, '同期キーが不正です（設定タブで確認してください）');
  return sha256Hex(new TextEncoder().encode(key));
}

// 同期APIの共通ラッパー: DBの有無・同期キーを確認して fn(ctx) を呼ぶ
export function syncHandler(fn) {
  return async (ctx) => {
    try {
      const db = ctx.env.DB;
      if (!db) throw new HttpError(503, 'サーバーにD1データベース(DB)がバインドされていません');
      await ensureSchema(db);
      const closet = await closetOf(ctx.request);
      const out = await fn({ ...ctx, db, closet });
      return out instanceof Response ? out : json(out);
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      return json({ error: e.message || String(e) }, status);
    }
  };
}

export async function readJSON(request) {
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, 'リクエストがJSONではありません');
  }
}
