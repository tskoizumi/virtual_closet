import { handler, generateJSON, imagePart, ITEM_SCHEMA, HttpError } from '../../lib/gemini.js';

// コーデ写真（着用写真）→ 写っているアイテムを全部検出
export const onRequestPost = handler(async (body, env) => {
  const { closet = [] } = body;
  if (!body.image) throw new HttpError(400, '画像がありません');
  const detected = {
    ...ITEM_SCHEMA,
    properties: {
      ...ITEM_SCHEMA.properties,
      box_2d: {
        type: 'ARRAY',
        items: { type: 'INTEGER' },
        description: 'アイテムを囲む枠 [ymin, xmin, ymax, xmax]（画像全体を0〜1000に正規化）',
      },
      matchId: { type: 'STRING', description: '手持ちに同じアイテムがあればそのID。なければ空文字' },
      visibility: { type: 'STRING', enum: ['全体が見える', '一部が隠れている'] },
    },
    required: [...ITEM_SCHEMA.required, 'box_2d', 'matchId', 'visibility'],
  };
  const { result, model } = await generateJSON(env, {
    temperature: 0.2,
    system: 'あなたはアパレルの商品登録担当。着用写真から身につけているアイテムを正確に検出する。',
    parts: [
      imagePart(body.image),
      {
        text: `この写真の人物が身につけているアイテムをすべて検出して（トップス・アウター・ボトムス・靴・バッグ・帽子・アクセサリー・時計など）。
- 1アイテム1要素。重ね着はそれぞれ別に（例: ジャケットとその下のシャツ）
- 写っていない・判別できないものは出さない。推測で作らない
- box_2d はそのアイテムだけを囲む枠
- 手持ちアイテム（下のJSON）と同じものだと強く言える場合だけ matchId にIDを入れる。迷ったら空文字

## 手持ちアイテム
${JSON.stringify(closet)}`,
      },
    ],
    schema: {
      type: 'OBJECT',
      properties: { items: { type: 'ARRAY', items: detected } },
      required: ['items'],
    },
  });
  return { ...result, model };
});
