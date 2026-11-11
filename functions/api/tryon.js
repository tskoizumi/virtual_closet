import { handler, generateImage, imagePart, HttpError } from '../../lib/gemini.js';

// 本人の写真＋アイテム画像 → 着用イメージ
export const onRequestPost = handler(async (body, env) => {
  const { person, items = [], styling = '' } = body;
  if (!person) throw new HttpError(400, '本人の写真がありません（設定タブで登録してください）');
  if (items.length === 0) throw new HttpError(400, 'アイテムがありません');

  const parts = [{ text: '1枚目: 本人の写真' }, imagePart(person)];
  items.slice(0, 8).forEach((it, i) => {
    parts.push({ text: `${i + 2}枚目: ${it.name || 'アイテム'}` });
    parts.push(imagePart(it));
  });
  parts.push({
    text: `1枚目の人物が、2枚目以降のアイテムをすべて身につけた全身写真を1枚生成して。
- 顔・髪型・体型・肌の色は1枚目の人物のまま変えない
- 各アイテムの色・柄・素材・形・ロゴは参照画像に忠実に。参照にないアイテムを足さない
- 参照画像にモデルが写っていても、参考にするのは服だけ（モデルの体や顔は使わない）
- 着こなし: ${styling || '自然に'}
- 背景はシンプルな明るい室内か白壁、全身が入る縦長の構図`,
  });
  const { image, model } = await generateImage(env, { parts });
  return { image, model };
});
