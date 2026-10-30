# EverUs V1.3 — Google Sheets + Apps Script

## Yang diubah
- Menghapus komponen WebAuthn/passkey yang tidak jadi dipakai (`passkey-*`, `server.mjs`, dan `package.json`).
- Menambahkan `admin.html`/`admin.js`: admin dapat mengubah username/password User A, User B, dan admin; mengirim notifikasi langsung; menjadwalkan notifikasi sekali/harian/mingguan; mengaktifkan/nonaktifkan barcode; mengganti barcode dengan gambar persegi; melihat daftar bukti foto dan menghapus bukti.
- Backend Apps Script disertakan sebagai `AppsScript-Code.gs` dan seed sebagai `AppsScript-Seed.gs`.
- Jika opsi akses setiap hari tidak dicentang, tombol Menabung tetap aktif dan pop-up pemberitahuan tetap tampil; barcode dan konfirmasi transaksi hanya tersedia setiap Rabu (zona waktu Asia/Jakarta).
- Endpoint dashboard mengirim URL barcode terbaru dari Settings.

## Pemasangan
1. Buat/cadangkan salinan Google Sheet lama.
2. Buka Apps Script yang dipakai web ini. Ganti backend lama dengan isi `AppsScript-Code.gs`. Tambahkan isi `AppsScript-Seed.gs` sebagai file terpisah jika belum ada fungsi seed.
3. Jalankan `setupSheets()` satu kali. Sheet baru `NotificationSchedules` dan `FaceProofs` akan dibuat. Sheet yang sudah ada tidak dihapus.
4. Di **Project Settings > Script Properties**, pastikan `SPREADSHEET_ID` ada. Tambahkan:
   - `ADMIN_INITIAL_PASSWORD`: password admin sementara, minimal 12 karakter.
   - `ADMIN_USERNAME`: opsional, default `admin`.
   - `BARCODE_FOLDER_ID`: opsional, ID folder Drive untuk menyimpan barcode.
   - `FACE_PROOF_FOLDER_ID`: opsional, ID folder Drive untuk bukti foto.
5. Jalankan `authorizeDriveAccess()` satu kali dari editor Apps Script dan setujui izin Google Drive. Jika menggunakan `BARCODE_FOLDER_ID`, pastikan ID folder benar dan akun pemilik Apps Script memiliki akses Editor.
6. Jalankan `createAdminAccount()` satu kali dari editor Apps Script. Password admin diambil dari `ADMIN_INITIAL_PASSWORD`, lalu akun dibuat dengan ID `ADMIN001`. Setelah berhasil, hapus properti `ADMIN_INITIAL_PASSWORD` dan ubah password melalui panel admin.
7. Buat trigger Apps Script untuk `processScheduledNotifications`: Triggers > Add Trigger > function `processScheduledNotifications` > Time-driven > Minutes timer > Every 5 minutes.
8. Deploy ulang Apps Script sebagai Web App (execute as owner; akses sesuai model aplikasi Anda), lalu pastikan `API_URL` di `config.js` menunjuk ke URL `/exec` terbaru.
9. Upload file frontend ke hosting yang sama. Login dengan akun admin akan diarahkan ke `admin.html`.

## Crop barcode
Pilih gambar; sistem memotong bagian tengah menjadi persegi 1:1 dan menampilkan pratinjau sebelum disimpan. Ini bukan editor crop geser/zoom; bila Anda membutuhkan kontrol crop interaktif, perlu ditambahkan komponen crop khusus.

## Bukti foto wajah
Di konfirmasi menabung, pengguna dapat memilih/mengambil foto. Foto dikirim ke Drive dan metadata masuk ke sheet `FaceProofs`; admin dapat membuka link dan menghapus file melalui panel. Foto ini bersifat sensitif: minta persetujuan yang jelas, batasi akses Drive, tentukan masa retensi, dan jangan jadikan foto wajah sebagai satu-satunya verifikasi identitas. Untuk memastikan admin bisa membuka file, admin harus memiliki akses ke akun Drive pemilik Apps Script.

## Penting
- Jadwal membutuhkan trigger yang disebut di atas. Waktu jadwal menggunakan waktu lokal browser saat disimpan.
- Password pada backend lama masih memakai SHA-256 tanpa salt; untuk aplikasi keuangan nyata, sebaiknya migrasikan ke password hashing yang sesuai dan tambahkan rate limiting/audit log.
- Ini merupakan peningkatan prototipe. Uji semua alur di salinan spreadsheet sebelum dipakai dengan data asli.


## Pembaruan fitur admin, barcode, dan selfie

- Status barcode yang diatur admin menjadi satu-satunya kontrol ketersediaan. Jika opsi akses setiap hari aktif, barcode tersedia setiap hari. Jika tidak aktif, barcode hanya tersedia setiap hari Rabu; tombol Menabung tetap bisa ditekan dan menampilkan pop-up pemberitahuan pada hari lain.
- Barcode yang diunggah admin disimpan pada pengaturan server dan ditampilkan pada menu barcode pengguna.
- Admin dapat menggeser dan memperbesar gambar pada crop persegi 1:1 sebelum menyimpan barcode.
- Konfirmasi transaksi mewajibkan foto yang diambil langsung melalui kamera. Foto dikirim bersama permintaan transaksi dan disimpan privat pada Google Drive.

### Langkah penerapan pembaruan

1. Ganti file frontend pada hosting dengan file dalam paket pembaruan ini.
2. Buka proyek Google Apps Script yang terhubung ke spreadsheet EverUs, lalu ganti kode dengan isi `AppsScript-Code.gs` terbaru.
3. Simpan dan deploy ulang sebagai Web App (gunakan deployment yang sama atau buat versi deployment baru sesuai pengaturan proyek).
4. Pastikan Script Properties `SPREADSHEET_ID` tetap terisi. `FACE_PROOF_FOLDER_ID` dan `BARCODE_FOLDER_ID` bersifat opsional; jika tidak diisi, file disimpan pada Drive milik pemilik Apps Script.
5. Pastikan halaman web dibuka melalui HTTPS agar browser mengizinkan akses kamera. Pengguna perlu memberikan izin kamera.
6. Login sebagai admin, unggah barcode QRIS, atur crop, lalu aktifkan fitur barcode.

Catatan: foto selfie merupakan data pribadi. Beri tahu pengguna tujuan pengambilan dan penyimpanannya, batasi akses admin, dan hapus bukti yang sudah tidak diperlukan.


## Pembaruan panel admin dan galeri bukti foto

- Panel admin memakai sidebar dengan halaman terpisah: Ringkasan, Akun Pengguna, Pengaturan Barcode, Notifikasi, dan Bukti Foto.
- Bukti foto ditampilkan sebagai kartu galeri, bukan teks HTML/link mentah.
- Galeri memiliki filter bulan/tahun dan pencarian ID pengguna, ID transaksi, atau ID bukti.
- Foto dapat dibuka melalui pratinjau dalam halaman admin dan tetap menyediakan tautan untuk membuka file di Google Drive.
- Penghapusan meminta konfirmasi. Backend hanya menghapus baris metadata setelah file berhasil dipindahkan ke Sampah Google Drive; jika Drive menolak, data bukti tetap dipertahankan.
- Endpoint admin memuat seluruh daftar bukti agar filter bulan tidak terbatas pada 100 data terbaru. Jika jumlah foto sudah sangat besar, sebaiknya ditambahkan pagination agar pemuatan tetap ringan.

Setelah mengganti `admin.html`, `admin.js`, dan `AppsScript-Code.gs`, deploy ulang Web App Apps Script sebagai versi baru. Pastikan akun pemilik deployment memiliki izin ke folder `FACE_PROOF_FOLDER_ID` dan foto yang tersimpan. Uji pratinjau serta penghapusan menggunakan satu data percobaan terlebih dahulu.
