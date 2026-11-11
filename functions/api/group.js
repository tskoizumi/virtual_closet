import { handler, generateJSON, imagePart, HttpError } from '../../lib/gemini.js';

// まとめて選んだ写真を「同じアイテムごと」に分け、各写真の役割（全体・背面・ディテール・タグ・着こなし見本）を判定する。
// anchor=true のときは、1枚目が登録済みアイテム、2枚目以降はすべてその追加写真として役割だけ判定する。
const ROLES = ['main', 'back', 'detail', 'tag', 'styling', 'worn'];
const MAX = 30;

const PHOTO = {
  type: 'OBJECT',
  properties: {
    index: { type: 'INTEGER', description: '写真の番号（0始まり）' },
    role: {
      type: 'STRING',
      enum: ROLES,
      description:
        'main=アイテム全体が分かる写真（グループに1枚） / back=背面全体 / detail=ボタン・金具・裏地・ロゴ・ステッチ・素材などの部分アップ / tag=ブランドタグ・洗濯表示・品質表示 / styling=着こなし方の見本（袖のまくり方・タックイン・前の開け方・巻き方など） / worn=身につけた状態の写真（小物の着用など）',
    },
    label: { type: 'STRING', description: '写真の短い見出し（8文字以内）。例: 裏地, ボタン, 胸ロゴ, ブランドタグ, 袖まくり' },
    note: {
      type: 'STRING',
      description: 'detail/tagなら写っている内容（例: 裏地はネイビーのペイズリー柄）。stylingなら着こなし方の具体的な説明（例: 袖を2回折って肘下までまくる）。それ以外は空文字',
    },
  },
  required: ['index', 'role', 'label', 'note'],
};

export const onRequestPost = handler(async (body, env) => {
  const { images = [], anchor = false } = body;
  if (!Array.isArray(images) || images.length < 2) throw new HttpError(400, '写真は2枚以上必要です');
  if (images.length > MAX) throw new HttpError(400, `写真は${MAX}枚までです`);

  const parts = [];
  images.forEach((im, i) => {
    parts.push({ text: `写真${i}${anchor && i === 0 ? '（登録済みのアイテム）' : ''}` });
    parts.push(imagePart(im));
  });

  if (anchor) {
    parts.push({
      text: `写真0は登録済みのアイテム。写真1以降はすべて、このアイテムの追加の写真としてユーザーが選んだもの。
写真1以降のそれぞれについて、役割(role)・見出し(label)・内容(note)を判定して。写真0は含めない。
- 写真0と同じアイテムの全体写真なら back か worn か detail のうち近いもの（main は使わない）`,
    });
    const { result, model } = await generateJSON(env, {
      temperature: 0.1,
      speed: 'fast',
      system: 'あなたはアパレルの商品登録担当。写真を見て、商品ページ用の写真の役割を正確に判定する。',
      parts,
      schema: { type: 'OBJECT', properties: { photos: { type: 'ARRAY', items: PHOTO } }, required: ['photos'] },
    });
    const seen = new Set();
    const photos = [];
    for (const p of result.photos || []) {
      const i = Number(p.index);
      if (!Number.isInteger(i) || i < 1 || i >= images.length || seen.has(i)) continue;
      seen.add(i);
      photos.push({ ...p, index: i, role: p.role === 'main' || !ROLES.includes(p.role) ? 'detail' : p.role });
    }
    for (let i = 1; i < images.length; i++) if (!seen.has(i)) photos.push({ index: i, role: 'detail', label: '追加写真', note: '' });
    return { photos: photos.sort((a, b) => a.index - b.index), model };
  }

  parts.push({
    text: `これらはユーザーがクローゼットに登録するためにまとめて選んだ写真。同じ服や小物を、角度違い・部分アップ（裏地・ボタン・ロゴ）・タグ・着こなし方の見本（袖のまくり方など）として複数枚撮っていることがある。
写真を「同じ1点のアイテム」ごとにグループ分けし、各写真の役割を判定して。

## ルール
- 全ての写真を、どれか1つのグループに必ず1回だけ入れる
- 同じグループにするのは、色・柄・素材・ディテールから「同じ1点の現物」だと確信できる場合だけ。似ているだけの別アイテム（色違い・別の白シャツなど）は別グループ
- 部分アップやタグの写真は、色・素材・柄・縫製から属するアイテムを判断する。どれとも判断できなければ単独のグループにする
- 各グループの main は、そのアイテム全体が一番よく分かる写真1枚（正面が望ましい）
- 着こなしの見本写真で、主役のアイテムが分かるならそのグループの styling に入れる
- 1枚に別々のアイテムが複数写っている写真（全身コーデなど）は、一番目立つアイテムのグループに入れる`,
  });
  const { result, model } = await generateJSON(env, {
    temperature: 0.1,
    system: 'あなたはアパレルの商品登録担当。写真を見て、同じ現物ごとに正確に仕分ける。',
    parts,
    schema: {
      type: 'OBJECT',
      properties: {
        groups: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: { item: { type: 'STRING', description: 'アイテムの短い名前' }, photos: { type: 'ARRAY', items: PHOTO } },
            required: ['item', 'photos'],
          },
        },
      },
      required: ['groups'],
    },
  });

  // 検証: 各写真がちょうど1回だけ現れ、各グループに main が1枚あるようにする
  const seen = new Set();
  const groups = [];
  for (const g of result.groups || []) {
    const photos = [];
    for (const p of g.photos || []) {
      const i = Number(p.index);
      if (!Number.isInteger(i) || i < 0 || i >= images.length || seen.has(i)) continue;
      seen.add(i);
      photos.push({ ...p, index: i, role: ROLES.includes(p.role) ? p.role : 'detail' });
    }
    if (!photos.length) continue;
    let mains = photos.filter((p) => p.role === 'main');
    if (!mains.length) {
      const pick = photos.find((p) => p.role === 'worn') || photos.find((p) => p.role !== 'styling' && p.role !== 'tag') || photos[0];
      pick.role = 'main';
      mains = [pick];
    }
    mains.slice(1).forEach((p) => (p.role = 'detail'));
    groups.push({ item: g.item || '', photos });
  }
  for (let i = 0; i < images.length; i++) {
    if (!seen.has(i)) groups.push({ item: '', photos: [{ index: i, role: 'main', label: '', note: '' }] });
  }
  return { groups, model };
});
