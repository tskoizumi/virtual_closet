// 服の一括登録キュー。画面を移動しても裏で処理を続け、終わったものから自動でクローゼットに保存する
import { db, newId, getProfile } from './db.js';
import { resize, removeBg, trimTransparent, forAI } from './image.js';
import { api } from './api.js';
import { makeProductSet, plainGallery, PHOTO_VERSION } from './productPhoto.js';

const TAG_CONCURRENCY = 3;
let jobs = [];
const listeners = new Set();
let running = 0;
let cutChain = Promise.resolve(); // 背景切り抜きは重いので1枚ずつ

function emit() {
  const snap = jobs.map((j) => ({ ...j }));
  listeners.forEach((l) => l(snap));
}
const PERSIST_KEYS = ['file', 'extras', 'groupBatch', 'needsConfirm', 'groupName', 'redoId', 'original', 'image', 'gallery', 'item', 'forceMode', 'skipCut', 'createdAt'];
const GROUP_CHUNK = 30;
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
    const batches = new Set();
    for (const r of rows) {
      if (jobs.some((j) => j.id === r.id)) continue;
      if (r.groupBatch) batches.add(r.groupBatch);
      const status = r.groupBatch ? 'grouping' : r.needsConfirm ? 'confirm' : 'waiting';
      const label = { grouping: '同じ服の写真をまとめ中…', confirm: '同じ服か確認してください', waiting: '再開待ち' }[status];
      jobs.push({ ...r, status, label, error: null, itemId: null });
    }
    if (rows.length) {
      emit();
      batches.forEach((b) => groupBatch(b));
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
  files = [...files];
  // 2枚以上なら、同じ服の写真（角度違い・裏地やボタンのアップ・タグ・着こなし見本）を先にまとめる
  const batch = files.length >= 2 ? newId() : undefined;
  const now = Date.now();
  files.forEach((file, i) => {
    const job = {
      id: newId(), file, createdAt: now + i, error: null, itemId: null,
      status: batch ? 'grouping' : 'waiting', label: batch ? '同じ服の写真をまとめ中…' : '待機中', groupBatch: batch,
    };
    jobs.push(job);
    persist(job);
  });
  emit();
  if (batch) groupBatch(batch);
  else pump();
}

async function groupBatch(batch) {
  const list = jobs.filter((j) => j.groupBatch === batch && j.status === 'grouping');
  for (let i = 0; i < list.length; i += GROUP_CHUNK) {
    const chunk = list.slice(i, i + GROUP_CHUNK);
    try {
      if (chunk.length < 2) throw new Error('skip');
      const images = [];
      for (const j of chunk) images.push(await forAI(j.file, 512));
      const { groups } = await api('group', { images });
      for (const g of groups) {
        const main = g.photos.find((p) => p.role === 'main') || g.photos[0];
        const extras = g.photos
          .filter((p) => p !== main)
          .map((p) => ({ file: chunk[p.index].file, role: p.role, label: p.label, note: p.note }));
        const head = chunk[main.index];
        // メインのジョブに追加写真として持たせてから（保存も）、まとめた写真のジョブを消す。
        // 複数枚をまとめた場合は、本当に同じ服かユーザーに確認してから処理する
        patch(head.id, {
          status: extras.length ? 'confirm' : 'waiting', groupBatch: undefined, extras,
          needsConfirm: extras.length ? true : undefined, groupName: g.item || undefined,
          label: extras.length ? '同じ服か確認してください' : '待機中',
        });
        for (const p of g.photos) if (p !== main) {
          jobs = jobs.filter((j) => j.id !== chunk[p.index].id);
          db.jobs.delete(chunk[p.index].id).catch(() => {});
        }
      }
    } catch (e) {
      // まとめられなくても1枚ずつ登録は続ける
      const note = e.message === 'skip' ? '' : `（写真のまとめに失敗したので1枚ずつ登録: ${e.message}）`;
      for (const j of chunk) patch(j.id, { status: 'waiting', groupBatch: undefined, label: `待機中${note}` });
    }
  }
  emit();
  pump();
}

// 「同じ服ですか？」への回答
// keep: まとめたままにする追加写真の番号（extras の index）。それ以外は別のアイテムとして登録する
export function confirmGroup(id, keep) {
  const job = jobs.find((j) => j.id === id);
  if (!job || job.status !== 'confirm') return;
  const extras = job.extras || [];
  const keepSet = new Set(keep ?? extras.map((_, i) => i));
  const split = extras.filter((_, i) => !keepSet.has(i));
  const now = Date.now();
  // 外した写真は1枚ずつの新しいジョブに（先に保存してから元のジョブを更新）
  for (const [i, x] of split.entries()) {
    const nj = { id: newId(), file: x.file || x.image, createdAt: now + i, status: 'waiting', label: '待機中', error: null, itemId: null };
    jobs.push(nj);
    persist(nj);
  }
  const kept = extras.filter((_, i) => keepSet.has(i));
  patch(id, {
    status: 'waiting', needsConfirm: undefined, extras: kept,
    label: kept.length ? `待機中（${kept.length + 1}枚を1点として登録）` : '待機中',
  });
  pump();
}

export function confirmAll() {
  jobs.filter((j) => j.status === 'confirm').forEach((j) => confirmGroup(j.id));
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
    const { image, gallery } = await makeProductSet(src, { ...it, ...info }, { extras: it.photos || [], onStage: (l) => patch(job.id, { label: `${it.name}：${l}` }) });
    // ユーザーが自分で追加した写真（originalつき）は残し、AIが作った背面は作り直す
    const kept = (it.gallery || []).filter((g) => g.original);
    await db.items.update(it.id, { image, gallery: [...gallery, ...kept], original: src, photoVersion: PHOTO_VERSION });
    patch(job.id, { status: 'done', label: '撮り直し完了', itemId: it.id });
  } catch (e) {
    patch(job.id, { status: 'error', label: '失敗', error: e.message || String(e) });
  }
}

// 失敗したものをまとめて再試行
export function retryFailed() {
  jobs.filter((j) => j.status === 'error').forEach((j) => patch(j.id, { status: 'waiting', label: '待機中', error: null }));
  pump();
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
    // 同じアイテムの追加写真（縮小済みでなければ縮小して保存）
    let extras = job.extras || [];
    if (extras.some((x) => !x.image)) {
      const out = [];
      for (const x of extras) {
        const { file, ...rest } = x;
        out.push(x.image ? x : { ...rest, image: await resize(file, 1600, { type: 'image/jpeg', quality: 0.88 }) });
      }
      extras = out;
      patch(job.id, { extras });
    }
    // 1. 元の写真からAIで属性を解析
    if (!item) {
      patch(job.id, { label: 'AIが解析中…' });
      const ex = [];
      for (const x of extras.slice(0, 6)) ex.push({ image: await forAI(x.image, x.role === 'tag' ? 1024 : 768), role: x.role, note: x.note });
      try {
        item = (await api('tag', { image: await forAI(original), extras: ex })).item;
      } catch {
        item = (await api('tag', { image: await forAI(original), extras: ex })).item; // 1回だけ再試行
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
          ({ image, gallery } = await makeProductSet(original, item, { extras, onStage: (l) => patch(job.id, { label: l }) }));
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
      if (mode !== 'ai' || (photoNote && !gallery.length)) gallery = await plainGallery(extras);
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
      ...extraFields(extras),
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

// 追加写真から、アイテムに残すもの（元写真と着こなしメモ）
export function extraFields(extras) {
  if (!extras?.length) return {};
  const styling = extras.filter((x) => x.role === 'styling' && x.note).map((x) => x.note);
  return {
    photos: extras.map(({ image, role, label, note }) => ({ image, role, label: label || '', note: note || '' })),
    ...(styling.length ? { stylingNotes: styling.join(' / ') } : {}),
  };
}

// 手入力で登録するときの画像（解析だけ失敗したジョブ用）
export function jobImages(id) {
  const j = jobs.find((x) => x.id === id);
  return j ? { image: j.image || j.original, original: j.original, item: j.item, gallery: j.gallery || [], extra: extraFields((j.extras || []).filter((x) => x.image)) } : {};
}
