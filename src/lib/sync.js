// クラウド同期（Cloudflare D1）
// 端末のIndexedDBを正として使い続け、変更をサーバーへ送り、他の端末の変更を取り込む。
// 同じレコードを複数の端末で変えた場合は updatedAt が新しい方を採用（後勝ち）。
// 画像は内容のSHA-256をキーにして別送する（同じ画像は1回だけアップロード）。
import { db, changes, markSyncTx, SYNC_KV_KEYS } from './db.js';
import { getPasscode } from './api.js';

const LS_KEY = 'vc_sync_key';
const LS_CURSOR = 'vc_sync_cursor';
const LS_LAST = 'vc_sync_last';
const PUSH_BATCH = 40;
const BLOB_CONCURRENCY = 3;
const INTERVAL = 60 * 1000;

function lsGet(k) {
  try {
    return localStorage.getItem(k) || '';
  } catch {
    return '';
  }
}
function lsSet(k, v) {
  try {
    if (v) localStorage.setItem(k, v);
    else localStorage.removeItem(k);
  } catch {}
}

// ---- 状態 ----
let state = { key: lsGet(LS_KEY), status: 'idle', error: null, label: '', lastSyncAt: Number(lsGet(LS_LAST)) || null };
const listeners = new Set();
function setState(p) {
  state = { ...state, ...p };
  listeners.forEach((l) => l(state));
}
export function subscribeSync(fn) {
  listeners.add(fn);
  fn(state);
  return () => listeners.delete(fn);
}
export function getSyncKey() {
  return state.key;
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function generateSyncKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  const chars = [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join('');
  return chars.match(/.{4}/g).join('-');
}
export function normalizeKey(k) {
  return String(k || '').toUpperCase().replace(/[^A-Z0-9]/g, '').match(/.{1,4}/g)?.join('-') || '';
}

// 同期キーを設定（空なら同期OFF）。キーが変わったら全データを未送信扱いにして送り直す
export async function setSyncKey(key) {
  key = key ? normalizeKey(key) : '';
  if (key && key.replace(/-/g, '').length < 16) throw new Error('同期キーが短すぎます');
  lsSet(LS_KEY, key);
  lsSet(LS_CURSOR, '');
  lsSet(LS_LAST, '');
  setState({ key, error: null, status: 'idle', label: '', lastSyncAt: null });
  if (key) {
    await markAllDirty();
    await syncNow();
  }
}

async function markAllDirty() {
  await db.transaction('rw', db.items, db.outfits, db.kv, async () => {
    markSyncTx();
    const fix = (r) => {
      r._dirty = 1;
      r.updatedAt = r.updatedAt || r.createdAt || Date.now();
    };
    await db.items.toCollection().modify(fix);
    await db.outfits.toCollection().modify(fix);
    await db.kv.where('key').anyOf(SYNC_KV_KEYS).modify(fix);
  });
}

// ---- 通信 ----
async function req(path, { method = 'POST', body, raw, contentType } = {}) {
  let res;
  try {
    res = await fetch(`/api/sync/${path}`, {
      method,
      headers: {
        'x-app-passcode': getPasscode(),
        'x-closet-key': state.key,
        ...(raw ? { 'content-type': contentType } : body ? { 'content-type': 'application/json' } : {}),
      },
      body: raw || (body ? JSON.stringify(body) : undefined),
    });
  } catch {
    throw new Error('サーバーに接続できませんでした');
  }
  if (method === 'GET' && res.ok) return res;
  let json;
  try {
    json = await res.json();
  } catch {
    throw new Error(`サーバーの応答が不正です (HTTP ${res.status})`);
  }
  if (!res.ok || json.error) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

async function pool(list, n, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.min(n, list.length) }, async () => {
    while (i < list.length) await fn(list[i++]);
  });
  await Promise.all(workers);
}

// ---- Blob <-> 参照 の変換 ----
const hashCache = new WeakMap();
async function hashBlob(blob) {
  if (hashCache.has(blob)) return hashCache.get(blob);
  const d = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  const hex = [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
  hashCache.set(blob, hex);
  return hex;
}

async function encode(v, blobs) {
  if (v instanceof Blob) {
    const key = await hashBlob(v);
    blobs.set(key, v);
    return { $blob: key, mime: v.type || 'image/jpeg' };
  }
  if (Array.isArray(v)) return Promise.all(v.map((x) => encode(x, blobs)));
  if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
    const o = {};
    for (const [k, x] of Object.entries(v)) if (k !== '_dirty') o[k] = await encode(x, blobs);
    return o;
  }
  return v;
}

function collectRefs(v, out) {
  if (Array.isArray(v)) v.forEach((x) => collectRefs(x, out));
  else if (v && typeof v === 'object') {
    if (typeof v.$blob === 'string') out.add(v.$blob);
    else Object.values(v).forEach((x) => collectRefs(x, out));
  }
  return out;
}

function decode(v, blobs) {
  if (Array.isArray(v)) return v.map((x) => decode(x, blobs));
  if (v && typeof v === 'object') {
    if (typeof v.$blob === 'string') return blobs.get(v.$blob);
    const o = {};
    for (const [k, x] of Object.entries(v)) o[k] = decode(x, blobs);
    return o;
  }
  return v;
}

const TABLES = { items: db.items, outfits: db.outfits, kv: db.kv };

// ---- 送信 ----
async function push() {
  const dirty = [];
  for (const name of ['items', 'outfits']) {
    for (const r of await TABLES[name].filter((x) => x._dirty === 1).toArray()) dirty.push({ collection: name, id: r.id, row: r });
  }
  for (const r of await db.kv.bulkGet(SYNC_KV_KEYS)) if (r && r._dirty === 1) dirty.push({ collection: 'kv', id: r.key, row: r });
  const tombs = await db.tombstones.toArray();
  const total = dirty.length + tombs.length;
  let done = 0;

  // 削除
  for (let i = 0; i < tombs.length; i += PUSH_BATCH) {
    const batch = tombs.slice(i, i + PUSH_BATCH);
    await req('push', { body: { records: batch.map((t) => ({ collection: t.collection, id: t.id, updatedAt: t.updatedAt, deleted: true })) } });
    await db.transaction('rw', db.tombstones, async () => {
      for (const t of batch) {
        const cur = await db.tombstones.get(t.key);
        if (cur && cur.updatedAt === t.updatedAt) await db.tombstones.delete(t.key);
      }
    });
    done += batch.length;
    setState({ label: `送信中 ${done}/${total}` });
  }

  // 作成・更新（画像を先に送ってからレコードを送る）
  for (let i = 0; i < dirty.length; i += PUSH_BATCH) {
    const batch = dirty.slice(i, i + PUSH_BATCH);
    const blobs = new Map();
    const records = [];
    for (const d of batch) records.push({ collection: d.collection, id: d.id, updatedAt: d.row.updatedAt, data: await encode(d.row, blobs) });
    const keys = [...blobs.keys()];
    const missing = [];
    for (let j = 0; j < keys.length; j += 90) missing.push(...(await req('blobs', { body: { keys: keys.slice(j, j + 90) } })).missing);
    await pool(missing, BLOB_CONCURRENCY, async (k) => {
      const b = blobs.get(k);
      await req(`blob/${k}`, { method: 'PUT', raw: b, contentType: b.type || 'image/jpeg' });
    });
    await req('push', { body: { records } });
    // 送信中に編集されたものは未送信のまま残す
    await db.transaction('rw', db.items, db.outfits, db.kv, async () => {
      markSyncTx();
      for (const d of batch) {
        const t = TABLES[d.collection];
        const cur = await t.get(d.id);
        if (cur && cur.updatedAt === d.row.updatedAt) await t.update(d.id, { _dirty: 0 });
      }
    });
    done += batch.length;
    setState({ label: `送信中 ${done}/${total}` });
  }
  return total;
}

// ---- 受信 ----
async function pull() {
  let cursor = Number(lsGet(LS_CURSOR)) || 0;
  let applied = 0;
  for (;;) {
    const { records, cursor: next, more } = await req('pull', { body: { since: cursor } });
    // 端末側のほうが新しいものは取り込まない
    const todo = [];
    for (const r of records) {
      const t = TABLES[r.collection];
      if (!t || (r.collection === 'kv' && !SYNC_KV_KEYS.includes(r.id))) continue;
      const [local, tomb] = await Promise.all([t.get(r.id), db.tombstones.get(`${r.collection}:${r.id}`)]);
      if (local && (local.updatedAt || 0) >= r.updatedAt) continue;
      if (tomb && tomb.updatedAt >= r.updatedAt) continue;
      if (r.deleted && !local) continue;
      todo.push(r);
    }
    // 必要な画像をダウンロード
    const refs = new Set();
    todo.forEach((r) => !r.deleted && collectRefs(r.data, refs));
    const blobs = new Map();
    let got = 0;
    await pool([...refs], BLOB_CONCURRENCY + 1, async (k) => {
      const res = await req(`blob/${k}`, { method: 'GET' });
      const b = await res.blob();
      hashCache.set(b, k);
      blobs.set(k, b);
      got++;
      setState({ label: `受信中 画像 ${got}/${refs.size}` });
    });
    await db.transaction('rw', db.items, db.outfits, db.kv, db.tombstones, async () => {
      markSyncTx();
      for (const r of todo) {
        const t = TABLES[r.collection];
        const local = await t.get(r.id);
        if (local && (local.updatedAt || 0) >= r.updatedAt) continue; // 受信中に端末で編集された
        if (r.deleted) await t.delete(r.id);
        else await t.put({ ...decode(r.data, blobs), updatedAt: r.updatedAt, _dirty: 0 });
        const tk = `${r.collection}:${r.id}`;
        const tomb = await db.tombstones.get(tk);
        if (tomb && tomb.updatedAt < r.updatedAt) await db.tombstones.delete(tk);
        applied++;
      }
    });
    cursor = next;
    lsSet(LS_CURSOR, String(cursor));
    if (!more) break;
  }
  return applied;
}

// ---- 実行制御 ----
let running = null;
let again = false;
export function syncNow() {
  if (!state.key) return Promise.resolve();
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    setState({ status: 'syncing', error: null, label: '同期中…' });
    try {
      do {
        again = false;
        await push();
        await pull();
      } while (again);
      const now = Date.now();
      lsSet(LS_LAST, String(now));
      setState({ status: 'idle', label: '', lastSyncAt: now });
    } catch (e) {
      setState({ status: 'error', label: '', error: e.message || String(e) });
    } finally {
      running = null;
    }
  })();
  return running;
}

let started = false;
let timer = null;
export function startSync() {
  if (started) return;
  started = true;
  // 端末で変更があったら少し待ってまとめて送る
  changes.addEventListener('change', () => {
    if (!state.key) return;
    clearTimeout(timer);
    timer = setTimeout(syncNow, 2000);
  });
  setInterval(() => document.visibilityState === 'visible' && syncNow(), INTERVAL);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && syncNow());
  window.addEventListener('online', () => syncNow());
  syncNow();
}
