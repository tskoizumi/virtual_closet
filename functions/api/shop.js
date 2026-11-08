import { handler, generateJSON, imagePart, stylistSystem, ITEM_SCHEMA } from '../../lib/gemini.js';

// 買う候補のスクショ → 手持ちとの照合
export const onRequestPost = handler(async (body, env) => {
  const { closet = [], profile = {} } = body;
  const { result, model } = await generateJSON(env, {
    system: stylistSystem(profile),
    temperature: 0.4,
    parts: [
      imagePart(body.image),
      {
        text: `この画像はユーザーが買うか迷っている商品（ECサイトのスクショか店頭の写真）。
1. product: 商品の属性を読み取る（価格が写っていれば notes に書く）
2. similar: 手持ちの中で「似たものをもう持っている」と言えるアイテムだけ（なければ空配列）
3. outfits: この商品＋手持ちで成立するコーデを、実際に着られる組み合わせだけ最大12個。itemIds には手持ちのIDだけを入れる（商品自体は含めない）。各コーデは、商品を含めて tops・bottoms・shoes が揃うこと
4. verdict: 「買い」「検討」「見送り」のどれか
5. summary: 判断理由を2〜3文。忖度せず正直に

## 手持ちアイテム（JSON）
${JSON.stringify(closet)}`,
      },
    ],
    schema: {
      type: 'OBJECT',
      properties: {
        product: ITEM_SCHEMA,
        similar: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: { id: { type: 'STRING' }, reason: { type: 'STRING' } },
            required: ['id', 'reason'],
          },
        },
        outfits: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: { itemIds: { type: 'ARRAY', items: { type: 'STRING' } }, reason: { type: 'STRING' } },
            required: ['itemIds', 'reason'],
          },
        },
        verdict: { type: 'STRING', enum: ['買い', '検討', '見送り'] },
        summary: { type: 'STRING' },
      },
      required: ['product', 'similar', 'outfits', 'verdict', 'summary'],
    },
  });
  return { ...result, model };
});
