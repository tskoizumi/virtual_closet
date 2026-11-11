import Dexie from 'dexie';

// データはまず端末のブラウザ内(IndexedDB)に保存される。
// クラウド同期をONにすると、変更が sync.js 経由でサーバーのD1にも反映される。
export const db = new Dexie('virtual_closet');
db.version(1).stores({
  items: 'id, category, createdAt, lastWornAt, wearCount',
  outfits: 'id, createdAt',
  kv: 'key',
});
// 処理待ちの登録キュー（リロードしても続きから再開するため）
db.version(2).stores({
  jobs: 'id, createdAt',
});
// クラウド同期用: 削除の記録（サーバーに送ったら消す）
db.version(3).stores({
  tombstones: 'key',
});

// ---- 同期のための変更追跡 ----
// 端末での作成・更新には updatedAt と _dirty=1（未送信）を付け、削除は tombstones に記録する。
// サーバーから取り込む書き込みは markSyncTx() したトランザクション内で行い、追跡しない。
export const SYNC_TABLES = ['items', 'outfits', 'kv'];
export const SYNC_KV_KEYS = ['profile', 'personPhoto'];
export const changes = new EventTarget();

export function markSyncTx() {
  if (Dexie.currentTransaction) Dexie.currentTransaction.__sync = true;
}
function isSyncTx(tx) {
  for (let t = tx; t; t = t.parent) if (t.__sync) return true;
  return false;
}
function tracked(table, key) {
  return table !== 'kv' || SYNC_KV_KEYS.includes(key);
}
function notify(tx) {
  if (tx.__notify) return;
  tx.__notify = true;
  tx.on('complete', () => changes.dispatchEvent(new Event('change')));
}
for (const name of SYNC_TABLES) {
  const table = db.table(name);
  table.hook('creating', function (pk, obj, tx) {
    if (isSyncTx(tx) || !tracked(name, pk ?? obj.id ?? obj.key)) return;
    obj.updatedAt = Date.now();
    obj._dirty = 1;
    notify(tx);
  });
  table.hook('updating', function (mods, pk, obj, tx) {
    if (isSyncTx(tx) || !tracked(name, pk)) return;
    notify(tx);
    return { updatedAt: Date.now(), _dirty: 1 };
  });
  table.hook('deleting', function (pk, obj, tx) {
    if (isSyncTx(tx) || !tracked(name, pk)) return;
    const at = Date.now();
    tx.on('complete', () => {
      db.tombstones
        .put({ key: `${name}:${pk}`, collection: name, id: pk, updatedAt: at })
        .then(() => changes.dispatchEvent(new Event('change')))
        .catch(() => {});
    });
  });
}

export function newId() {
  return Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-2);
}

export async function getKV(key, fallback = null) {
  const row = await db.kv.get(key);
  return row ? row.value : fallback;
}
export async function setKV(key, value) {
  await db.kv.put({ key, value });
}

export const DEFAULT_PROFILE = {
  persona: 'balance',
  styleNotes: '',
  city: '東京',
  photoMode: 'ai', // ai: AIで商品写真化＋透過 / cutout: 背景切り抜きのみ / none: そのまま
  recentDays: 3,
};

export async function getProfile() {
  return { ...DEFAULT_PROFILE, ...(await getKV('profile', {})) };
}

export async function markWorn(itemIds, when = Date.now()) {
  await db.transaction('rw', db.items, async () => {
    for (const id of itemIds) {
      const it = await db.items.get(id);
      if (it) await db.items.update(id, { wearCount: (it.wearCount || 0) + 1, lastWornAt: when });
    }
  });
}

export function compactItem(it) {
  return {
    id: it.id,
    name: it.name,
    brand: it.brand || undefined,
    category: it.category,
    subcategory: it.subcategory,
    colors: it.colors,
    material: it.material,
    pattern: it.pattern,
    formality: it.formality,
    warmth: it.warmth,
  };
}
