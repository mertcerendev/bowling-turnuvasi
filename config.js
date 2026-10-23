// Turnuvanın bitiş anı (Türkiye saati, UTC+3). Bu andan sonra yeni oyun/atış kabul edilmez;
// skor tablosunun en üstündeki WINNERS kişi kazanır.
export const DEADLINE = '2026-10-25T00:00:00+03:00';
export const WINNERS = 2;

export const isOver = (now = Date.now()) => now >= Date.parse(DEADLINE);
