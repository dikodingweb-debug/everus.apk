# EverUs — PWA untuk GitHub Pages

EverUs dapat dipasang di layar utama HP sebagai aplikasi web (PWA). Frontend di-host melalui GitHub Pages, sedangkan backend tetap menggunakan Google Apps Script, Google Sheets, dan Google Drive.

## Struktur
- `login.html`, `dashboard.html`, `admin.html`: halaman aplikasi.
- `config.js`: alamat Web App Google Apps Script.
- `AppsScript-Code.gs` dan `AppsScript-Seed.gs`: backend Apps Script.
- `manifest.webmanifest`, `service-worker.js`, `pwa.js`, `icons/`: dukungan PWA.

## Deploy ke GitHub Pages
1. Buat repository baru di GitHub, misalnya `everus`.
2. Ekstrak seluruh isi folder ini. Upload semua file dan folder ke **root repository** (pastikan `index.html` berada langsung di root, bukan di dalam folder tambahan).
3. Buka **Settings → Pages** pada repository.
4. Pada **Build and deployment**, pilih **Deploy from a branch**.
5. Pilih branch `main` dan folder `/ (root)`, lalu klik **Save**.
6. Tunggu proses deploy selesai. URL aplikasi biasanya berbentuk `https://USERNAME.github.io/everus/`.
7. Buka URL tersebut. Pastikan halaman login muncul dan tes login dengan akun uji.

> GitHub Pages hanya meng-host frontend statis. Jangan memindahkan file `.gs` ke GitHub Pages untuk menjalankannya. Backend tetap harus di-deploy sebagai Google Apps Script Web App.

## Konfigurasi backend
1. Buka `config.js` dan pastikan `API_URL` berisi URL deployment Google Apps Script yang berakhiran `/exec`.
2. Jika backend belum dipasang, ikuti petunjuk pada `README-V1.3.md` untuk menyiapkan Google Sheets, Script Properties, izin Drive, akun admin, dan trigger notifikasi.
3. Setelah mengubah kode Apps Script, deploy versi Web App terbaru. URL `/exec` biasanya tetap sama jika menggunakan deployment yang sama; jika URL berubah, perbarui `API_URL` di `config.js`, lalu upload perubahan ke GitHub.

## Memasang di HP
### Android (Chrome)
1. Buka URL GitHub Pages EverUs melalui Chrome.
2. Tekan menu ⋮.
3. Pilih **Install app** atau **Tambahkan ke layar utama**.
4. Ikuti konfirmasi. Ikon EverUs akan muncul di layar utama.

### iPhone/iPad (Safari)
1. Buka URL GitHub Pages melalui Safari.
2. Tekan tombol **Share/Bagikan**.
3. Pilih **Add to Home Screen / Tambahkan ke Layar Utama**.
4. Tekan **Add/Tambahkan**.

## Catatan penting
- GitHub Pages menyediakan HTTPS, yang dibutuhkan untuk PWA dan akses kamera.
- Service worker menyimpan aset frontend agar halaman lebih cepat dan sebagian tampilan dapat dibuka saat offline. Login, transaksi, sinkronisasi data, unggah selfie, barcode, dan fitur admin tetap memerlukan koneksi internet karena menggunakan Apps Script/Google Drive.
- Jika aplikasi tidak menampilkan pembaruan setelah upload, tutup aplikasi lalu buka ulang. Service worker akan memperbarui cache saat browser mengambil versi baru.
- `API_URL` terlihat oleh pengguna karena berada di frontend. Jangan menaruh password, token rahasia, atau kredensial admin di `config.js`.
- Uji semua fitur terlebih dahulu dengan akun dan spreadsheet percobaan sebelum digunakan untuk data sungguhan.
