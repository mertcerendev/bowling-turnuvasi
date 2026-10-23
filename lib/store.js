// Upstash Redis'e REST üzerinden bağlanır. Vercel'de Storage sekmesinden "Upstash for Redis"
// projeye bağlanınca bu ortam değişkenleri otomatik eklenir.
const URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

export async function redis(...command) {
  if (!URL || !TOKEN) throw new Error('Veritabanı bağlı değil (KV_REST_API_URL / KV_REST_API_TOKEN yok)');
  const res = await fetch(URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(command),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data.result;
}

// Herkesin en iyi skoru: yüksek skor önde, eşitlikte o skoru daha önce yapan önde.
export async function getBoard() {
  const flat = (await redis('HGETALL', 'players')) || [];
  const list = [];
  for (let i = 1; i < flat.length; i += 2) list.push(JSON.parse(flat[i]));
  return list.sort((a, b) => b.best - a.best || a.at - b.at);
}

// Hataları JSON olarak döndürür ki oyun ekranı anlamlı bir mesaj gösterebilsin.
export const route = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Sunucu hatası: ' + err.message });
  }
};
