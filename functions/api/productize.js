import { handler, generateImage, imagePart } from '../../lib/gemini.js';

// 着用写真から切り出したアイテム → 白背景の商品写真風に整える
export const onRequestPost = handler(async (body, env) => {
  const { image, name = '' } = body;
  const { image: out, model } = await generateImage(env, {
    parts: [
      imagePart(image),
      {
        text: `この画像に写っている「${name || '服'}」だけを、白背景の平置き（靴や小物は置き撮り）の商品写真として1枚生成して。
- 色・柄・素材感・ボタンやロゴなどのディテールは元の画像に忠実に。新しい装飾を足さない
- 人物の体や他のアイテムは写さない
- 隠れて見えない部分は、見えている部分から自然に補完する`,
      },
    ],
  });
  return { image: out, model };
});
