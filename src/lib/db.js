import Dexie from 'dexie';

// すべてのデータはこの端末のブラウザ内(IndexedDB)にだけ保存される
export const db = new Dexie('virtual_closet');
db.version(1).stores({
  items: 'id, category, createdAt, lastWornAt, wearCount',
  outfits: 'id, createdAt',
  kv: 'key',
});

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
