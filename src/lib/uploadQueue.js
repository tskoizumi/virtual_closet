// 服の一括登録キュー。画面を移動しても裏で処理を続け、終わったものから自動でクローゼットに保存する
import { db, newId, getProfile } from './db.js';
import { resize, removeBg, trimTransparent, forAI } from './image.js';
import { api } from './api.js';
import { makeProductSet, PHOTO_VERSION } from './productPhoto.js';

const TAG_CONCURRENCY = 3;
let jobs = [];
const listeners = new Set();
let running = 0;
let cutChain = Promise.resolve(); // 背景切り抜きは重いので1枚ずつ

function emit() {
  const snap = jobs.map((j) => ({ ...j }));
  listeners.forEach((l) => l(snap));
}
const PERSIST_KEYS = ['file', 'redoId', 'original', 'image', 'gallery', 'item', 'forceMode', 'skipCut', 'createdAt'];
function persist(job) {
  const row = { id: job.id };
  PERSIST_KEYS.forEach((k) => job[k] !== undefined && (row[k] = job[k]));
  db.jobs.put(row).catch(() => {});
}
function patch(id, p) {
  jobs = jobs.map((j) => (j.id === id ? { ...j, ...p } : j));
  emit();
  const j = jobs.find((x) => x.id === id);
  if (!j) return;
  if (j.status === 'done') db.jobs.delete(id).catch(() => {});
  else if (PERSIST_KEYS.some((k) => k in p)) persist(j);
}

// 起動時: 前回終わらなかった処理を再開
let restored = false;
export async function restoreQueue() {
  if (restored) return;
  restored = true;
  try {
    const rows = await db.jobs.orderBy('createdAt').toArray();
    for (const r of rows) {
      if (jobs.some((j) => j.id === r.id)) continue;
      jobs.push({ ...r, status: 'waiting', label: '再開待ち', error: null, itemId: null });
    }
    if (rows.length) {
      emit();
      pump();
    }
  } catch {}
}

export function subscribe(fn) {
  listeners.add(fn);
  fn(jobs.map((j) => ({ ...j })));
  return () => listeners.delete(fn);
}

export function enqueue(files) {
  for (const file of files) {
    const job = { id: newId(), file, createdAt: Date.now(), status: 'waiting', label: '待機中', error: null, itemId: null };
    jobs.push(job);
    persist(job);
  }
  emit();
  pump();
}

// 登録済みアイテムの写真をAIで撮り直す
export function enqueueRedo(items) {
  for (const it of items) {
    if (jobs.some((j) => j.redoId === it.id && j.status !== 'done' && j.status !== 'error')) continue;
    const job = { id: newId(), redoId: it.id, createdAt: Date.now(), status: 'waiting', label: `${it.name}：待機中`, error: null, itemId: null };
    jobs.push(job);
    persist(job);
  }
  emit();
  pump();
}

async function redo(job) {
  try {
    const it = await db.items.get(job.redoId);
    if (!it) throw new Error('アイテムが削除されています');
    const src = it.original || it.image;
    // 古いアイテムはロゴなどのディテール情報が無いので、先に元写真から読み取る
    let info = {};
    if (!Array.isArray(it.details)) {
      patch(job.id, { label: `${it.name}：ロゴやディテールを確認中…` });
      const { item: t } = await api('tag', { image: await forAI(src) });
      info = { details: t.details, shownSide: t.shownSide, backDetail: t.backDetail };
      if (!it.brand && t.brand) Object.assign(info, { brand: t.brand, brandConfidence: t.brandConfidence });
      await db.items.update(it.id, info);
    }
    const { image, gallery } = await makeProductSet(src, { ...it, ...info }, { onStage: (l) => patch(job.id, { label: `${it.name}：${l}` }) });
    // ユーザーが自分で追加した写真（originalつき）は残し、AIが作った背面は作り直す
    const kept = (it.gallery || []).filter((g) => g.original);
    await db.items.update(it.id, { image, gallery: [...gallery, ...kept], original: src, photoVersion: PHOTO_VERSION });
    patch(job.id, { status: 'done', label: '撮り直し完了', itemId: it.id });
  } catch (e) {
    patch(job.id, { status: 'error', label: '失敗', error: e.message || String(e) });
  }
}

export function retry(id, opts = {}) {
  patch(id, { status: 'waiting', label: '待機中', error: null, ...opts });
  pump();
}

export function dismiss(id) {
  jobs = jobs.filter((j) => j.id !== id);
  db.jobs.delete(id).catch(() => {});
  emit();
}

export function clearFinished() {
  jobs = jobs.filter((j) => j.status !== 'done');
  emit();
}

function serialCut(fn) {
  const p = cutChain.then(fn, fn);
  cutChain = p.catch(() => {});
  return p;
}

function pump() {
  while (running < TAG_CONCURRENCY) {
    const job = jobs.find((j) => j.status === 'waiting');
    if (!job) return;
    running++;
    patch(job.id, { status: 'working' });
    process(job)
      .catch(() => {})
      .finally(() => {
        running--;
        pump();
      });
  }
}

async function process(job) {
  if (job.redoId) return redo(job);
  try {
    const profile = await getProfile();
    let { original, image, item } = job;
    if (!original) {
      original = await resize(job.file, 1600, { type: 'image/jpeg', quality: 0.88 });
      patch(job.id, { original });
    }
    // 1. 元の写真からAIで属性を解析
    if (!item) {
      patch(job.id, { label: 'AIが解析中…' });
      try {
        item = (await api('tag', { image: await forAI(original) })).item;
      } catch {
        item = (await api('tag', { image: await forAI(original) })).item; // 1回だけ再試行
      }
      patch(job.id, { item });
    }
    // 2. 写真を整える
    let photoNote = '';
    let gallery = job.gallery || [];
    if (!image) {
      const mode = job.forceMode || profile.photoMode || 'ai';
      if (mode === 'ai') {
        try {
          ({ image, gallery } = await makeProductSet(original, item, { onStage: (l) => patch(job.id, { label: l }) }));
        } catch (e) {
          photoNote = `商品写真化に失敗したため元の写真で登録（${e.message}）`;
          image = await resize(original, 900, { type: 'image/jpeg', quality: 0.88 });
        }
      } else if (mode === 'cutout') {
        patch(job.id, { label: '背景を切り抜き待ち…' });
        image = await serialCut(async () => {
          patch(job.id, { label: '背景を切り抜き中…' });
          try {
            const cut = await removeBg(original);
            return await resize(await trimTransparent(cut), 900, { type: 'image/png' });
          } catch {
            return await resize(original, 900, { type: 'image/jpeg', quality: 0.88 });
          }
        });
      } else {
        image = await resize(original, 900, { type: 'image/jpeg', quality: 0.88 });
      }
      patch(job.id, { image, gallery });
    }
    const id = newId();
    // アイテム保存とキュー削除を同時に行い、リロード時の二重登録を防ぐ
    await db.transaction('rw', db.items, db.jobs, async () => {
      await db.jobs.delete(job.id);
      await db.items.add({
      ...item,
      isFixed: false,
      id,
      image,
      gallery,
      original,
      createdAt: Date.now(),
      wearCount: 0,
      lastWornAt: null,
      unchecked: true,
      photoVersion: photoNote ? 0 : (job.forceMode || profile.photoMode) === 'ai' ? PHOTO_VERSION : 0,
      });
    });
    patch(job.id, { status: 'done', label: photoNote ? '登録完了（元写真）' : '登録完了', note: photoNote, itemId: id, file: null });
  } catch (e) {
    patch(job.id, { status: 'error', label: '失敗', error: e.message || String(e) });
  }
}

// 手入力で登録するときの画像（解析だけ失敗したジョブ用）
export function jobImages(id) {
  const j = jobs.find((x) => x.id === id);
  return j ? { image: j.image || j.original, original: j.original, item: j.item, gallery: j.gallery || [] } : {};
}
