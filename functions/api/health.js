import { json, textModels, imageModels } from '../../lib/gemini.js';

export async function onRequestGet({ env }) {
  return json({
    ok: true,
    hasKey: Boolean(env.GEMINI_API_KEY),
    passcodeRequired: Boolean(env.APP_PASSCODE),
    textModels: textModels(env),
    imageModels: imageModels(env),
  });
}
