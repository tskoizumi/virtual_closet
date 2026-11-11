import { json, textModels, imageModels, liteModels } from '../../lib/gemini.js';

export async function onRequestGet({ env }) {
  return json({
    ok: true,
    hasKey: Boolean(env.GEMINI_API_KEY),
    hasDB: Boolean(env.DB),
    passcodeRequired: Boolean(env.APP_PASSCODE),
    textModels: textModels(env),
    liteModels: liteModels(env),
    imageModels: imageModels(env),
  });
}
