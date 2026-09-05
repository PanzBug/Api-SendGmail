# Email API Dual Gateway

**API Gateway pengiriman & pengecekan email** dengan Bot Telegram untuk manajemen API Key.

Dibangun menggunakan **Node.js** (Express) — siap di-deploy ke **Vercel** (Serverless Functions) atau **Pterodactyl/VPS**.

---

## Fitur Utama

| Fitur | Deskripsi |
|---|---|
| **Send Email** | Kirim email via SMTP Gmail menggunakan Gmail & App Password sendiri |
| **Check Inbox (IMAP)** | Cek inbox Gmail, cari email, baca email spesifik via API |
| **Telegram Bot** | Lapor akun fake, kelola API Key dari Telegram |
| **Admin Dashboard (API)** | Tambah/hapus/list API Key, kelola akun Gmail & target |
| **Auto Cleanup** | Hapus otomatis API Key yang kedaluwarsa (via cron `cleanup-expired-keys`) |
| **Daily Report** | Laporan harian penggunaan Gmail ke Telegram (via cron `daily-report` jam 00:05 WIB) |
| **Reset Usage** | Reset hitungan `usageCount` harian otomatis 00:00 WIB |
| **Emergency Banding** | Laporkan akun Telegram fake ke 50+ email tujuan sekaligus |
| **Telegram Notifications** | Notifikasi ke channel/owner setiap email terkirim (dengan cooldown) |
| **Rate Limit & Quota** | Throttle 5 detik/hit + limit harian per API Key (reset 00:00 WIB) |
| **Observability** | Console info terstruktur di setiap endpoint (request, auth, error jelas) |

---

## Daftar Endpoint API

| Method | Endpoint | Auth | Deskripsi |
|---|---|---|---|
| `POST` | `/api/send-email` | `apiKey` body | Kirim email via SMTP Gmail |
| `POST` | `/api/check-inbox` | `apiKey` body | Cek inbox / baca email via IMAP |
| `POST` | `/api/verify-apikey` | `apiKey` body | Verifikasi validitas API Key |
| `GET` | `/api/admin?action=list` | `x-admin-key` | List API Key |
| `POST` | `/api/admin?action=create` | `x-admin-key` | Tambah API Key |
| `DELETE` | `/api/admin?action=delete` | `x-admin-key` | Hapus API Key |
| `POST` | `/api/telegram-webhook` | — | Webhook untuk Bot Telegram |
| `POST` | `/api/set-telegram-webhook` | — | Set webhook Telegram bot |
| `GET/POST` | `/api/cleanup-expired-keys` | `Bearer CRON_SECRET` | Bersihkan API Key kadaluwarsa |
| `GET/POST` | `/api/daily-report` | `x-admin-key` / `Bearer CRON_SECRET` / `?secret=` / Vercel Cron | Kirim laporan harian ke Telegram |
| `GET/POST` | `/api/reset-daily-usage` | `x-admin-key` / `Bearer CRON_SECRET` / Vercel Cron | Reset quota harian |
| `POST/GET` | `/api/migrate` | `x-admin-key` / `?secret=CRON_SECRET` | Migrasi kolom `usage_*` (opsional) |
| `GET` | `/` | — | Health check |
| `GET` | `/debug-routes` | — | Daftar route yang ter-load (lokal) |

> Crons aktif di `vercel.json`: `daily-report` 00:05 WIB, `cleanup-expired-keys` 06:00 UTC, `reset-daily-usage` 00:00 WIB.

---

## Dokumentasi Endpoint

### 1. Kirim Email

**Endpoint:** `POST /api/send-email`

Mengirim email menggunakan SMTP Gmail. Mendukung `application/json` dan `multipart/form-data` (untuk foto .jpg).

**Headers:** `Content-Type: application/json` atau `multipart/form-data`

**Request Body (JSON):**
```json
{
  "apiKey": "YOUR_API_KEY",
  "to": "penerima@example.com",
  "subject": "Halo Dunia!",
  "text": "Ini adalah pesan teks biasa.",
  "html": "<b>Ini adalah pesan HTML</b>",
  "gmailUser": "namanda@gmail.com",
  "gmailAppPassword": "abcd efgh ijkl mnop"
}
```

**Multipart Form Fields:**
| Field | Tipe | Keterangan |
|---|---|---|
| `apiKey` | text | API Key valid |
| `to` | text | Email tujuan |
| `subject` | text | Subjek email |
| `text` | text | Plain text (optional jika ada html) |
| `html` | text | HTML (optional jika ada text) |
| `gmailUser` | text | Alamat Gmail pengirim |
| `gmailAppPassword` | text | App Password Gmail |
| `photo` | file | File .jpg (maks 1, opsional) |

> `gmailAppPassword` adalah **App Password** 16 karakter, bukan password utama. Spasi otomatis dihapus.

**Contoh cURL:**
```bash
curl -X POST https://domain-anda.vercel.app/api/send-email \
  -H "Content-Type: application/json" \
  -d '{
    "apiKey": "abc123",
    "to": "target@example.com",
    "subject": "Test Email",
    "text": "Hello from API!",
    "gmailUser": "anda@gmail.com",
    "gmailAppPassword": "abcd efgh ijkl mnop"
  }'
```

**Response Success (200):**
```json
{ "success": true, "messageId": "<abc123@mail.gmail.com>" }
```

**Response Error:**
| Status | Keterangan | Hint |
|---|---|---|
| `400` | Field wajib tidak lengkap | Cek `to, subject, text/html, gmailUser/AppPassword` |
| `401` | API Key tidak valid / kedaluwarsa | Cek key atau buat baru via `/addkey` |
| `405` | Method bukan POST | Gunakan POST |
| `429` | Throttle 5 detik atau daily limit tercapai | `retryAfter` detik atau `resetAt` 00:00 WIB |
| `500` | Gagal kirim email / SMTP error | Cek `detail` & log `[send-email][ERROR]` |

Console: `[send-email][INFO] Request start ...`, `[INFO] Auth check`, `[INFO] SMTP send start`, `[INFO] Email terkirim dur=xxms`, `[ERROR] Daily limit exceeded`.

---

### 2. Cek Inbox (IMAP)

**Endpoint:** `POST /api/check-inbox`

Membaca inbox via IMAP. Mode: list terbaru, search, atau baca 1 email by `uid` (konten penuh). List/search hanya metadata+snippet; `uid` mengembalikan `text/html` penuh.

> ⚠️ Snippet hanya di-download untuk **10 email terbaru** (`(Cuplikan dilewati untuk performa)` untuk sisanya) untuk mencegah deadlock/timeout.

**Request Body:**
```json
{
  "apiKey": "YOUR_API_KEY",
  "gmailUser": "anda@gmail.com",
  "gmailAppPassword": "abcd efgh ijkl mnop",
  "limit": 10,
  "uid": null,
  "search": "keyword",
  "from": "pengirim@example.com"
}
```

| Parameter | Wajib | Default | Deskripsi |
|---|---|---|---|
| `apiKey` | ✅ | - | API Key valid |
| `gmailUser` | ✅ | - | Alamat Gmail |
| `gmailAppPassword` | ✅ | - | App Password Gmail |
| `limit` | ❌ | `10` | Jumlah email max. `"all"/0/-1` = semua, max angka `1000` |
| `uid` | ❌ | `null` | UID spesifik untuk baca 1 email (konten penuh) |
| `search` | ❌ | `null` | Cari di subject & body |
| `from` | ❌ | `null` | Filter pengirim |

**Response Success (200) - List/Search:**
```json
{
  "success": true,
  "count": 5,
  "total_inbox": 10,
  "emails": [{ "uid": 123, "seq": 100, "subject": "Test", "from": "a@x.com", "to": "b@x.com", "date": "2026-07-25T10:00:00.000Z", "messageId": "<...>", "snippet": "..." }]
}
```

**Response Success (200) - Baca by UID:**
```json
{ "success": true, "email": { "uid": 123, "subject": "Test", "from": "...", "to": "...", "date": "...", "text": "...", "html": "<p>...</p>", "snippet": "..." } }
```

**Response Error:**
| Status | Keterangan | Hint |
|---|---|---|
| `400` | Field wajib tidak lengkap | Isi `gmailUser`+`gmailAppPassword` |
| `401` | Gagal login IMAP | Aktifkan IMAP, 2-Step, App Password 16 char |
| `404` | UID tidak ditemukan | Cek `uid` |
| `405` | Method bukan POST | Gunakan POST |
| `504` | IMAP Connection Timeout | Coba lagi, deadline 25s |
| `500` | Error server | Cek log `[check-inbox][ERROR]` |

Console: `[check-inbox][INFO] Params ...`, `[INFO] IMAP connect start`, `[INFO] IMAP success count=..`, `[WARN] Mapped error 401 -> IMAP Authentication Failed`.

---

### 3. Verifikasi API Key

**Endpoint:** `POST /api/verify-apikey`

**Request:**
```json
{ "apiKey": "YOUR_API_KEY" }
```

**Response Success (200) — User:**
```json
{ "valid": true, "role": "user", "email": "user@example.com", "duration": "1month", "limit": 100, "used": 12, "remaining": 88, "resetAt": "2026-09-07T00:00:00+07:00", "expiresAt": "2026-10-06T10:00:00.000Z" }
```

**Response Success (200) — Admin:**
```json
{ "valid": true, "role": "admin" }
```

**Response Error (401):** `{ "valid": false, "error": "Invalid or expired API Key" }`

Console: `[verify-apikey][INFO] Verified role=user ...` atau `WARN Verify fail invalid`.

---

### 4. Admin API

**Endpoint:** `POST /api/admin` *(GET untuk list, DELETE untuk delete, via `?action=`)*

Header wajib: `x-admin-key: ADMIN_API_KEY`

#### a. List
`GET /api/admin?action=list&showInactive=false`
```bash
curl -X GET "https://domain-anda.vercel.app/api/admin?action=list" -H "x-admin-key: rahasia"
```
Response: `{ "success": true, "count": 5, "keys": [{ "key":"abc","email":"u@x","duration":"1month","usageLimit":100,"usageCount":5,"isActive":true, "expiresAt":"..." }] }`

#### b. Tambah
`POST /api/admin?action=create`
```json
{ "key": "xyz789", "email": "new@x.com", "duration": "7h", "limit": "100" }
```
`duration`: `1h | 7h | 1month | permanent`. `limit`: `1..2147483647` atau `permanent/unlimited` (null = unlimited, default 100).
```bash
curl -X POST "https://domain-anda.vercel.app/api/admin?action=create" -H "x-admin-key: rahasia" -H "Content-Type: application/json" -d '{"key":"xyz789","email":"u@x.com","duration":"7h","limit":"50"}'
```
Response `201`: `{ "success": true, "limit": "50" }`

#### c. Hapus
`DELETE /api/admin?action=delete`
```json
{ "key": "xyz789" }
```

Console: `[admin][INFO] Request start`, `Auth ok`, `Create/List/Delete success`, `[WARN] Missing fields / Invalid duration / Key exists / Unauthorized`.

---

### 5. Set Telegram Webhook

`POST /api/set-telegram-webhook` → set ke `{BASE_URL}/api/telegram-webhook`
```bash
curl -X POST https://domain-anda.vercel.app/api/set-telegram-webhook
```
Sukses: `{ "success": true, "url": "https://.../api/telegram-webhook", "telegram_response": true }`
Error `500` jika `TELEGRAM_BOT_TOKEN`/`BASE_URL` kosong.

Console: `[set-telegram-webhook][INFO] Setting webhook url=...`, `[INFO] Webhook set success`.

---

### 6. Cleanup Expired Keys

`GET /api/cleanup-expired-keys` — Auth: `Authorization: Bearer CRON_SECRET`
```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://domain-anda.vercel.app/api/cleanup-expired-keys
```
Response: `{ "success": true, "deleted": 3, "deletedCount": 3 }`

Console: `[cleanup-expired-keys][INFO] Cleanup success deleted=3`.

> Cron: `0 6 * * *` via `vercel.json` atau trigger manual.

---

### 7. Daily Report

`GET /api/daily-report` — Auth: `x-admin-key` atau `Bearer CRON_SECRET` atau `?secret=CRON_SECRET` atau `x-vercel-cron:1`
```bash
curl -H "x-admin-key: $ADMIN_API_KEY" https://domain-anda.vercel.app/api/daily-report
```
Kirim file `laporan-harian-YYYY-MM-DD.txt` ke semua `ADMIN_CHAT_ID` via Telegram (plain email+app password, 24 jam terakhir).

Response: `{ "success": true, "count": 12, "fileName": "laporan-harian-2026-09-06.txt" }`

Console: `[daily-report][INFO] Report built count=12`, `[INFO] Laporan harian terkirim ke admin 123`.

Cron: `5 17 * * *` (00:05 WIB).

---

### 8. Reset Daily Usage

`GET /api/reset-daily-usage` — Auth sama seperti daily-report.
```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://domain-anda.vercel.app/api/reset-daily-usage
```
Reset `usageCount=0` untuk semua key dengan `usageLimit IS NOT NULL` (permanent tidak di-reset).

Response: `{ "success": true, "resetCount": 5, "nextResetAt": "2026-09-07T00:00:00+07:00" }`

Console: `[reset-daily-usage][INFO] Reset success resetCount=5`.

Cron: `0 17 * * *` (00:00 WIB).

---

### 9. Migrate (Opsional)

`GET /api/migrate?secret=CRON_SECRET` atau header `x-admin-key` — menambah kolom `usage_limit`, `usage_count`, `last_hit_at`, `updated_at` jika belum ada.

Response: `{ "success": true, "results": [...], "columns": [...] }`

Console: `[migrate][INFO] Migrate ok: ALTER ...`, `[WARN] Migrate fail ...`.

---

## Bot Telegram

Antarmuka interaktif, webhook di `/api/telegram-webhook` (atau polling via `ScBot/bot.js`).

### Perintah Tersedia

#### Pengguna Biasa
| Perintah | Deskripsi |
|---|---|
| `/start` | Pesan selamat datang |
| `/cekadmin` | Cek status admin & env |
| `/banding` | Lapor akun Telegram fake (emergency wizard 4 langkah) |
| `/batal` | Batalkan pelaporan |
| `/help` | Daftar perintah |

#### Admin Only
| Perintah | Format | Deskripsi |
|---|---|---|
| `/addkey` | `/addkey <key> <email> <duration> [limit]` | Tambah API Key. `duration: 1h,7h,1month,permanent` `limit: 1..2147483647` atau `permanent/unlimited` (default 100) |
| `/delkey` | `/delkey <key>` | Hapus API Key |
| `/listkey` | `/listkey` | Lihat daftar (maks 20, tampilkan limit/used/sisa) |
| `/addgmail` | `/addgmail <email> <app_password>` | Tambah akun Gmail |
| `/delgmail` | `/delgmail <email>` | Hapus akun Gmail |
| `/listgmail` | `/listgmail` | Lihat daftar Gmail |
| `/addtarget` | `/addtarget <https://t.me/username>` | Tambah target (3-32 char) |
| `/deltarget` | `/deltarget <username>` | Hapus target |
| `/listtarget` | `/listtarget` | Lihat daftar target |
| `/dailyreport` / `/rekap` | — | Kirim laporan harian (cooldown 60s) |

Semua command log: `[telegram-webhook][INFO] Command /xxx from chatId`.

### Fitur Emergency Banding (`/banding`)

1. `/banding` → masukkan `Username` (@telegram)
2. Masukkan `Telegram ID` (12234567)
3. Masukkan `Link` (ipanzx)
4. Kirim `Foto` profil
5. Bot kirim laporan ke **50+ alamat** `utils/emailTargets.js` via SMTP Gmail acak, jeda 5s/email

Console banding: `[telegram-webhook][INFO] banding step0->1`, `photo saved`, `processBanding start`, `banding [1/50] Sent to a***@x.com`, `banding done success=50/50`.

---

## Model Database (PostgreSQL / Neon)

### ApiKey
| Field | Tipe | Keterangan |
|---|---|---|
| `key` | TEXT PK | API Key |
| `email` | TEXT | Email pemilik |
| `duration` | TEXT | `1h`, `7h`, `1month`, `permanent` |
| `expiresAt` | TIMESTAMPTZ | `null` untuk permanent |
| `isActive` | BOOLEAN | Default `true` |
| `createdAt` | TIMESTAMPTZ | Auto `now()` |
| `usageLimit` | INT | `null`=unlimited, else 1..2147483647 |
| `usageCount` | INT | Hit harian, reset 00:00 WIB |
| `lastHitAt` | TIMESTAMPTZ | Untuk throttle 5s |
| `updatedAt` | TIMESTAMPTZ | Auto `now()` |

### Gmail
| Field | Tipe | Keterangan |
|---|---|---|
| `email` | TEXT PK | Alamat Gmail |
| `appPassword` | TEXT | App Password |
| `createdAt` | TIMESTAMPTZ | |

### BandingSession
| Field | Tipe | Keterangan |
|---|---|---|
| `chatId` | TEXT PK | Telegram chat ID |
| `step` | INT | 0-3 |
| `accountName` | TEXT | Username fake |
| `telegramId` | TEXT | Telegram ID |
| `profileLink` | TEXT | Link |
| `profilePhoto` | TEXT | File ID foto |
| `createdAt` | TIMESTAMPTZ | |

### TelegramLog
| Field | Tipe | Keterangan |
|---|---|---|
| `gmailUser` | TEXT | Email |
| `gmailAppPassword` | TEXT | App Password |
| `lastNotifiedAt` | TIMESTAMPTZ | Cooldown notifikasi |
| Unique | — | `(gmailUser, gmailAppPassword)` |

### Target
| Field | Tipe | Keterangan |
|---|---|---|
| `username` | TEXT PK | `https://t.me/username` |
| `addedBy` | TEXT | Chat ID admin |
| `createdAt` | TIMESTAMPTZ | |

---

## Struktur Proyek

```
Api-SendGmail/
├── api/                       # Serverless functions (Vercel)
│   ├── send-email.js          # Kirim email via SMTP
│   ├── check-inbox.js         # Cek inbox via IMAP
│   ├── verify-apikey.js       # Verifikasi API Key
│   ├── admin.js               # Manajemen API Key (list/create/delete)
│   ├── telegram-webhook.js    # Bot Telegram webhook (polling fallback ScBot/)
│   ├── set-telegram-webhook.js# Set webhook Telegram
│   ├── cleanup-expired-keys.js# Hapus key kadaluwarsa
│   ├── daily-report.js        # Laporan harian ke Telegram
│   ├── reset-daily-usage.js   # Reset quota harian
│   └── migrate.js             # Migrasi kolom usage_*
├── models/                    # DAO Postgres (pg)
│   ├── ApiKey.js              # consume() throttle+quota atomik
│   ├── Gmail.js
│   ├── Target.js
│   ├── BandingSession.js
│   └── TelegramLog.js
├── utils/                     # Utility
│   ├── connectDB.js           # Koneksi Postgres cached + schema
│   ├── logger.js              # Helper console info terstruktur
│   ├── calculateExpiry.js     # Hitung expiresAt
│   ├── emailTargets.js        # 50+ email tujuan banding
│   ├── targetInjector.js      # Injeksi target ke body email
│   ├── generateApiKey.js
│   └── telegramNotifier.js    # Notifikasi channel/owner
├── ScBot/                     # Polling bot alternatif
│   ├── bot.js
│   └── package.json
├── tests/                     # npm test
│   ├── sendEmail.integration.test.js
│   ├── checkInbox.unit.test.js
│   ├── telegramNotifier.test.js
│   └── ...
├── .env.example               # Contoh env
├── package.json
├── vercel.json                # Routes + crons
└── server.js                  # Express lokal (load api/ dinamis + request logger)
```

---

## Cara Install & Setup

### 1. Persyaratan
- Node.js 18+
- Neon PostgreSQL ([neon.tech](https://neon.tech))
- Akun Vercel atau VPS/Pterodactyl
- Bot Token [@BotFather](https://t.me/botfather)
- Google App Password ([myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords))

### 1.1. Setup IMAP untuk Gmail

1. **Aktifkan 2-Step Verification:** Akun Google → Keamanan → 2-Step Verification → aktifkan.
2. **Aktifkan IMAP:** Gmail → Setelan (⚙️) → Lihat semua setelan → Penerusan dan POP/IMAP → Status IMAP: Aktifkan IMAP → Simpan.
3. **Buat App Password:** Akun Google → Keamanan → App passwords → Pilih aplikasi Lainnya → Nama `Email Gateway API` → BUAT → salin 16 karakter (tanpa spasi) sebagai `gmailAppPassword`.

### 2. Clone & Install
```bash
git clone https://github.com/PanzBug/Api-SendGmail.git
cd Api-SendGmail
npm install
```

### 3. Konfigurasi Environment (`.env`)
```env
DATABASE_URL=postgresql://user:password@ep-xxxx.region.aws.neon.tech/db?sslmode=require
TELEGRAM_BOT_TOKEN=123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11
ADMIN_CHAT_ID=987654321,123456789
ADMIN_API_KEY=rahasia_admin_anda_sangat_kuat_min32char
BASE_URL=https://domain-anda.vercel.app
PORT=3000
CRON_SECRET=your_random_cron_secret_min32char
TELEGRAM_CHANNEL_ID=-1001234567890
NOTIFICATION_COOLDOWN_MINUTES=60
```

### 4. Jalankan Lokal
```bash
npm run dev
# → http://localhost:3000  health: /  debug: /debug-routes
```

### 5. Deploy ke Vercel
```bash
npm i -g vercel
vercel --prod
```

### 6. Set Telegram Webhook
```bash
curl -X POST https://domain-anda.vercel.app/api/set-telegram-webhook
```

### 7. (Opsional) Migrasi manual jika DB lama
```bash
curl -H "x-admin-key: $ADMIN_API_KEY" https://domain-anda.vercel.app/api/migrate
```

---

## Variabel Lingkungan Lengkap

| Variabel | Wajib | Deskripsi |
|---|---|---|
| `DATABASE_URL` | ✅ | Connection string Neon `postgresql://...?sslmode=require` |
| `TELEGRAM_BOT_TOKEN` | ✅ | Token dari @BotFather |
| `ADMIN_CHAT_ID` | ✅ | ID Telegram admin, pisah koma `123,456` |
| `ADMIN_API_KEY` | ✅ | Kunci admin API & bot (`/addkey` dll) |
| `BASE_URL` | ✅ | URL dasar `https://domain.vercel.app` (tanpa trailing slash) |
| `CRON_SECRET` | ✅* | Secret untuk `cleanup`, `daily-report`, `reset-usage`, `migrate` |
| `TELEGRAM_CHANNEL_ID` | ❌ | Channel ID untuk notifikasi (`-100...`). Jika kosong fallback ke `ADMIN_CHAT_ID` |
| `NOTIFICATION_COOLDOWN_MINUTES` | ❌ | Cooldown notifikasi channel per `gmailUser` (default 60) |
| `PORT` | ❌ | Port lokal (default 3000) |
| `TARGET_SUBJECT_MARKER` | ❌ | Marker subject untuk injeksi target (default `[INJECT]`) |

> `*` wajib jika pakai fitur cron terkait; tanpa `CRON_SECRET` hanya `x-admin-key`/`x-vercel-cron` yang diizinkan.

---

## Observability & Logging

Setiap endpoint kini log terstruktur via `utils/logger.js` → `console.info/warn/error` dengan format:

```
2026-09-06T10:00:00.000Z [send-email][INFO] Request start method=POST ct=application/json ip=1.2.3.4
2026-09-06T10:00:00.001Z [send-email][INFO] Parsed body apiKey=abc***def to=p***@x.com subject="Test" gmailUser=a***@gmail.com
2026-09-06T10:00:00.010Z [send-email][INFO] Auth check isAdmin=false apiKey=abc***def
2026-09-06T10:00:00.020Z [send-email][INFO] ApiKey ok limit=100 used=5 remaining=95
2026-09-06T10:00:00.100Z [send-email][INFO] SMTP send start from=a***@gmail.com to=p***@x.com
2026-09-06T10:00:00.500Z [send-email][INFO] Email terkirim messageId=<...> dur=400ms
```

**Scope & contoh info penting:**

| Scope | Info | Warn | Error |
|---|---|---|---|
| `server` | `→ GET /api/...` `← ... status=200 dur=12ms` `Route loaded` | `404 Not Found` | `Failed to load route` |
| `send-email` | Request start, parsed body, auth, throttle/quota, SMTP start, notifyChannel | Validation fail, ApiKey rejected 401/429, getAllTargets fail | Daily limit 550, SMTP fail, unhandled |
| `check-inbox` | Params, auth, IMAP connect mode, IMAP success count | Validation fail, rejected, non-200 | IMAP error + mapped 401/504 |
| `verify-apikey` | Params, verified role/limit/remaining | Missing/invalid/expired | Unhandled |
| `admin` | Auth ok, list/create/delete attempt+success | Missing/invalid duration/limit, Key exists, Unauthorized | Unhandled |
| `telegram-webhook` | Incoming update, command `/xxx from chatId`, banding step transitions, `[n/50] Sent` | Rate limit, cooldown, not admin, no Gmail | bot.catch, SMTP fail, webhook error |
| `polling-bot` | Sama seperti webhook untuk mode polling | — | Polling error |
| `daily-report` | Build count, sent to admin | Unauthorized | Gagal kirim |
| `reset-daily-usage` | Reset success count | Unauthorized | — |
| `migrate` / `set-telegram-webhook` / `cleanup-expired-keys` / `connectDB` | Setup/success | Config incomplete | Fail |

**Cara lihat log:**
* Lokal: terminal `npm run dev`
* Vercel: Dashboard → Project → Logs → Runtime Logs (filter `[send-email][ERROR]` etc.)
* Pterodactyl: `Logs` tab panel

PII di-mask: `apiKey` tampil `abc***def`, `gmailUser` `a***@gmail.com`, `gmailAppPassword` tidak pernah di-log.

---

## Troubleshooting

| Gejala | Status | Penyebab & Solusi |
|---|---|---|
| `API Key required` | 401 | Body `apiKey` kosong. Log `[send-email][WARN] Validation fail` |
| `Invalid or expired API Key` | 401 | Key salah/kadaluwarsa. Cek `verify-apikey` atau `listkey`. Log `ApiKey rejected` |
| `Too many requests` / `429` | 429 | Throttle 5s/hit atau limit harian habis. Tunggu `retryAfter` atau reset 00:00 WIB (`resetAt`). Log `ApiKey rejected ... remaining=0` |
| `Gmail credentials required` | 400 | `gmailUser/AppPassword` kosong |
| `Daily sending limit exceeded` | 429/550 | Gmail limit tercapai. Ganti `gmailUser` atau tunggu 24 jam |
| `IMAP Authentication Failed` | 401 | IMAP off / 2FA off / App Password salah. Aktifkan IMAP & 2-Step, pakai 16-char App Password. Log `[check-inbox][ERROR] IMAP Error` |
| `IMAP Connection Timeout` | 504 | Jaringan/slow IMAP. Retry, log `deadline 25s` |
| `Telegram bot tidak respon` | 500 webhook | `TELEGRAM_BOT_TOKEN` kosong → log `[telegram-webhook][ERROR] FATAL: TELEGRAM_BOT_TOKEN missing`. Cek `ADMIN_CHAT_ID` dan `BASE_URL` |
| `Route 404` | 404 | Cek `GET /debug-routes`, pastikan file ada di `api/` dan log `Route loaded` muncul |

---

## Keamanan

1. **App Password** bukan password utama
2. `ADMIN_API_KEY` & `CRON_SECRET` min 32 char acak
3. Jangan commit `.env`
4. `Cron secret` untuk `cleanup`/`daily-report`/`reset-usage`
5. `ApiKey.expiresAt` otomatis `isActive=false` via `consume()`
6. Throttle 5 detik + limit harian per key (reset 00:00 WIB)
7. Cooldown notifikasi channel `NOTIFICATION_COOLDOWN_MINUTES` (default 60)
8. Jeda 5 detik antar email di `/banding` untuk hindari spam limit

---

## Author

**Ipanzxdev** — [GitHub](https://github.com/PanzBug/Api-SendGmail)

---

*Terima kasih telah menggunakan Email API Dual Gateway! Laporkan issue [di sini](https://github.com/PanzBug/Api-SendGmail/issues).*
