import { handler, generateJSON, imagePart, stylistSystem } from '../../lib/gemini.js';

// 自分のコーデ写真 → 手持ちを踏まえた相談
export const onRequestPost = handler(async (body, env) => {
  const { closet = [], profile = {}, question = '' } = body;
  const { result, model } = await generateJSON(env, {
    system: stylistSystem(profile),
    temperature: 0.6,
    parts: [
      imagePart(body.image),
      {
        text: `ユーザーが今日のコーデ写真を見せて相談している。
相談内容: ${question || '（特になし。率直に評価して）'}

- comment: 全体の評価を2〜3文。良いところも悪いところも正直に
- good_points: 良い点（最大3）
- improvements: 改善案（最大3）。手持ちのアイテムに替えると良くなる場合は swapInId にそのIDを入れる（手持ちにない場合は空文字）
- styling_tip: 今すぐできる着こなしの小技を1文

## 手持ちアイテム（JSON）
${JSON.stringify(closet)}`,
      },
    ],
    schema: {
      type: 'OBJECT',
      properties: {
        comment: { type: 'STRING' },
        good_points: { type: 'ARRAY', items: { type: 'STRING' } },
        improvements: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: { suggestion: { type: 'STRING' }, swapInId: { type: 'STRING' } },
            required: ['suggestion', 'swapInId'],
          },
        },
        styling_tip: { type: 'STRING' },
      },
      required: ['comment', 'good_points', 'improvements', 'styling_tip'],
    },
  });
  return { ...result, model };
});
