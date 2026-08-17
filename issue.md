# Planning: Implementasi Fitur /banding (Emergency Reporting)

## Deskripsi Tugas
Menambahkan fitur `/banding` ke dalam Bot Telegram. Fitur ini berfungsi untuk melaporkan akun Telegram palsu (scammer) yang mengatasnamakan INDODAX. Bot akan mengumpulkan data melalui percakapan terstruktur (wizard) dan mengirimkan laporan ke 50 alamat email tujuan secara bertahap.

## Target Pengembang
- **Programmer Junior** (Memahami dasar JavaScript & Node.js)
- **Model AI Rendah** (Membutuhkan instruksi langkah-demi-langkah yang mendetail)

---

## Langkah 1: Pembuatan Model Database untuk Sesi
Karena proses ini memiliki beberapa langkah (step-by-step), kita perlu menyimpan status sementara user agar bot tahu user sedang di tahap mana.

**File baru:** `models/BandingSession.js`
**Instruksi:**
1. Buat file baru `models/BandingSession.js`.
2. Gunakan schema untuk menyimpan data laporan sementara.

```javascript
import mongoose from 'mongoose';

const bandingSessionSchema = new mongoose.Schema({
  chatId: { type: String, unique: true, required: true },
  step: { type: Number, default: 0 }, // 0: Username, 1: ID, 2: Link, 3: Foto
  accountName: { type: String },
  telegramId: { type: String },
  profileLink: { type: String },
  profilePhoto: { type: String }, // Simpan file_id telegram
  createdAt: { type: Date, default: Date.now, expires: 3600 } // Sesi hapus otomatis setelah 1 jam
});

export const BandingSession = mongoose.models.BandingSession || mongoose.model('BandingSession', bandingSessionSchema);
```

---

## Langkah 2: Menyiapkan Daftar Email Tujuan
Buat file utility atau simpan di dalam kode untuk menampung 50 email tujuan.

**Contoh Daftar Email (Simpan di `utils/emailTargets.js` atau langsung di handler):**
```javascript
export const TUJUAN_EMAILS = [
  "support@indodax.com",
  "security@indodax.com",
  "abuse@telegram.org",
  // ... tambahkan hingga 50 email
];
```

---

## Langkah 3: Implementasi Logic /banding di Webhook
Update `api/telegram-webhook.js` untuk menangani alur wizard.

### A. Handler Perintah `/banding`
Saat user mengetik `/banding`, buat sesi baru di database.

```javascript
bot.command('banding', async (ctx) => {
  await connectDB();
  // Validasi: Cek apakah user memiliki API Key aktif (Opsional sesuai kebijakan)
  // ...
  
  await BandingSession.findOneAndUpdate(
    { chatId: ctx.chat.id },
    { step: 0 },
    { upsert: true, new: true }
  );
  
  ctx.reply('🛡️ **Mode Pelaporan Emergency**\n\nSilakan masukkan Username akun yang ingin dilaporkan (Contoh: @telegram):');
});
```

### B. Handler Input Text (Wizard Logic)
Gunakan `bot.on('text', ...)` untuk menangkap input user berdasarkan `step` mereka.

**Logika Step-by-Step:**
1. **Step 0 (Username):** Simpan username, validasi format, ganti ke Step 1. Tanya ID Telegram.
2. **Step 1 (ID):** Simpan ID, ganti ke Step 2. Tanya Link Profile.
3. **Step 2 (Link):** Simpan Link, ganti ke Step 3. Minta kirim Foto Profile.

### C. Handler Foto (Step Terakhir)
Gunakan `bot.on('photo', ...)` untuk menangkap foto di step terakhir.
Setelah foto diterima, jalankan fungsi pengiriman email.

---

## Langkah 4: Fungsi Pengiriman Email Massal dengan Cooldown
Kita harus mengirim ke 50 email satu per satu agar tidak dianggap spam oleh server SMTP.

**Instruksi:**
1. Ambil 1 akun Gmail secara **ACAK** dari koleksi `Gmail` sebagai pengirim untuk setiap sesi laporan. Ini bertujuan agar beban pengiriman terbagi rata ke semua akun Gmail yang tersedia.
2. Loop melalui `TUJUAN_EMAILS`.
3. Gunakan `await new Promise(resolve => setTimeout(resolve, 5000))` (delay 5 detik) antar pengiriman.

**Template Pesan:**
Gunakan template yang sudah ditentukan di `promt.txt` dengan variabel `${AccountName}`, `${TelegramID}`, dan `${AccountLink}`.

---

## Langkah 5: Contoh Potongan Kode Pengiriman (Service)

### A. Cara Mengambil Gmail Secara Acak:
```javascript
async function getRandomGmail() {
  await connectDB();
  const count = await Gmail.countDocuments();
  if (count === 0) return null;
  const random = Math.floor(Math.random() * count);
  return await Gmail.findOne().skip(random);
}
```

### B. Fungsi Kirim Email:
```javascript
async function sendBandingEmails(data, senderGmail) {
  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    auth: { user: senderGmail.email, pass: senderGmail.appPassword }
  });
// ... (lanjutan logika loop email)
```

---

## Checklist Implementasi
- [ ] Buat file `models/BandingSession.js`.
- [ ] Tambahkan `BandingSession` ke import di `api/telegram-webhook.js`.
- [ ] Implementasi handler `/banding`.
- [ ] Implementasi logic `bot.on('text')` untuk handle step 0-2.
- [ ] Implementasi logic `bot.on('photo')` untuk handle step 3.
- [ ] Buat fungsi loop email dengan cooldown.
- [ ] Uji coba dengan 2-3 email dummy sebelum menggunakan 50 email.

---

## Catatan Keamanan
- Jangan pernah menampilkan *App Password* di log.
- Pastikan bot memberikan notifikasi "Sedang mengirim laporan..." agar user tahu proses sedang berjalan.
- Gunakan `try-catch` di setiap pengiriman email agar jika 1 email gagal, proses tetap lanjut ke email berikutnya.
