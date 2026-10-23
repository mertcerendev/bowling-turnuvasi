import { randomUUID } from 'node:crypto';
import { redis, route } from '../lib/store.js';
import { isOver } from '../config.js';

export default route(async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST bekleniyor' });
  const name = String(req.body?.name ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 24);
  if (name.length < 2) return res.status(400).json({ error: 'Adını yaz (en az 2 harf)' });
  if (isOver()) return res.status(403).json({ error: 'Turnuva bitti, yeni oyun başlatılamaz' });

  const id = randomUUID();
  const game = { name, key: name.toLocaleLowerCase('tr-TR'), rolls: [], rack: null, last: null };
  await redis('SET', 'g:' + id, JSON.stringify(game), 'EX', 7200);
  res.json({ id, name });
});
