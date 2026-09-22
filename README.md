# 🤖 As-Syariah Bordir — Conversational Commerce

Toko online percakapan untuk **As-Syariah Bordir**. Aplikasi ini menyediakan chat AI web dan bot Telegram dengan katalog, keranjang multi-item, checkout terpandu, serta pembayaran Midtrans Snap.

Dashboard SaaS tersedia di `/admin` untuk mengelola profil toko, katalog produk, varian warna, ukuran/tipe, stok, dan credential Midtrans. Path `/` sengaja mengembalikan `403`.

Bot mendukung katalog produk interaktif, pemilihan varian warna, keranjang multi-item, checkout, pembayaran melalui Midtrans, notifikasi pembayaran, serta asisten AI berbahasa Indonesia.

## ✨ Fitur

- **Katalog produk interaktif** melalui `/produk`.
- Katalog dan pilihan varian warna menggunakan inline keyboard berbentuk grid.
- **Keranjang multi-item** untuk berbagai produk dan varian.
- Menambah, mengurangi, dan menghapus item dari keranjang.
- **Checkout terpandu** melalui `/checkout`.
- Pengumpulan alamat pengiriman melalui percakapan Telegram.
- Pembuatan transaksi pembayaran menggunakan **Midtrans Snap**.
- Webhook Midtrans untuk status `settlement` atau `capture` yang valid.
- Penyimpanan pesanan pada **Cloudflare D1**.
- Penyimpanan keranjang dan sesi checkout pada **Cloudflare KV**.
- Notifikasi pesanan dan pembayaran kepada pelanggan serta admin.
- Asisten percakapan berbasis **Cloudflare Workers AI**.
- Typing indicator saat AI sedang memproses jawaban.
- Pengambilan katalog dari file JSON eksternal.

## 🧱 Teknologi

- [Cloudflare Workers](https://workers.cloudflare.com/)
- [TypeScript](https://www.typescriptlang.org/)
- [Telegram Bot API](https://core.telegram.org/bots/api)
- [Cloudflare Workers AI](https://developers.cloudflare.com/workers-ai/)
- [Cloudflare KV](https://developers.cloudflare.com/kv/)
- [Cloudflare D1](https://developers.cloudflare.com/d1/)
- [Midtrans Snap API](https://docs.midtrans.com/docs/snap-api)
- Wrangler

## 📁 Struktur Utama

```text
.
├── src/
│   └── index.ts          # Worker utama dan handler bot
├── wrangler.jsonc        # Konfigurasi Worker dan bindings
├── package.json          # Dependensi dan script project
└── README.md
```

## 💬 Perintah Bot

| Perintah | Fungsi |
| --- | --- |
| `/start` | Menampilkan pesan selamat datang dan panduan. |
| `/produk` | Menampilkan katalog produk. |
| `/keranjang` | Menampilkan dan mengatur keranjang belanja. |
| `/checkout` | Memulai checkout dan pembayaran. |

Pesan biasa akan diteruskan kepada asisten AI untuk pertanyaan seputar produk dan penggunaan bot.

## 🔄 Alur Pemesanan

1. Pengguna menjalankan `/produk`.
2. Pengguna memilih produk dan varian warna.
3. Produk masuk ke keranjang.
4. Pengguna meninjau keranjang dengan `/keranjang`.
5. Pengguna memilih checkout.
6. Bot meminta alamat pengiriman.
7. Pesanan berstatus `PENDING` disimpan di D1.
8. Transaksi Snap dibuat melalui Midtrans.
9. Pengguna menerima tautan pembayaran.
10. Midtrans memanggil `/webhook/midtrans` setelah status pembayaran berubah.
11. Status pesanan diubah menjadi `PAID` dan notifikasi dikirim.

## 🚀 Persiapan

Pastikan tersedia:

- Node.js versi LTS dan npm.
- Wrangler CLI.
- Akun Cloudflare dengan akses Workers, KV, D1, dan Workers AI.
- Bot Telegram dari [@BotFather](https://t.me/BotFather).
- Akun Midtrans untuk Server Key dan Snap.

Login ke Cloudflare dan install dependensi:

```bash
npx wrangler login
npm install
```

## ⚙️ Konfigurasi Secret

Jangan menyimpan token Telegram, Server Key Midtrans, atau ID admin di repository. Gunakan secret Wrangler:

```bash
npx wrangler secret put BOT_TOKEN
npx wrangler secret put MIDTRANS_SERVER_KEY
npx wrangler secret put ADMIN_CHAT_ID
npx wrangler secret put ADMIN_DASHBOARD_KEY
npx wrangler secret put ADMIN_ENCRYPTION_KEY
```

`ADMIN_DASHBOARD_KEY` digunakan saat login ke `/admin`. `ADMIN_ENCRYPTION_KEY` dipakai Worker untuk mengenkripsi Server Key Midtrans sebelum disimpan di D1.

Untuk `wrangler dev` lokal, secret Cloudflare remote tidak otomatis tersedia. Salin `.dev.vars.example` menjadi `.dev.vars`, isi nilainya, lalu jalankan ulang `wrangler dev`:

```bash
cp .dev.vars.example .dev.vars
npx wrangler dev
```

URL katalog dapat didefinisikan sebagai variable non-sensitif:

```jsonc
{
  "vars": {
    "PRODUCTS_URL": "https://as-syariahbordir.github.io/product.json"
  }
}
```

> **Penting:** Credential yang pernah terpublikasi harus segera dirotasi melalui Telegram BotFather dan dashboard Midtrans. Jangan menaruh secret di README, commit, log, atau pesan error.

## 🗄️ Binding Cloudflare

| Binding | Jenis | Kegunaan |
| --- | --- | --- |
| `AI` | Workers AI | Menjalankan asisten AI. |
| `ORDER_SESSION` | KV Namespace | Menyimpan keranjang dan sesi checkout. |
| `PRODUCT_CACHE` | KV Namespace | Disiapkan untuk cache katalog. |
| `DB` | D1 Database | Menyimpan pesanan dan status pembayaran. |

## 🧭 Dashboard Admin

Jalankan migrasi schema sebelum memakai dashboard:

```bash
npx wrangler d1 execute bot_orders --remote --file=./schema.sql
```

Buka `https://<WORKER_DOMAIN>/admin`, lalu login memakai `ADMIN_DASHBOARD_KEY`. Dashboard juga menyediakan profil toko, jam buka, dan jam tutup dalam format waktu lokal. Form produk mendukung SKU, harga, gambar utama, deskripsi, warna, ukuran/tipe, URL gambar khusus varian, dan stok untuk setiap kombinasi varian. Saat URL gambar varian kosong, sistem memakai gambar utama produk sebagai fallback.

Asisten AI membaca nama toko, alamat, lokasi, nomor CS, jam buka, dan jam tutup dari `store_settings` setiap kali menerima pesan. AI juga menerima waktu realtime dengan zona `Asia/Jakarta` pada setiap request. Jika jam operasional belum diisi, AI tidak akan mengarang jadwal.

Untuk database lama yang sudah memiliki tabel `product_variants`, jalankan migration satu kali:

```bash
npx wrangler d1 execute bot_orders --remote --file=./migrations/0002_variant_image_url.sql
```

ID namespace dan database pada `wrangler.jsonc` harus sesuai dengan resource Cloudflare Anda.

## 🧾 Skema Database D1

Buat tabel `orders` dengan schema berikut:

```sql
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  username TEXT NOT NULL,
  total_amount REAL NOT NULL,
  address TEXT NOT NULL,
  items TEXT NOT NULL,
  status TEXT NOT NULL,
  payment_url TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

Jalankan migrasi:

```bash
npx wrangler d1 execute bot_orders --remote --file=./schema.sql
```

Sesuaikan nama database jika berbeda.

## 🧪 Development

Jalankan Worker secara lokal:

```bash
npm run dev
```

atau:

```bash
npx wrangler dev
```

Untuk menerima webhook Telegram dan Midtrans saat lokal, gunakan URL publik melalui Cloudflare Tunnel atau layanan tunnel lain. Gunakan credential development, bukan credential produksi.

## 🚢 Deployment

Deploy ke Cloudflare Workers:

```bash
npm run deploy
```

atau:

```bash
npx wrangler deploy
```

Daftarkan webhook Telegram setelah deployment:

```bash
curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://<WORKER_DOMAIN>/"}'
```

Webhook Midtrans diarahkan ke:

```text
https://<WORKER_DOMAIN>/webhook/midtrans
```

Pastikan endpoint menggunakan HTTPS dan URL notifikasi dikonfigurasi di dashboard Midtrans. Worker memverifikasi `signature_key` sebelum mengubah status order.

## 📦 Format Data Produk

Worker mengharapkan katalog dengan struktur berikut:

```json
{
  "product": [
    {
      "title": "Masker Bordir Premium",
      "slug": "masker-bordir-premium",
      "id": "1",
      "category": "Masker",
      "url": "https://example.com/produk/masker-bordir-premium",
      "sku": "MASKER-001",
      "price": "25000",
      "discount": "",
      "stok": "Tersedia",
      "description": "Deskripsi singkat produk.",
      "narrative": "Informasi tambahan produk.",
      "image": "https://example.com/images/masker.jpg",
      "styles": [
        {
          "name": "Merah",
          "color": "#ff0000",
          "image_path": "/images/merah.jpg"
        }
      ]
    }
  ]
}
```

Field `price` dan `discount` dapat berupa angka atau string harga. Worker membersihkan format harga sebelum menghitung total.

## 🔐 Keamanan

- Rotasi semua credential yang pernah terekspos.
- Simpan `BOT_TOKEN`, `MIDTRANS_SERVER_KEY`, dan `ADMIN_CHAT_ID` sebagai secret Cloudflare.
- Jangan commit file `.env`, token, API key, atau data pelanggan.
- Verifikasi `signature_key` webhook Midtrans sebelum mengubah status order.
- Pisahkan environment development dan production.
- Hindari menulis alamat pelanggan, token, atau informasi pembayaran ke log produksi.
- Tambahkan validasi stok dan input sebelum membuat transaksi.

## 🛠️ Pengembangan Lanjutan

- Tangani status Midtrans lain seperti `expire`, `cancel`, dan `deny` bila ingin menampilkan status lebih detail.
- Cache katalog menggunakan `PRODUCT_CACHE`.
- Pagination katalog untuk jumlah produk besar.
- Rate limiting endpoint.
- Validasi alamat dan nomor telepon.
- Mengganti tipe `any` dengan tipe Telegram API yang lebih ketat.
- Test otomatis untuk harga, keranjang, checkout, dan webhook.
- Dashboard admin untuk pemantauan pesanan.

## 📄 Lisensi

Belum ada lisensi open-source yang ditentukan. Tambahkan file `LICENSE` jika project akan didistribusikan secara publik.

## 🤝 Kontribusi

1. Fork repository.
2. Buat branch fitur.
3. Uji perubahan secara lokal.
4. Buat pull request dengan deskripsi yang jelas.
5. Pastikan tidak ada secret atau data pelanggan yang ikut ter-commit.
