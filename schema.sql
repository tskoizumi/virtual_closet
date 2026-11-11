-- クラウド同期用 D1 スキーマ（lib/store.js が初回アクセス時に自動で作成するので、手動実行は任意）
CREATE TABLE IF NOT EXISTS records (
  closet TEXT NOT NULL,       -- 同期キーの SHA-256
  collection TEXT NOT NULL,   -- items / outfits / kv
  id TEXT NOT NULL,
  data TEXT,                  -- JSON（画像は {"$blob": sha256} の参照）
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  seq INTEGER NOT NULL,       -- 変更順の通し番号（差分取得用）
  PRIMARY KEY (closet, collection, id)
);
CREATE INDEX IF NOT EXISTS records_seq ON records (closet, seq);
CREATE TABLE IF NOT EXISTS blobs (
  closet TEXT NOT NULL,
  key TEXT NOT NULL,          -- 画像内容の SHA-256
  part INTEGER NOT NULL,
  parts INTEGER NOT NULL,
  mime TEXT NOT NULL,
  data BLOB NOT NULL,
  PRIMARY KEY (closet, key, part)
);
