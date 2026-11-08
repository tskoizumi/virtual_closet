// コーデ候補の絞り込み（コード側のルール）と、AI出力の検証

export const CATEGORY_LABEL = {
  tops: 'トップス',
  outer: 'アウター',
  bottoms: 'ボトムス',
  shoes: '靴',
  bag: 'バッグ',
  accessory: '小物・アクセ',
  other: 'その他',
};
export const REQUIRED = ['tops', 'bottoms', 'shoes'];

export const OCCASIONS = [
  { key: '学校', range: [2, 4] },
  { key: '遊び', range: [1, 4] },
  { key: 'デート', range: [2, 5] },
  { key: '買い物', range: [1, 4] },
  { key: 'バイト・部活', range: [1, 3] },
  { key: 'フォーマル', range: [4, 5] },
  { key: '家でゆっくり', range: [1, 2] },
];

export function warmthWindow(tMax, tMin) {
  const t = (tMax * 2 + tMin) / 3; // 日中寄りの体感
  if (t >= 26) return [1, 2];
  if (t >= 21) return [1, 3];
  if (t >= 16) return [2, 4];
  if (t >= 11) return [2, 5];
  return [3, 5];
}

export function buildCandidates(items, { weather, occasion, mustInclude = [], recentDays = 3 }) {
  const notes = [];
  const pool = items.filter((i) => !i.isFixed);
  const [wLo, wHi] = warmthWindow(weather.tempMax, weather.tempMin);
  const occ = OCCASIONS.find((o) => o.key === occasion);
  const [fLo, fHi] = occ ? occ.range : [1, 5];
  const needOuter = weather.tempMax < 20;
  const recentLimit = Date.now() - recentDays * 86400000;

  const pass = (i, widen) => {
    if (mustInclude.includes(i.id)) return true;
    const fOk = i.formality >= fLo - widen && i.formality <= fHi + widen;
    if (!fOk) return false;
    if (i.category === 'tops' || i.category === 'bottoms') return i.warmth >= wLo - widen && i.warmth <= wHi + widen;
    if (i.category === 'outer') return needOuter && i.warmth >= wLo - 1 - widen;
    return true;
  };

  let widen = 0;
  let cands = pool.filter((i) => pass(i, 0));
  while (widen < 2 && REQUIRED.some((c) => !cands.some((i) => i.category === c))) {
    widen++;
    cands = pool.filter((i) => pass(i, widen));
  }
  if (widen > 0) notes.push(`条件に合う服が少ないため、気温・シチュの条件を${widen}段階ゆるめました`);

  const missing = REQUIRED.filter((c) => !cands.some((i) => i.category === c));
  return {
    candidates: cands.map((i) => ({ ...i, recent: !!(i.lastWornAt && i.lastWornAt > recentLimit) })),
    missing,
    notes,
    needOuter,
  };
}

// AIのコーデ案を検証。問題があれば理由を返す
export function validateOutfit(itemIds, byId, { mustInclude = [], extraCategories = [] } = {}) {
  const problems = [];
  const unknown = itemIds.filter((id) => !byId[id]);
  if (unknown.length) problems.push(`存在しないID: ${unknown.join(', ')}`);
  const ids = [...new Set(itemIds.filter((id) => byId[id]))];
  const cats = new Set([...ids.map((id) => byId[id].category), ...extraCategories]);
  const lack = REQUIRED.filter((c) => !cats.has(c));
  if (lack.length) problems.push(`${lack.map((c) => CATEGORY_LABEL[c]).join('・')}が入っていない`);
  const lackMust = mustInclude.filter((id) => !ids.includes(id));
  if (lackMust.length) problems.push(`必ず入れるアイテム(${lackMust.join(', ')})が入っていない`);
  return { ok: problems.length === 0, ids, problems };
}

export function historyLines(outfits, byId, limit = 15) {
  return outfits
    .filter((o) => o.rating || o.worn)
    .slice(0, limit)
    .map((o) => {
      const mark = [o.rating === 'up' ? '👍' : o.rating === 'down' ? '👎' : '', o.worn ? '着た' : '']
        .filter(Boolean)
        .join(' ');
      const names = o.itemIds.map((id) => byId[id]?.name || '(削除済み)').join(' / ');
      const note = o.feedbackNote ? ` 理由:「${o.feedbackNote}」` : '';
      return `- ${new Date(o.createdAt).toLocaleDateString('ja-JP')} ${mark}: ${names}${note}`;
    });
}
