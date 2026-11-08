// 服の一括登録キュー。画面を移動しても裏で処理を続け、終わったものから自動でクローゼットに保存する
import { db, newId, getProfile } from './db.js';
import { resize, removeBg, trimTransparent, forAI } from './image.js';
import { api } from './api.js';
import { makeProductPhoto } from './productPhoto.js';

const TAG_CONCURRENCY = 3;
let jobs = [];
const listeners = new Set();
let running = 0;
let cutChain = Promise.resolve(); // 背景切り抜きは重いので1枚ずつ

function emit() {
  const snap = jobs.map((j) => ({ ...j }));
  listeners.forEach((l) => l(snap));
}
function patch(id, p) {
  jobs = jobs.map((j) => (j.id === id ? { ...j, ...p } : j));
  emit();
}

export function subscribe(fn) {
  listeners.add(fn);
  fn(jobs.map((j) => ({ ...j })));
  return () => listeners.delete(fn);
}

export function enqueue(files) {
  for (const file of files) jobs.push({ id: newId(), file, status: 'waiting', label: '待機中', error: null, itemId: null });
  emit();
  pump();
}

// 登録済みアイテムの写真をAIで撮り直す
export function enqueueRedo(items) {
  for (const it of items) {
    if (jobs.some((j) => j.redoId === it.id && j.status !== 'done' && j.status !== 'error')) continue;
    jobs.push({ id: newId(), redoId: it.id, status: 'waiting', label: `${it.name}：待機中`, error: null, itemId: null });
  }
  emit();
  pump();
}

async function redo(job) {
  try {
    const it = await db.items.get(job.redoId);
    if (!it) throw new Error('アイテムが削除されています');
    const src = it.original || it.image;
    const image = await makeProductPhoto(src, {
      name: it.name,
      category: it.category,
      brand: it.brand,
      onStage: (l) => patch(job.id, { label: `${it.name}：${l}` }),
    });
    await db.items.update(it.id, { image, original: src, photoVersion: 2 });
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
    if (!image) {
      const mode = job.forceMode || profile.photoMode || 'ai';
      if (mode === 'ai') {
        try {
          image = await makeProductPhoto(original, {
            name: item.name,
            category: item.category,
            brand: item.brand,
            onStage: (l) => patch(job.id, { label: l }),
          });
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
      patch(job.id, { image });
    }
    const id = newId();
    await db.items.add({
      ...item,
      isFixed: false,
      id,
      image,
      original,
      createdAt: Date.now(),
      wearCount: 0,
      lastWornAt: null,
      unchecked: true,
      photoVersion: photoNote ? 0 : (job.forceMode || profile.photoMode) === 'ai' ? 2 : 0,
    });
    patch(job.id, { status: 'done', label: photoNote ? '登録完了（元写真）' : '登録完了', note: photoNote, itemId: id, file: null });
  } catch (e) {
    patch(job.id, { status: 'error', label: '失敗', error: e.message || String(e) });
  }
}

// 手入力で登録するときの画像（解析だけ失敗したジョブ用）
export function jobImages(id) {
  const j = jobs.find((x) => x.id === id);
  return j ? { image: j.image || j.original, original: j.original, item: j.item } : {};
}
