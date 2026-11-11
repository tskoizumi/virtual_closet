import { handler, generateJSON, imagePart, ITEM_SCHEMA } from '../../lib/gemini.js';

// 服の写真 → 属性タグ
export const onRequestPost = handler(async (body, env) => {
  const { result, model } = await generateJSON(env, {
    temperature: 0.2,
    speed: 'fast',
    system: 'あなたはアパレルの商品登録担当。写真の服・靴・小物を1点だけ正確に分類し、日本語で属性を返す。',
    parts: [
      imagePart(body.image),
      {
        text: `この写真の主なアイテム1点の属性を返して。
- category: tops(シャツ・Tシャツ・ニット等) / outer(ジャケット・コート等) / bottoms / shoes / bag / accessory(ピアス・ブレス・時計・帽子・ベルト等) / other
- formality: 1=部屋着 2=ラフ 3=カジュアル 4=きれいめ 5=フォーマル
- warmth: 1=真夏向け 〜 5=真冬向け（素材と厚みで判断）
- seasons: 着られる季節をすべて
- brand: ロゴ・刺繍・ワッペン・タグ・プリント文字・金具の刻印・特徴的なデザイン（チェック柄、ステッチ、シルエットなど）から判断。確信がなくても有力な候補があれば入れて brandConfidence=guess。手がかりが無ければ空文字で unknown
- details: 胸のワンポイントロゴなど小さな目印も含めて、位置・大きさ・色つきですべて書き出す（あとで商品写真を作り直すときに再現するため）
- shownSide / backDetail: 写真に写っている面と、背面に特徴的なデザインが見えていればその説明`,
      },
    ],
    schema: ITEM_SCHEMA,
  });
  return { item: result, model };
});
