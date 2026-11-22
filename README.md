# RUPA / Face Pay — Prototype Terminal Kasir (Tahap 1)

## Menjalankan
```
node serve.mjs
```
Buka **http://localhost:8080/terminal/** (kamera butuh `localhost` atau https; membuka file HTML langsung via `file://` tidak akan jalan).

- `?uji=1` → mode uji tanpa webcam: memakai foto dummy prototype sebagai "kamera". Tombol **H** menyembunyikan/menampilkan wajah untuk menguji alur "wajah hilang".
- Nav di bawah terminal: pilih kamera (muncul kalau ada >1 kamera) dan **Cermin** (default aktif, shortcut **M**).

## Struktur
```
terminal/
  index.html                 UI terminal (CSS + alur layar; animasi asli tidak diubah)
  js/face-engine.js          kamera (getUserMedia) + MediaPipe Face Landmarker
  assets/                    gambar yang dulu base64 (qris, gopay, foto dummy untuk mode uji)
  models/face_landmarker.task   model resmi MediaPipe (float16)
  vendor/mediapipe/          @mediapipe/tasks-vision 1.2.3 (bundle + wasm), Apache-2.0
serve.mjs                    server statis lokal, tanpa dependency
RUPA 1ST DRAFT HTML PROTOTYPE.html   prototype asli (tidak diubah, sebagai arsip)
```

## Alur status di layar kamera
1. **Posisikan wajah Anda** — menunggu tepat satu wajah, berada di dalam hexagon, ukuran wajar, dan menghadap lurus, stabil ±0,45 detik.
2. **Wajah terdeteksi** — jeda 0,55 detik (batal kalau wajah keluar posisi).
3. **Memindai** — progres, dot, dan mesh menempel pada landmark wajah asli. Kalau wajah hilang/keluar posisi >0,25 detik, progres mundur dan kembali ke langkah 1.
4. **Wajah Terverifikasi** → layar otorisasi. Kamera dimatikan setelah feed memudar.

## Privasi
- Semua inferensi berjalan di browser. Model & wasm dibaca dari folder project, tanpa CDN.
- `index.html` memasang Content-Security-Policy `connect-src 'self'`: browser menolak koneksi ke host lain, termasuk telemetri pemakaian bawaan MediaPipe (`odml.pa.googleapis.com`).
- Satu-satunya akses luar: stylesheet font Google Fonts (tidak membawa data kamera).

## Batasan (jangan diklaim lebih)
Ini **deteksi wajah + landmark**, bukan pengenalan identitas. Liveness check dan pencocokan template wajah ke akun **belum ada**; "Wajah Terverifikasi" di prototype masih simulasi.

---

# Tahap 2 — App Registrasi (One-Time Setup), folder `app/`

Buka **http://localhost:8080/app/** (server yang sama, `node serve.mjs`). Mobile-first: di HP tampil layar penuh; di layar lebar tampil sebagai kolom di tengah (max-width 480px). Ukuran teks & jarak memakai `clamp()`; layar pendek otomatis dirapatkan.

`?uji=1` / `?uji=hp` → mode uji tanpa kamera (foto dummy sebagai kamera landscape / portrait).

## Alur (16 layar)
Splash → Onboarding → Buat Akun → OTP → **Foto KTP** → **Cek Data KTP** → Memverifikasi KTP → KTP Terverifikasi → Izin Data Wajah → Pindai Wajah → Memindai Wajah → Mengamankan Data Wajah → Wajah Terdaftar → Pilih Sumber Pembayaran → Menautkan (sumber) → Face Pay Aktif.
Layar tebal = tambahan (tidak ada di board desain), dibuat mengikuti gaya yang sama.

| Bagian | Asli / Simulasi |
|---|---|
| Validasi form (nama, no HP Indonesia, email, NIK 16 digit) | asli (di browser) |
| Kode OTP | simulasi — 6 digit apa saja diterima; ketuk kotak = isi otomatis |
| Kamera KTP (kamera belakang) + potong sesuai bingkai | asli |
| Pembacaan data KTP (NIK, nama, tgl lahir) | simulasi — data contoh, bisa diedit |
| Cek Dukcapil | simulasi |
| Kamera wajah + deteksi wajah/landmark (MediaPipe lokal) | asli — progres hanya jalan saat tepat satu wajah di tengah heksagon, menghadap lurus; mundur ke 0 kalau wajah hilang |
| Liveness | simulasi (teks di layar ditandai "simulasi") |
| Template, enkripsi, simpan ke backend | simulasi — tidak ada yang dikirim/disimpan |
| Penautan GoPay/OVO/DANA/ShopeePay/bank | simulasi |

Foto KTP dan frame kamera hanya ada di memori browser (blob URL), dihapus saat "Ke Beranda". CSP `connect-src 'self'` sama seperti terminal. Tombol back Android/browser mengikuti alur (layar proses tidak bisa dimundurkan).

## Struktur
```
app/
  index.html        semua layar (markup)
  css/app.css       design system + layout responsif
  js/app.js         router, form, OTP demo, kamera KTP, pindai wajah, proses simulasi
  js/face-engine.js salinan dari terminal (+ opsi kamera belakang & penyimpanan kamera terpisah)
  vendor/, models/  MediaPipe & model lokal (salinan, supaya app bisa di-deploy sendiri)
  vercel.json       header cache & izin kamera
```
