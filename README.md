# 🎳 Bowling Turnuvası

Tarayıcıdan (telefon ya da bilgisayar) oynanan bowling oyunu ve ortak skor tablosu.
Herkes bitişe kadar istediği kadar oynar; tabloda herkesin **en iyi** skoru görünür.
Süre dolunca oyun kapanır ve ana sayfada en üstteki 2 kişi kazanan olarak yazılır.

## Ayarlar

Hepsi [config.js](config.js) içinde:

- `DEADLINE`: bitiş anı (Türkiye saati). Şu an **25 Ekim 2026 Pazar 00:00**, yani Cumartesi gecesi biter.
- `WINNERS`: kaç kişi kazanır (2).

Eşitlikte o skoru **daha önce** yapan önde sayılır.

## Yayınlama (ücretsiz, ~10 dakika)

Gerekenler: bir GitHub hesabı ve bir Vercel hesabı (Vercel'e GitHub ile giriş yapılabilir). Vercel'in ücretsiz **Hobby** planı yeterli.

1. **GitHub'a yükle.** github.com → *New repository* (private olabilir) → *uploading an existing file* → bu klasördeki her şeyi (`api` ve `lib` klasörleriyle birlikte; `.claude` klasörü gerekmez) sürükle bırak → *Commit changes*.
2. **Vercel'de projeyi aç.** vercel.com → *Add New… → Project* → GitHub reposunu *Import* et → *Framework Preset: Other* kalsın → *Deploy*.
3. **Skor veritabanını bağla.** Vercel'de projeyi aç → *Storage* sekmesi → *Create Database* → **Upstash for Redis** → bölge olarak *Frankfurt (eu-central-1)* → ücretsiz plan → oluştur ve bu projeye bağla (*Connect*). Gerekli ayarlar (`KV_REST_API_URL`, `KV_REST_API_TOKEN`) otomatik eklenir.
4. **Yeniden yayınla.** *Deployments* sekmesi → en üstteki yayının `⋯` menüsü → *Redeploy*. (Veritabanı ayarları ancak yeni yayında devreye girer.)
5. **Dene.** Vercel'in verdiği linki (`https://...vercel.app`) aç, bir oyun oyna. Skor tablosunda görünüyorsa her şey hazır, linki gruba atabilirsin.

Not: 3. ve 4. adımı atlarsan oyun açılır ama "Veritabanı bağlı değil" hatası verir.

## Test skorlarını silmek / tabloyu düzeltmek

Vercel → *Storage* → Upstash veritabanı → *Open in Upstash* → *Data Browser* → `players` anahtarı.
Her satır bir oyuncu (isim küçük harfle). Silmek istediğin satırı oradan sil ya da Upstash'in *CLI* sekmesine şunu yaz:

```
HDEL players "mert test"
```

## Hile hakkında

Tarayıcı sunucuya sadece atış ayarlarını (topun yeri, yön, güç, falso) gönderir; kaç lobutun devrildiğini ve skoru
sunucu kendisi hesaplar, ayrıca her atışa sonradan açıklanan küçük gizli bir sapma ekler. Yani "180 yaptım" diye
sahte skor gönderilemez. Yine de kod bilen biri bot yazıp oynatabilir; ödülü verirken kazananların ekipten olduğunu
ve skorlarının makul olduğunu bir kontrol et.

## Dosyalar

- `index.html`, `style.css`, `game.js`: oyun ekranı
- `bowling.js`: fizik ve skor hesabı (tarayıcı ve sunucu aynı dosyayı kullanır)
- `api/`: Vercel sunucu fonksiyonları (oyun başlat, atış, skor tablosu)
- `lib/store.js`: Upstash Redis bağlantısı
