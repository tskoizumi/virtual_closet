import { json } from '../../lib/gemini.js';

// APP_PASSCODE が設定されていれば、合言葉なしのAPI呼び出しを拒否（APIキーの無断利用対策）
export async function onRequest(ctx) {
  const pass = ctx.env.APP_PASSCODE;
  const url = new URL(ctx.request.url);
  if (pass && url.pathname !== '/api/health') {
    if (ctx.request.headers.get('x-app-passcode') !== pass) {
      return json({ error: '合言葉が違います（設定タブで入力してください）' }, 401);
    }
  }
  return ctx.next();
}
