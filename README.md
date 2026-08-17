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
| **Admin Dashboard (API)** | Tambah/hapus/list API Key, kelola akun Gmail |
| **Auto Cleanup** | Hapus otomatis API Key yang kedaluwarsa (via cron) |
| **Emergency Banding** | Laporkan akun Telegram fake ke 50+ email tujuan sekaligus |
| **Telegram Notifications** | Notifikasi ke owner setiap email terkirim |

---

## Daftar Endpoint API

| Method | Endpoint | Deskripsi |
|---|---|---|
| `POST` | `/api/send-email` | Kirim email via SMTP Gmail |
| `POST` | `/api/check-inbox` | Cek inbox / baca email via IMAP |
| `POST` | `/api/verify-apikey` | Verifikasi validitas API Key |
| `POST` | `/api/admin` | Manajemen API Key (admin only) |
| `POST` | `/api/telegram-webhook` | Webhook untuk Bot Telegram |
| `POST` | `/api/set-telegram-webhook` | Set webhook Telegram bot |
| `GET` | `/api/cleanup-expired-keys` | Bersihkan API Key kadaluwarsa (via cron) |

---

## Dokumentasi Endpoint

### 1. Kirim Email

**Endpoint:** `POST /api/send-email`

Mengirim email menggunakan SMTP Gmail. Mendukung format `application/json` dan `multipart/form-data` (untuk upload foto .jpg).

**Headers:**
- `Content-Type: application/json` (default) atau `multipart/form-data`

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
| `text` | text | Isi plain text (optional jika ada html) |
| `html` | text | Isi HTML (optional jika ada text) |
| `gmailUser` | text | Alamat Gmail pengirim |
| `gmailAppPassword` | text | App Password Gmail |
| `photo` | file | File .jpg (maks 1, opsional) |

> **Catatan:** `gmailAppPassword` adalah **App Password** dari Gmail (16 karakter), bukan password utama. Spasi akan otomatis dihapus.

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
{
  "success": true,
  "messageId": "<abc123@mail.gmail.com>"
}
```

**Response Error:**
| Status | Keterangan |
|---|---|
| `400` | Field wajib tidak lengkap |
| `401` | API Key tidak valid / kedaluwarsa |
| `405` | Method bukan POST |
| `500` | Gagal kirim email / error server |

---

### 2. Cek Inbox (IMAP)

**Endpoint:** `POST /api/check-inbox`

Membaca inbox Gmail via IMAP. Bisa list email terbaru (metadata + cuplikan), mencari berdasarkan keyword/pengirim, atau membaca email spesifik berdasarkan UID (konten penuh).

**Perhatian:** Untuk list/pencarian, response hanya berisi metadata dan cuplikan. Untuk mendapatkan konten email lengkap (text/HTML), gunakan parameter `uid` dengan UID spesifik.

**Request Body:**
\`\`\`json
{
  "apiKey": "YOUR_API_KEY",
  "gmailUser": "anda@gmail.com",
  "gmailAppPassword": "abcd efgh ijkl mnop",
  "limit": 10,
  "uid": null,
  "search": "keyword",
  "from": "pengirim@example.com"
}
\`\`\`

| Parameter | Wajib | Default | Deskripsi |
|---|---|---|---|
| \`apiKey\` | ✅ | - | API Key valid |
| \`gmailUser\` | ✅ | - | Alamat Gmail |
| \`gmailAppPassword\` | ✅ | - | App Password Gmail |
| \`limit\` | ❌ | \`10\` (maks 50) | Jumlah email maksimal yang diambil |
| \`uid\` | ❌ | \`null\` | UID spesifik untuk baca 1 email (mengembalikan konten penuh) |
| \`search\` | ❌ | \`null\` | Cari di subject & body |
| \`from\` | ❌ | \`null\` | Filter berdasarkan pengirim |

**Contoh cURL:**
\`\`\`bash
curl -X POST https://domain-anda.vercel.app/api/check-inbox \\
  -H "Content-Type: application/json" \\
  -d '{
    "apiKey": "abc123",
    "gmailUser": "anda@gmail.com",
    "gmailAppPassword": "abcd efgh ijkl mnop",
    "limit": 5
  }'
\`\`\`

**Response Success (200) - List/Search:**
\`\`\`json
{
  "success": true,
  "count": 5,
  "total_inbox": 10,
  "emails": [
    {
      "uid": 123,
      "seq": 100,
      "subject": "Test Email",
      "from": "pengirim@example.com",
      "to": "anda@gmail.com",
      "date": "2026-07-25T10:00:00.000Z",
      "messageId": "<abc123@mail.gmail.com>",
      "snippet": "Ini adalah cuplikan isi email..."
    }
  ]
}
\`\`\`

**Response Success (200) - Baca by UID:**
\`\`\`json
{
  "success": true,
  "email": {
    "uid": 123,
    "subject": "Test Email",
    "from": "pengirim@example.com",
    "to": "anda@gmail.com",
    "date": "2026-07-25T10:00:00.000Z",
    "text": "Isi email dalam bentuk plain text.",
    "html": "<p>Isi email dalam bentuk <b>HTML</b>.</p>",
    "snippet": "Ini adalah cuplikan isi email..."
  }
}
\`\`\`

**Response Error:**
| Status | Keterangan |
|---|---|
| \`400\` | Field wajib tidak lengkap |
| \`401\` | Gagal login IMAP (IMAP disabled / 2FA / App Password salah) |
| \`404\` | Email dengan UID tersebut tidak ditemukan |
| \`405\` | Method bukan POST |
| \`500\` | Error server internal |
| \`504\` | IMAP Connection Timeout |

---

### 3. Verifikasi API Key

**Endpoint:** `POST /api/verify-apikey`

Memeriksa validitas API Key tanpa mengirim email. Berguna untuk testing sebelum menggunakan endpoint lain.

**Request Body:**
```json
{
  "apiKey": "YOUR_API_KEY"
}
```

**Contoh cURL:**
```bash
curl -X POST https://domain-anda.vercel.app/api/verify-apikey \
  -H "Content-Type: application/json" \
  -d '{"apiKey": "abc123"}'
```

**Response Success (200) — User Key:**
```json
{
  "valid": true,
  "role": "user",
  "email": "user@example.com",
  "duration": "1month",
  "expiresAt": "2026-08-23T10:00:00.000Z"
}
```

**Response Success (200) — Admin Key:**
```json
{
  "valid": true,
  "role": "admin"
}
```

**Response Error (401):**
```json
{
  "valid": false,
  "error": "Invalid or expired API Key"
}
```

---

### 4. Admin API

**Endpoint:** `POST /api/admin` *(juga menerima GET dan DELETE berdasarkan action)*

Manajemen API Key. Membutuhkan header `x-admin-key` dengan nilai `ADMIN_API_KEY`.

**Headers:**
```
x-admin-key: rahasia_admin_anda_sangat_kuat
```

#### a. List API Key

**Request:** `GET /api/admin?action=list&showInactive=false`

```bash
curl -X GET "https://domain-anda.vercel.app/api/admin?action=list" \
  -H "x-admin-key: rahasia_admin_anda"
```

**Response:**
```json
{
  "success": true,
  "count": 5,
  "keys": [
    {
      "key": "abc123",
      "email": "user@example.com",
      "duration": "1month",
      "isActive": true,
      "createdAt": "2026-07-20T10:00:00.000Z",
      "expiresAt": "2026-08-20T10:00:00.000Z"
    }
  ]
}
```

#### b. Tambah API Key

**Request:** `POST /api/admin?action=create`

```json
{
  "key": "xyz789",
  "email": "newuser@example.com",
  "duration": "7h"
}
```

```bash
curl -X POST "https://domain-anda.vercel.app/api/admin?action=create" \
  -H "Content-Type: application/json" \
  -H "x-admin-key: rahasia_admin_anda" \
  -d '{"key": "xyz789", "email": "user@example.com", "duration": "7h"}'
```

#### c. Hapus API Key

**Request:** `DELETE /api/admin?action=delete`

```json
{
  "key": "xyz789"
}
```

```bash
curl -X DELETE "https://domain-anda.vercel.app/api/admin?action=delete" \
  -H "Content-Type: application/json" \
  -H "x-admin-key: rahasia_admin_anda" \
  -d '{"key": "xyz789"}'
```

---

### 5. Set Telegram Webhook

**Endpoint:** `POST /api/set-telegram-webhook`

Memasang webhook URL untuk Bot Telegram. Webhook akan di-set ke `{BASE_URL}/api/telegram-webhook`.

```bash
curl -X POST https://domain-anda.vercel.app/api/set-telegram-webhook
```

**Response Success:**
```json
{
  "success": true,
  "result": {
    "ok": true,
    "result": true,
    "description": "Webhook was set"
  }
}
```

---

### 6. Cleanup Expired Keys

**Endpoint:** `GET /api/cleanup-expired-keys?secret=CRON_SECRET`

Membersihkan API Key yang sudah kedaluwarsa dan tidak aktif. Dipanggil manual atau via cron job.

**Headers:**
```
Authorization: CRON_SECRET_ANDA
```

**Via URL:**
```
https://domain-anda.vercel.app/api/cleanup-expired-keys?secret=your_cron_secret
```

**Response Success:**
```json
{
  "success": true,
  "deletedCount": 3
}
```

> **Rekomendasi cron:** Jalankan setiap 6 jam sekali.

---

## Bot Telegram

Bot Telegram menyediakan antarmuka interaktif untuk pelaporan akun fake.

### Perintah Tersedia

#### Pengguna Biasa
| Perintah | Deskripsi |
|---|---|
| `/start` | Pesan selamat datang |
| `/banding` | Lapor akun Telegram fake (emergency) |
| `/batal` | Batalkan pelaporan |
| `/help` | Daftar perintah yang tersedia |

#### Admin Only
| Perintah | Deskripsi |
|---|---|
| `/addkey <key> <email> <duration>` | Tambah API Key manual |
| `/delkey <key>` | Hapus API Key |
| `/listkey` | Lihat daftar API Key (maks 20) |
| `/addgmail <email> <app_password>` | Tambah akun Gmail |
| `/delgmail <email>` | Hapus akun Gmail |
| `/listgmail` | Lihat daftar akun Gmail |
| `/addtarget <url>` / `/deltarget <username>` / `/listtarget` | Kelola target |
| `/dailyreport` (alias `/rekap`) | Kirim laporan harian |

### Fitur Emergency Banding (`/banding`)

Melaporkan akun Telegram yang mencurigakan dengan cara:
1. Masukkan username akun fake
2. Masukkan Telegram ID
3. Masukkan link profil
4. Kirim foto profil
5. Bot akan mengirim laporan ke **50+ alamat email tujuan** (Indodax, Telegram, dll.)
6. Email dikirim bergantian dari akun Gmail yang terdaftar secara acak
7. Jeda 5 detik antar email untuk menghindari limit Gmail

---

## Model Database (PostgreSQL / Neon)

### ApiKey
| Field | Tipe | Keterangan |
|---|---|---|
| `key` | String (unique) | API Key |
| `email` | String | Email pemilik |
| `duration` | String | `1h`, `7h`, `1month`, `permanent` |
| `expiresAt` | Date | Tanggal kedaluwarsa (`null` untuk permanent) |
| `isActive` | Boolean | Status aktif (default: `true`) |
| `createdAt` | Date | Timestamp pembuatan |

### Gmail
| Field | Tipe | Keterangan |
|---|---|---|
| `email` | String (unique) | Alamat Gmail |
| `appPassword` | String | App Password |
| `createdAt` | Date | Timestamp |

### BandingSession
| Field | Tipe | Keterangan |
|---|---|---|
| `chatId` | String (unique) | Telegram chat ID |
| `step` | Number | Tahap input (0-3) |
| `accountName` | String | Username akun fake |
| `telegramId` | String | Telegram ID |
| `profileLink` | String | Link profil |
| `profilePhoto` | String | File ID foto Telegram |
| `createdAt` | Date | TTL: 3600 detik |

### TelegramLog
| Field | Tipe | Keterangan |
|---|---|---|
| `gmailUser` | String | Email Gmail |
| `gmailAppPassword` | String | App Password |
| `lastNotifiedAt` | Date | Notifikasi terakhir |
| *(Unique index pada kombinasi `gmailUser` + `gmailAppPassword`)* | | |

---

## Struktur Proyek

```
Api-Fix-Merah/
├── api/                       # Serverless functions (Vercel)
│   ├── send-email.js          # Kirim email via SMTP
│   ├── check-inbox.js         # Cek inbox via IMAP
│   ├── verify-apikey.js       # Verifikasi API Key
│   ├── admin.js               # Manajemen API Key
│   ├── telegram-webhook.js    # Bot Telegram handler
│   ├── set-telegram-webhook.js# Set webhook Telegram
│   └── cleanup-expired-keys.js# Hapus key kadaluwarsa
├── models/                    # Database access (pg DAO)
│   ├── ApiKey.js
│   ├── Gmail.js
│   ├── Target.js
│   ├── BandingSession.js
│   └── TelegramLog.js
├── utils/                     # Utility functions
│   ├── connectDB.js           # Koneksi Postgres (cached)
│   ├── calculateExpiry.js     # Hitung tanggal kedaluwarsa
│   ├── emailTargets.js        # Daftar email tujuan banding
│   ├── generateApiKey.js      # Generate random API key
│   └── telegramNotifier.js    # Kirim notifikasi ke Telegram
├── .env.example               # Contoh environment variables
├── package.json               # Dependencies
├── vercel.json                # Konfigurasi Vercel
└── server.js                  # Server lokal (Express)
```

---

## Cara Install & Setup

### 1. Persyaratan Sistem
- **Node.js** 18+
- **Neon PostgreSQL** (akun [Neon](https://neon.tech) dan database)
- **Akun Vercel** (deployment) atau **VPS/Pterodactyl**
- **Bot Token** dari [@BotFather](https://t.me/botfather)
- **Google App Password** ([buat di sini](https://myaccount.google.com/apppasswords))

### 1.1. Cara Setup IMAP untuk Gmail

Agar endpoint `check-inbox` berfungsi, Anda perlu mengaktifkan IMAP di akun Gmail Anda dan membuat App Password. Ikuti langkah-langkah berikut:

1.  **Aktifkan 2-Step Verification di Akun Google Anda:**
    *   Buka [Akun Google Anda](https://myaccount.google.com/).
    *   Di panel navigasi kiri, klik **Keamanan**.
    *   Di bagian "Cara login ke Google", klik **2-Step Verification**. Anda mungkin perlu login.
    *   Ikuti langkah-langkah di layar untuk mengaktifkan 2-Step Verification.

2.  **Aktifkan IMAP di Pengaturan Gmail:**
    *   Buka [Gmail](https://mail.google.com/) di browser Anda.
    *   Klik ikon **Setelan** (roda gigi) di kanan atas, lalu pilih **Lihat semua setelan**.
    *   Klik tab **Penerusan dan POP/IMAP**.
    *   Gulir ke bagian "Akses IMAP", pastikan **Status IMAP: IMAP diaktifkan**. Jika tidak, pilih **Aktifkan IMAP** dan klik **Simpan Perubahan**.

3.  **Buat App Password:**
    *   Kembali ke [Akun Google Anda](https://myaccount.google.com/).
    *   Di panel navigasi kiri, klik **Keamanan**.
    *   Di bagian "Cara login ke Google", klik **App passwords** (Kata sandi aplikasi). Anda mungkin perlu login lagi.
    *   Di halaman Kata sandi aplikasi, dari menu drop-down "Pilih aplikasi", pilih **Lainnya (Nama khusus)** dan masukkan nama seperti "Email Gateway API".
    *   Klik **BUAT**.
    *   Anda akan mendapatkan kode 16 karakter di kotak kuning. **Ini adalah App Password Anda.** Salin kode ini (tanpa spasi) dan gunakan sebagai `gmailAppPassword` di API Anda. **Simpan baik-baik karena kode ini hanya ditampilkan sekali.**

Dengan mengikuti langkah-langkah ini, Anda akan dapat menggunakan endpoint `check-inbox` dan `send-email` dengan benar.

### 2. Clone & Install
```bash
git clone https://github.com/Irfanxyz5/Api-Fix-Merah.git
cd Api-Fix-Merah
npm install
```

### 3. Konfigurasi Environment (`.env`)
```env
DATABASE_URL=postgresql://user:password@ep-xxxx.region.aws.neon.tech/db?sslmode=require
TELEGRAM_BOT_TOKEN=123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11
ADMIN_CHAT_ID=987654321,123456789
ADMIN_API_KEY=rahasia_admin_anda_sangat_kuat
BASE_URL=https://domain-anda.vercel.app
PORT=3000
CRON_SECRET=your_random_cron_secret
```

### 4. Jalankan Lokal
```bash
npm run dev
```

### 5. Deploy ke Vercel
```bash
npm i -g vercel
vercel --prod
```

### 6. Set Telegram Webhook
Setelah deploy, panggil endpoint set webhook:
```bash
curl -X POST https://domain-anda.vercel.app/api/set-telegram-webhook
```

---

## Variabel Lingkungan Lengkap

| Variabel | Wajib | Deskripsi |
|---|---|---|
| `DATABASE_URL` | ✅ | Connection string Neon PostgreSQL |
| `TELEGRAM_BOT_TOKEN` | ✅ | Token dari @BotFather |
| `ADMIN_CHAT_ID` | ✅ | ID Telegram admin (bisa pisah koma) |
| `ADMIN_API_KEY` | ✅ | Kunci akses admin API |
| `BASE_URL` | ✅ | URL dasar aplikasi |
| `CRON_SECRET` | ✅* | Secret untuk cron cleanup |
| `PORT` | ❌ | Port lokal (default: 3000) |

> `*` = Wajib jika menggunakan fitur terkait

---

## Keamanan

1. **Gunakan App Password**, bukan password utama Gmail
2. **ADMIN_API_KEY** harus kuat dan acak (min 32 karakter)
3. **Jangan commit** file `.env` ke repository
4. **Cron secret** digunakan untuk mengamankan endpoint cleanup
5. **API Key expired** otomatis dinonaktifkan
6. **Rate limiting** via jeda 5 detik antar email pada fitur banding

---

## Author

**Ipanzxdev** — [GitHub](https://github.com/Irfanxyz5)

---

*Terima kasih telah menggunakan Email API Dual Gateway! Laporkan issue [di sini](https://github.com/Irfanxyz5/Api-Fix-Merah/issues).*
