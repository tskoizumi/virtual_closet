// サーバー(Cloudflare Pages Functions)経由でGeminiを呼ぶ

export function getPasscode() {
  try {
    return localStorage.getItem('vc_passcode') || '';
  } catch {
    return '';
  }
}
export function setPasscode(v) {
  try {
    localStorage.setItem('vc_passcode', v);
  } catch {}
}

export async function api(path, body) {
  let res;
  try {
    res = await fetch(`/api/${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { 'content-type': 'application/json', 'x-app-passcode': getPasscode() },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw new Error('サーバーに接続できませんでした（通信環境を確認してください）');
  }
  let json;
  try {
    json = await res.json();
  } catch {
    throw new Error(`サーバーの応答が不正です (HTTP ${res.status})`);
  }
  if (!res.ok || json.error) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}
