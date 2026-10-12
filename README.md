# Erra Auto Lead (Node.js + Baileys + Firestore)

Backend terpisah untuk menghubungkan banyak nomor WhatsApp sales dan membuat/memperbarui dokumen di collection `leads` berdasarkan aturan teks. Tidak memakai AI berbayar.

## Sebelum mulai
- Gunakan Node.js 20 atau lebih baru.
- Pastikan project Firebase yang dipakai sama dengan project Erra.
- Minta persetujuan sales sebelum menghubungkan WhatsApp dan membaca chat pelanggan. Bot ini memproses teks chat pribadi yang masuk ke nomor yang terhubung; jangan gunakan untuk membaca chat pribadi di luar tujuan layanan.
- Baileys adalah integrasi tidak resmi dengan WhatsApp Web; penggunaan dapat terkena perubahan WhatsApp atau pembatasan akun. Gunakan dengan risiko yang dipahami.

## 1. Instalasi
```bash
npm install
cp .env.example .env
```
Windows PowerShell, jika `cp` tidak cocok:
```powershell
Copy-Item .env.example .env
```
Edit `.env`: isi `ADMIN_API_KEY` dengan secret acak panjang. Jangan masukkan key ini ke aplikasi Flutter.

## 2. Firebase Admin
1. Firebase Console → Project settings → Service accounts.
2. Buat/gunakan service account khusus backend dengan izin minimal yang dibutuhkan.
3. Unduh JSON key dan simpan sebagai `secrets/firebase-service-account.json`.
4. Pastikan `.gitignore` mengecualikan `secrets/` dan `.env`.
5. Isi `GOOGLE_APPLICATION_CREDENTIALS=./secrets/firebase-service-account.json` dan `FIREBASE_PROJECT_ID` di `.env`.
6. Jangan pernah mengirim JSON service account, private key, atau `ADMIN_API_KEY` ke chat, frontend, GitHub, atau APK.

Di hosting yang mendukung Application Default Credentials / workload identity, lebih baik gunakan identity hosting daripada file JSON.

## 3. Jalankan
```bash
npm start
```
Cek `http://localhost:3000/health`.

## 4. Hubungkan satu sales
Ambil UID dokumen sales dari Firebase Authentication (UID) dan pastikan dokumen `users/{UID}` berisi `role: "Sales"` (case-insensitive), `name`, dan `branch`.

Contoh PowerShell:
```powershell
$headers = @{ "x-erra-admin-key" = "ISI_ADMIN_API_KEY_DARI_ENV" }
$body = @{ salesId = "UID_SALES_FIREBASE"; salesName = "SELLER BEKASI"; branch = "Bekasi" } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "http://localhost:3000/api/sessions" -Headers $headers -ContentType "application/json" -Body $body
```
API mengambil `name` dan `branch` dari `users/{UID}` jika tersedia. `salesId` harus sama persis dengan UID Firebase Auth yang dipakai Erra.

Lihat status:
```powershell
Invoke-RestMethod -Uri "http://localhost:3000/api/sessions" -Headers $headers
```
Ambil QR (respons mengandung `qrDataUrl`; buka data URL di browser atau buat halaman admin internal untuk menampilkan gambar):
```powershell
Invoke-RestMethod -Uri "http://localhost:3000/api/sessions/UID_SALES_FIREBASE/qr" -Headers $headers
```
Di WhatsApp sales: Perangkat tertaut → Tautkan perangkat → scan QR. Jangan bagikan QR ke orang lain.

Untuk menonaktifkan koneksi tetapi mempertahankan sesi:
```powershell
Invoke-RestMethod -Method Delete -Uri "http://localhost:3000/api/sessions/UID_SALES_FIREBASE" -Headers $headers
```
Untuk logout dan menghapus data sesi lokal:
```powershell
Invoke-RestMethod -Method Delete -Uri "http://localhost:3000/api/sessions/UID_SALES_FIREBASE?logout=true" -Headers $headers
```

## 5. Mapping UID sales ke Firestore
- Collection `users`: dokumen ID harus UID Firebase Authentication.
- Field yang dibaca: `role`, `name`, `branch`.
- Nomor WhatsApp terhubung disimpan di metadata lokal backend berdasarkan `salesId`.
- Setiap lead ditulis ke collection yang sudah ada: `leads`.
- Field lead: `nama`, `nomorWa`, `kebutuhan`, `budget`, `referensiLaptop`, `status`, `salesId`, `salesName`, `branch`, `source`, `createdAt`, `updatedAt`, `lastMessageAt`, `lastMessagePreview`, `createdBy`.
- `source` bernilai `whatsapp_auto`; lead manual lama tidak perlu diubah.
- Lead dicari dengan pasangan `salesId + nomorWa`; jika sudah ada untuk sales itu, data yang berhasil dideteksi diperbarui dan status yang sudah diubah sales tidak ditimpa.
- Dedup pesan menggunakan collection tambahan `erraProcessedMessages`. Collection ini hanya untuk mencegah pesan yang sama diproses ulang.

## 6. Pola yang dideteksi
Contoh pesan: `Halo kak, saya Budi. Cari laptop buat kuliah budget 3 jutaan`.
- Nama: Budi (atau nama profil WhatsApp jika tidak ada pola nama eksplisit)
- Kebutuhan: Kuliah
- Budget: 3 Jutaan
- Nomor: nomor WhatsApp pengirim

Aturan kebutuhan mencakup Gaming, coding, Kuliah, Sekolah, Kerja, Personal. Pesan "halo" saja tidak membuat lead. Teks ambigu bisa salah klasifikasi; sales harus tetap memeriksa data.

## 7. Keamanan dan produksi
- API admin memakai header `x-erra-admin-key`; endpoint ini jangan dipublikasikan tanpa HTTPS, firewall atau VPN.
- Jangan memasukkan key admin ke APK/Flutter karena dapat diekstrak. Buat halaman admin web yang aman atau panggil API melalui backend autentikasi.
- Simpan folder `sessions/` persisten dan privat. Jangan hapus folder itu saat restart; isinya memungkinkan WhatsApp tetap tertaut.
- Pastikan hosting menjaga file session dan membatasi aksesnya.
- Pertimbangkan TTL Firestore untuk `erraProcessedMessages` setelah mengatur TTL di Firebase Console.
- Sebelum dipakai tim, uji dengan nomor sales percobaan dan database staging.

## 8. Uji parser lokal
```bash
node src/extractor.js
```
