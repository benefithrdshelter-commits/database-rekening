# Database Rekening — Upload PDF Mandiri

Aplikasi web (PWA) untuk mengubah PDF **Transaction Report** Kopra Mandiri menjadi baris di spreadsheet
**DATABASE REKENING** (sheet `Data Upah`, 5 kolom: Nama, Bank, No Rekening, Site Bisnis, Site Penempatan).

- PDF dibaca di browser (pdf.js). File tidak diunggah ke server mana pun.
- Setiap batch dicocokkan dengan jumlah transaksi & total nominal dari bank; kalau ada yang tidak cocok, tidak ada data yang dikirim.
- Transfer Failed dibuang, batch yang sudah pernah dikirim dilewati (anti-dobel).
- Bisa di-install sebagai aplikasi di desktop (Chrome/Edge) dan HP (Android/iOS).

## Deploy ke GitHub Pages
1. Buat repo baru di GitHub, upload **semua file di folder ini** (19 file, tanpa subfolder).
2. Settings → Pages → Source: *Deploy from a branch* → Branch `main`, folder `/ (root)` → Save.
3. Tunggu 1–2 menit, aplikasi tersedia di `https://<username>.github.io/<nama-repo>/`.

## Konfigurasi
Edit `config.js`:
- `SCRIPT_URL` → URL Web App Apps Script (berakhiran `/exec`).
- `SPREADSHEET_URL` → link spreadsheet (sudah terisi).

**Jangan** menulis kode akses di repo. Repo GitHub Pages bersifat publik.
Kode akses dimasukkan pengguna lewat tombol status koneksi / *Pengaturan koneksi* dan hanya tersimpan di browser masing-masing.

## Update aplikasi
Setelah mengubah file, naikkan `VERSION` di `sw.js` (misal `dbrek-v2`) supaya aplikasi yang sudah ter-install mengambil versi baru.

## Rekening sumber dana baru
Kalau ada PDF dari rekening sumber dana lain, tambahkan di `parser.js` bagian `SUMBER_DANA`.
