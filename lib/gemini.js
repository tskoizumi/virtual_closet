// Gemini API 中継ヘルパー（Cloudflare Pages Functions 用）
// APIキーはサーバー側の環境変数 GEMINI_API_KEY にだけ置く。データは保存しない。

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

const DEFAULT_TEXT_MODELS = ['gemini-flash-latest', 'gemini-3-flash-preview', 'gemini-2.5-flash'];
const DEFAULT_IMAGE_MODELS = ['gemini-3.1-flash-image', 'gemini-3.1-flash-image-preview', 'gemini-2.5-flash-image'];

export function textModels(env) {
  return env.GEMINI_MODEL ? [env.GEMINI_MODEL] : DEFAULT_TEXT_MODELS;
}
export function imageModels(env) {
  return env.GEMINI_IMAGE_MODEL ? [env.GEMINI_IMAGE_MODEL] : DEFAULT_IMAGE_MODELS;
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function isModelMissing(status, text) {
  if (status === 404) return true;
  if (status === 400 && /not found|not supported|is not available|unknown model/i.test(text)) return true;
  return false;
}

async function post(env, model, body) {
  const res = await fetch(`${API_BASE}/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { res, text };
}

// モデル候補を順に試す（存在しないモデルだけスキップ。それ以外のエラーはそのまま返す）
async function callWithFallback(env, models, body) {
  if (!env.GEMINI_API_KEY) throw new HttpError(500, 'サーバーに GEMINI_API_KEY が設定されていません');
  const tried = [];
  for (const model of models) {
    const { res, text } = await post(env, model, body);
    if (res.ok) return { model, data: JSON.parse(text) };
    if (isModelMissing(res.status, text)) {
      tried.push(model);
      continue;
    }
    let msg = text;
    try {
      msg = JSON.parse(text).error?.message || text;
    } catch {}
    throw new HttpError(res.status === 429 ? 429 : 502, `Gemini APIエラー (${model}, ${res.status}): ${msg}`);
  }
  throw new HttpError(502, `使えるモデルが見つかりません（試行: ${tried.join(', ')}）。環境変数でモデル名を指定してください`);
}

export function imagePart(img) {
  if (!img || !img.data) throw new HttpError(400, '画像がありません');
  return { inline_data: { mime_type: img.mime || 'image/jpeg', data: img.data } };
}

// JSONで返すテキスト生成
export async function generateJSON(env, { system, parts, schema, temperature = 0.7 }) {
  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig: {
      temperature,
      responseMimeType: 'application/json',
      responseSchema: schema,
    },
  };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  const { model, data } = await callWithFallback(env, textModels(env), body);
  const cand = data.candidates?.[0];
  const text = cand?.content?.parts?.map((p) => p.text || '').join('') || '';
  if (!text) {
    const reason = cand?.finishReason || data.promptFeedback?.blockReason || '不明';
    throw new HttpError(502, `AIが空の応答を返しました（理由: ${reason}）`);
  }
  try {
    return { model, result: JSON.parse(text) };
  } catch {
    throw new HttpError(502, 'AIの応答をJSONとして読めませんでした');
  }
}

// 画像生成
export async function generateImage(env, { parts }) {
  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
  };
  const { model, data } = await callWithFallback(env, imageModels(env), body);
  const cand = data.candidates?.[0];
  const out = cand?.content?.parts || [];
  const img = out.find((p) => p.inlineData || p.inline_data);
  if (!img) {
    const note = out.map((p) => p.text || '').join(' ').trim();
    const reason = cand?.finishReason || data.promptFeedback?.blockReason || '不明';
    throw new HttpError(502, `画像が生成されませんでした（理由: ${reason}${note ? ' / ' + note.slice(0, 200) : ''}）`);
  }
  const d = img.inlineData || img.inline_data;
  return { model, image: { mime: d.mimeType || d.mime_type || 'image/png', data: d.data } };
}

export function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export function handler(fn) {
  return async (ctx) => {
    try {
      let body = {};
      if (ctx.request.method === 'POST') {
        try {
          body = await ctx.request.json();
        } catch {
          throw new HttpError(400, 'リクエストがJSONではありません');
        }
      }
      const out = await fn(body, ctx.env, ctx);
      return json(out);
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      return json({ error: e.message || String(e) }, status);
    }
  };
}

// ---- 共通スキーマ ----
export const CATEGORIES = ['tops', 'outer', 'bottoms', 'shoes', 'bag', 'accessory', 'other'];
export const SEASONS = ['spring', 'summer', 'autumn', 'winter'];

export const ITEM_SCHEMA = {
  type: 'OBJECT',
  properties: {
    name: { type: 'STRING', description: '短い表示名。例: 白のオックスフォードシャツ' },
    category: { type: 'STRING', enum: CATEGORIES },
    subcategory: { type: 'STRING', description: '例: オックスフォードシャツ, スラックス, ローファー' },
    colors: { type: 'ARRAY', items: { type: 'STRING' } },
    material: { type: 'STRING' },
    pattern: { type: 'STRING', description: '無地, ストライプ, チェック など' },
    formality: { type: 'INTEGER', description: '1=部屋着 2=ラフ 3=カジュアル 4=きれいめ 5=フォーマル' },
    warmth: { type: 'INTEGER', description: '1=真夏向け 〜 5=真冬向け' },
    seasons: { type: 'ARRAY', items: { type: 'STRING', enum: SEASONS } },
    notes: { type: 'STRING', description: 'シルエットや特徴など一言' },
  },
  required: ['name', 'category', 'subcategory', 'colors', 'material', 'pattern', 'formality', 'warmth', 'seasons', 'notes'],
};

export function stylistSystem(profile = {}) {
  const persona = profile.personaPrompt || 'バランス型のスタイリスト。手持ちの服を活かし、清潔感と少しのこなれ感を両立させる。';
  const notes = profile.styleNotes ? `\nユーザーの好み・NG: ${profile.styleNotes}` : '';
  return `あなたはユーザー専属のファッションスタイリスト。日本語で、フランクだが的確に話す。
人格: ${persona}${notes}
ルール: 提案に使うのは必ずユーザーが実際に持っているアイテム（与えられたID）だけ。存在しないIDを作らない。`;
}
