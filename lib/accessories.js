// 小物の種類ごとの撮り方（サーバーのプロンプトと、端末側の「着用カットを作るか」の判断で共用）
// still: メインのスチール撮影 / worn: 2枚目の着用カット（null なら作らない）
export const ACCESSORY_KINDS = [
  {
    key: 'earring',
    match: /ピアス|イヤリング|イヤーカフ|earring|ear ?cuff/i,
    still: '左右一対を少し間隔をあけて並べた、真上または正面からのマクロ撮影。留め具（ポスト・フック）の形も分かるように',
    worn: 'モデルの耳元に寄ったクロップ（耳と顎のライン・首すじ程度。目より上と顔全体は写さない）。髪は耳にかけて、ピアスがはっきり見える',
  },
  {
    key: 'necklace',
    match: /ネックレス|ペンダント|チョーカー|necklace|pendant|choker/i,
    still: 'チェーンを自然なU字の曲線に広げて置いた真上からの撮影。ペンダントトップは中央、留め具も見える',
    worn: 'モデルの首元〜鎖骨に寄ったクロップ（口元より上は写さない）。無地の襟ぐりの開いたトップスで、ネックレスが主役',
  },
  {
    key: 'ring',
    match: /リング|指輪|ring\b/i,
    still: '指輪を立てて少し斜めから、正面の意匠と厚みが分かるマクロ撮影',
    worn: 'モデルの手元に寄ったクロップ。指を自然に揃えて、指輪がはっきり見える',
  },
  {
    key: 'bracelet',
    match: /ブレス|バングル|アンクレット|bracelet|bangle|anklet/i,
    still: '輪の形を保って立てた、少し斜め上からのマクロ撮影。留め具や刻印も見える',
    worn: 'モデルの手首に寄ったクロップ（手首〜前腕）。袖は短いか、まくって手首が見える',
  },
  {
    key: 'watch',
    match: /時計|ウォッチ|watch/i,
    still: '文字盤を正面に向け、ベルトを丸く自然に立たせた公式サイト定番のスチール撮影。針は10時10分。文字盤のロゴ・インデックス・リューズを正確に',
    worn: 'モデルの手首に寄ったクロップ。文字盤がこちらを向き、袖口から少しのぞく',
  },
  {
    key: 'hat',
    match: /帽子|キャップ|ハット|ニット帽|ビーニー|ベレー|バケット|hat|cap|beanie|beret/i,
    still: '形をきれいに張らせた斜め前45度からのスチール撮影。つば・クラウン・ロゴの位置が分かる',
    worn: 'モデルがかぶった状態を、帽子の上端から口元までのクロップで（目元は帽子のつばの影か、フレームの外）。帽子のロゴは正面',
  },
  {
    key: 'eyewear',
    match: /メガネ|眼鏡|サングラス|アイウェア|glasses|sunglass|eyewear/i,
    still: 'テンプルを開いて正面からやや斜めに置いたスチール撮影。レンズの色と映り込みを自然に、フレームの細部が分かる',
    worn: null,
  },
  {
    key: 'belt',
    match: /ベルト|belt/i,
    still: 'バックルを手前に、革を自然にゆるく巻いたスチール撮影。バックルの意匠と穴・ステッチが分かる',
    worn: 'モデルのウエストに寄ったクロップ（腰まわり）。無地のトップスをタックインしてベルトが主役',
  },
  {
    key: 'scarf',
    match: /マフラー|ストール|スカーフ|ネックウォーマー|scarf|stole|muffler/i,
    still: 'きれいに畳んで少しドレープを見せたスチール撮影。柄・フリンジ・素材感が分かる',
    worn: 'モデルの首元に巻いたクロップ（口元より上は写さない）。巻き方は自然に',
  },
  {
    key: 'gloves',
    match: /手袋|グローブ|glove/i,
    still: '左右一対を少しずらして重ねた真上からのスチール撮影',
    worn: null,
  },
  {
    key: 'socks',
    match: /靴下|ソックス|sock/i,
    still: '左右一対をまっすぐ平置きした真上からのスチール撮影。柄やロゴが見える',
    worn: null,
  },
  {
    key: 'tie',
    match: /ネクタイ|蝶ネクタイ|タイ\b|tie\b/i,
    still: '大剣を手前にきれいに巻いた、または縦にまっすぐ置いた真上からのスチール撮影',
    worn: 'モデルの首元〜胸元に寄ったクロップ（口元より上は写さない）。白か無地のシャツに結んだ状態',
  },
  {
    key: 'wallet',
    match: /財布|ウォレット|カードケース|キーケース|ポーチ|wallet|card ?case/i,
    still: '正面から少し斜めに立てたスチール撮影。金具・刻印・ステッチが分かる',
    worn: null,
  },
];

const FALLBACK = {
  key: 'other',
  still: '小物のスチール撮影。画面に大きく、質感と細部がはっきり分かるマクロ寄りの構図',
  worn: null,
};

export function accessoryKind({ name = '', subcategory = '' } = {}) {
  const text = `${subcategory} ${name}`;
  return ACCESSORY_KINDS.find((k) => k.match.test(text)) || FALLBACK;
}

// 着用カット（2枚目）を作る小物か
export function hasWornShot(item) {
  return (item.category === 'accessory' || item.category === 'other') && !!accessoryKind(item).worn && accessoryKind(item).key !== 'other';
}
