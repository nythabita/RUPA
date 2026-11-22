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
