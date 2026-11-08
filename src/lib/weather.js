// Open-Meteo（APIキー不要）で今日の天気を取得

const CODES = {
  0: '快晴', 1: '晴れ', 2: '晴れ時々曇り', 3: '曇り', 45: '霧', 48: '霧',
  51: '霧雨', 53: '霧雨', 55: '霧雨', 56: '着氷性の霧雨', 57: '着氷性の霧雨',
  61: '小雨', 63: '雨', 65: '大雨', 66: '着氷性の雨', 67: '着氷性の雨',
  71: '小雪', 73: '雪', 75: '大雪', 77: '霧雪', 80: 'にわか雨', 81: 'にわか雨', 82: '激しいにわか雨',
  85: 'にわか雪', 86: '激しいにわか雪', 95: '雷雨', 96: '雷雨（ひょう）', 99: '雷雨（ひょう）',
};

function position(timeout = 8000) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('位置情報が使えません'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude, label: '現在地' }),
      (e) => reject(e),
      { timeout, maximumAge: 30 * 60 * 1000 }
    );
  });
}

// 地名 → 座標。日本語の地名に強い OpenStreetMap(Nominatim)を優先し、ダメなら Open-Meteo
const geoCache = {};
async function geocode(city) {
  const q = (city || '東京').trim();
  if (geoCache[q]) return geoCache[q];
  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1&accept-language=ja`
    );
    const g = (await r.json())[0];
    if (g) return (geoCache[q] = { lat: Number(g.lat), lon: Number(g.lon), label: q });
  } catch {}
  const r = await fetch(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=1&language=ja&format=json`
  );
  const j = await r.json();
  const g = j.results?.[0];
  if (!g) throw new Error(`「${q}」の場所が見つかりませんでした（設定で地名を変えてください）`);
  return (geoCache[q] = { lat: g.latitude, lon: g.longitude, label: g.name });
}

export async function getWeather(city) {
  let loc;
  try {
    loc = await position();
  } catch {
    loc = await geocode(city || '東京');
  }
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}` +
    `&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code` +
    `&timezone=auto&forecast_days=1`;
  const r = await fetch(url);
  if (!r.ok) throw new Error('天気の取得に失敗しました');
  const j = await r.json();
  const code = j.daily.weather_code[0];
  return {
    place: loc.label,
    current: Math.round(j.current.temperature_2m),
    tempMax: Math.round(j.daily.temperature_2m_max[0]),
    tempMin: Math.round(j.daily.temperature_2m_min[0]),
    precipProb: j.daily.precipitation_probability_max?.[0] ?? null,
    code,
    weatherText: CODES[code] || '不明',
    rainy: code >= 51,
  };
}
