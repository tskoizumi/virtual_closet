import { handler, generateJSON, stylistSystem, HttpError } from '../../lib/gemini.js';

// 候補アイテム＋状況 → コーデ3案
export const onRequestPost = handler(async (body, env) => {
  const { candidates = [], images = [], context = {}, profile = {}, history = [], fixed = [], retryNote } = body;
  if (candidates.length === 0) throw new HttpError(400, '候補アイテムがありません');

  const parts = [];
  for (const im of images.slice(0, 40)) {
    parts.push({ text: `ID:${im.id}` });
    parts.push({ inline_data: { mime_type: im.mime || 'image/jpeg', data: im.data } });
  }
  parts.push({
    text: `今日のコーデを3案考えて。

## 状況
- 日付: ${context.date || ''}
- 天気: ${context.weatherText || '不明'} / 最高${context.tempMax}℃ 最低${context.tempMin}℃ / 降水確率${context.precipProb ?? '?'}%
- 行き先・シチュエーション: ${context.occasion || '特になし'}
- 今日着たいアイテムID（必ず含める）: ${(context.mustInclude || []).join(', ') || 'なし'}
- 補足: ${context.extra || 'なし'}

## 使えるアイテム（JSON。recent=trueは直近で着たので極力避ける）
${JSON.stringify(candidates)}

## 毎日つける固定アクセ（自動で追加されるので、itemIdsには含めない。相性だけ考慮）
${fixed.join(', ') || 'なし'}

## 過去のフィードバック（新しい順。好みの学習に使う）
${history.length ? history.join('\n') : 'まだなし'}

## 条件
- 各案に tops・bottoms・shoes を最低1点ずつ。寒ければ outer も。
- 3案はテイストや主役アイテムを変えて、被らせない。
- reason: なぜこの組み合わせか（気温・シチュ・色合わせ）を2文以内。
- styling_tip: 着崩しや小技（袖まくり、タックイン、前を開ける等）を1文。
- アイテムに styling があれば、それはユーザー本人のいつもの着こなし方。そのアイテムを使う案の styling_tip では基本それに沿う。
${retryNote ? `\n## 前回の出力の問題（必ず直すこと）\n${retryNote}` : ''}`,
  });

  const { result, model } = await generateJSON(env, {
    system: stylistSystem(profile),
    parts,
    temperature: 0.9,
    schema: {
      type: 'OBJECT',
      properties: {
        outfits: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              title: { type: 'STRING', description: '10文字程度のコーデ名' },
              itemIds: { type: 'ARRAY', items: { type: 'STRING' } },
              reason: { type: 'STRING' },
              styling_tip: { type: 'STRING' },
            },
            required: ['title', 'itemIds', 'reason', 'styling_tip'],
          },
        },
      },
      required: ['outfits'],
    },
  });
  return { ...result, model };
});
