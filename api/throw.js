import { redis, getBoard, route } from '../lib/store.js';
import { isOver } from '../config.js';
import { simulate, freshRack, countPins, progress, frameScores, cleanInput } from '../bowling.js';

const JITTER = 0.004; // yeni dizilen lobutların konumundaki küçük oynama (m)
const NOISE = 0.05; // topun pistteki gizli küçük sapması (m/s); ancak atış yapıldıktan sonra açıklanır

// Tarayıcı sadece atış ayarlarını (konum, yön, güç, falso) gönderir.
// Kaç lobut devrildiğini ve skoru sunucu kendi simülasyonuyla hesaplar.
export default route(async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST bekleniyor' });
  const { id, n, input } = req.body ?? {};
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/.test(id)) return res.status(400).json({ error: 'Geçersiz oyun' });
  const raw = await redis('GET', 'g:' + id);
  if (!raw) return res.status(404).json({ error: 'Oyun bulunamadı ya da süresi doldu' });
  const game = JSON.parse(raw);

  // Bağlantı koptuğu için aynı atış tekrar gönderildiyse ilk sonucu aynen döndür.
  if (game.last && n === game.last.n) return res.json(game.last);
  if (n !== game.rolls.length || progress(game.rolls).done) return res.status(409).json({ error: 'Sıra dışı atış' });
  if (isOver()) return res.status(403).json({ error: 'Turnuva bitti, skor kabul edilmiyor' });

  const shot = cleanInput(input);
  const rack = game.rack ?? freshRack(JITTER);
  const noise = (Math.random() + Math.random() - 1) * NOISE;
  const { standing } = simulate(rack, shot, noise);
  game.rolls.push(countPins(rack) - countPins(standing));
  const p = progress(game.rolls);
  game.rack = p.fresh ? null : standing;
  const out = { n, input: shot, rack, noise, standing, rolls: game.rolls, done: p.done };

  if (p.done) {
    const total = frameScores(game.rolls)[9];
    const prev = JSON.parse((await redis('HGET', 'players', game.key)) ?? 'null');
    out.total = total;
    out.record = !prev || total > prev.best;
    if (out.record) {
      await redis('HSET', 'players', game.key, JSON.stringify({ name: game.name, best: total, at: Date.now() }));
    }
    out.board = await getBoard();
  }

  game.last = out;
  await redis('SET', 'g:' + id, JSON.stringify(game), 'EX', 7200);
  res.json(out);
});
