import { redis, route } from '../lib/store.js';

// GEÇİCİ: turnuva sonrası kontrol için son 2 saatin oyun kayıtlarını sadece okur, hiçbir şey silmez/değiştirmez.
// İnceleme bitince bu dosya kaldırılacak.
const SCRIPT = `local out = {}
for _, k in ipairs(redis.call('KEYS', 'g:*')) do
  table.insert(out, { k, redis.call('GET', k) or '', redis.call('TTL', k) })
end
return out`;

export default route(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const rows = (await redis('EVAL', SCRIPT, '0')) || [];
  const now = Date.now();
  const games = rows.map(([key, raw, ttl]) => {
    const g = raw ? JSON.parse(raw) : {};
    return {
      id: key.slice(2),
      name: g.name,
      rolls: g.rolls,
      done: g.last?.done ?? false,
      total: g.last?.total ?? null,
      input: g.last?.input ?? null,
      updated: now - (7200 - ttl) * 1000,
    };
  });
  res.json({ now, games });
});
