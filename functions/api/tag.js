import { handler, generateJSON, imagePart, ITEM_SCHEMA } from '../../lib/gemini.js';

// 服の写真 → 属性タグ
const ROLE_TEXT = { back: '背面', detail: '部分アップ', tag: 'タグ', styling: '着こなしの見本', worn: '着用写真' };

export const onRequestPost = handler(async (body, env) => {
  // extras: 同じアイテムの追加写真（背面・ディテール・タグなど）。属性やブランドの判断材料にする
  const extras = (Array.isArray(body.extras) ? body.extras : []).slice(0, 6);
  const extraParts = extras.flatMap((x, i) => [
    { text: `追加写真${i + 1}（同じアイテムの${ROLE_TEXT[x.role] || '別の写真'}${x.note ? `: ${x.note}` : ''}）` },
    imagePart(x.image),
  ]);
  const { result, model } = await generateJSON(env, {
    temperature: 0.2,
    speed: 'fast',
    system: 'あなたはアパレルの商品登録担当。写真の服・靴・小物を1点だけ正確に分類し、日本語で属性を返す。',
    parts: [
      { text: 'メインの写真' },
      imagePart(body.image),
      ...extraParts,
      {
        text: `${extras.length ? 'メインの写真のアイテム1点の属性を、追加写真（同じアイテムの別角度・部分アップ・タグ）も参考にして返して。タグにブランド名や素材表示が読めればそれを優先する。' : 'この写真の主なアイテム1点の属性を返して。'}
- category: tops(シャツ・Tシャツ・ニット等) / outer(ジャケット・コート等) / bottoms / shoes / bag / accessory(ピアス・ブレス・時計・帽子・ベルト等) / other
- formality: 1=部屋着 2=ラフ 3=カジュアル 4=きれいめ 5=フォーマル
- warmth: 1=真夏向け 〜 5=真冬向け（素材と厚みで判断）
- seasons: 着られる季節をすべて
- brand: ロゴ・刺繍・ワッペン・タグ・プリント文字・金具の刻印・特徴的なデザイン（チェック柄、ステッチ、シルエットなど）から判断。確信がなくても有力な候補があれば入れて brandConfidence=guess。手がかりが無ければ空文字で unknown
- details: 胸のワンポイントロゴなど小さな目印も含めて、位置・大きさ・色つきですべて書き出す（あとで商品写真を作り直すときに再現するため）
- details: 追加写真の裏地・ボタン・金具などの特徴も含める
- shownSide / backDetail: メインの写真に写っている面と、背面に特徴的なデザインが見えていればその説明（追加写真に背面があればそれも見る）`,
      },
    ],
    schema: ITEM_SCHEMA,
  });
  return { item: result, model };
});
