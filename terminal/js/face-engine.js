/* =====================================================================
 * RUPA · face-engine.js
 * Kamera (getUserMedia) + MediaPipe Face Landmarker, berjalan 100% lokal.
 *
 * - Model & wasm dibaca dari folder project (models/, vendor/mediapipe/),
 *   tidak ada CDN.
 * - Frame kamera hanya diproses di memori browser ini. Tidak ada frame,
 *   foto, atau landmark yang dikirim ke server mana pun (index.html juga
 *   memasang CSP connect-src 'self' sebagai pengaman tambahan).
 *
 * BATASAN (jujur): modul ini hanya melakukan DETEKSI wajah + landmark.
 * Liveness check dan pencocokan template wajah ke akun BELUM ada; di
 * prototype keduanya masih simulasi.
 * ===================================================================== */
import { FilesetResolver, FaceLandmarker } from '../vendor/mediapipe/vision_bundle.mjs';

const ROOT = new URL('../', import.meta.url);
const WASM_DIR = new URL('vendor/mediapipe/wasm', ROOT).href;
const MODEL_URL = new URL('models/face_landmarker.task', ROOT).href;
const DEVICE_KEY = 'rupa.terminal.cameraId';

/* Pesan error — sama dengan CameraCapture.vue, ditambah dua kasus khusus terminal. */
export const MSG = {
  denied: 'Izin kamera ditolak. Silakan izinkan akses kamera di pengaturan browser Anda.',
  notFound: 'Tidak ada kamera yang ditemukan di perangkat ini.',
  generic: 'Gagal mengakses kamera. Pastikan kamera tersedia dan browser memiliki izin.',
  noneSelected: 'Tidak ada kamera yang dipilih.',
  openFail: 'Gagal membuka kamera. Coba pilih kamera lain.',
  ended: 'Kamera terputus. Periksa sambungan kamera lalu coba lagi.',
  insecure: 'Kamera hanya bisa dibuka lewat http://localhost atau https. Jalankan "node serve.mjs" lalu buka alamat yang ditampilkan.',
  model: 'Gagal memuat model deteksi wajah lokal. Pastikan folder models/ dan vendor/ lengkap.'
};

function mapError(err, phase) {
  console.error(phase === 'init' ? 'Camera enumeration error:' : 'Camera start error:', err);
  if (err?.name === 'NotAllowedError' || err?.name === 'SecurityError') return new Error(MSG.denied);
  if (phase === 'init') return new Error(err?.name === 'NotFoundError' ? MSG.notFound : MSG.generic);
  return new Error(MSG.openFail);
}

/* ------------------------------------------------------------------ */
/* Kamera                                                              */
/* ------------------------------------------------------------------ */
export class Camera {
  /** @param {HTMLVideoElement[]} videos semua <video> yang menampilkan feed yang sama */
  constructor(videos) {
    this.videos = videos;
    this.stream = null;
    this.devices = [];
    this.deviceId = localStorage.getItem(DEVICE_KEY) || '';
    this.onEnded = null;      // dipanggil kalau kamera dicabut / track berhenti sendiri
    this.onDevices = null;    // dipanggil setelah daftar kamera diperbarui
    this.sourceFactory = null; // opsional: () => MediaStream (mode uji tanpa webcam)
  }

  get running() { return !!this.stream; }

  async start() {
    this.stop();
    const token = this.token;   // stop() menaikkan token → start() yang masih menunggu dibatalkan
    const aborted = () => { const e = new Error('Kamera dibatalkan'); e.aborted = true; return e; };
    let stream;
    if (this.sourceFactory) {
      stream = this.sourceFactory();
    } else {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error(MSG.insecure);
      const phase = this.devices.length ? 'start' : 'init';
      const base = { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } };
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: this.deviceId ? { ...base, deviceId: { exact: this.deviceId } } : { ...base, facingMode: 'user' }
        });
      } catch (err) {
        if (token !== this.token) throw aborted();
        // kamera yang tersimpan sudah tidak ada → ulangi dengan kamera default
        if (this.deviceId && (err?.name === 'OverconstrainedError' || err?.name === 'NotFoundError')) {
          this.deviceId = '';
          return this.start();
        }
        throw mapError(err, phase);
      }
    }
    if (token !== this.token) { stream.getTracks().forEach(t => t.stop()); throw aborted(); }
    this.stream = stream;
    const track = stream.getVideoTracks()[0];
    if (!track) { this.stop(); throw new Error(MSG.notFound); }
    track.addEventListener('ended', () => { if (this.stream === stream) { this.stop(); this.onEnded?.(); } });

    await Promise.all(this.videos.map(async v => {
      v.srcObject = stream;
      v.muted = true; v.playsInline = true;
      if (v.readyState < 1) await new Promise(r => v.addEventListener('loadedmetadata', r, { once: true }));
      try { await v.play(); } catch (e) { /* autoplay sudah diizinkan karena muted */ }
    }));
    if (token !== this.token) throw aborted();

    if (!this.sourceFactory) {
      const id = track.getSettings?.().deviceId;
      if (id) { this.deviceId = id; localStorage.setItem(DEVICE_KEY, id); }
      try {
        const all = await navigator.mediaDevices.enumerateDevices();
        this.devices = all.filter(d => d.kind === 'videoinput');
      } catch { /* daftar kamera opsional */ }
      if (!this.devices.length) this.devices = [{ deviceId: this.deviceId, label: track.label || 'Kamera 1' }];
      this.onDevices?.(this.devices, this.deviceId);
    }
    return stream;
  }

  stop() {
    this.token = (this.token || 0) + 1;
    if (this.stream) { this.stream.getTracks().forEach(t => t.stop()); this.stream = null; }
    this.videos.forEach(v => { v.pause?.(); v.srcObject = null; });
  }

  /** Ganti kamera. Kembalikan true kalau perlu restart. */
  async selectDevice(id) {
    if (!id) throw new Error(MSG.noneSelected);
    this.deviceId = id; localStorage.setItem(DEVICE_KEY, id);
    if (this.running) await this.start();
  }
}

/* ------------------------------------------------------------------ */
/* Face Landmarker (lokal)                                             */
/* ------------------------------------------------------------------ */
let landmarker = null, loading = null, lastTs = 0;

export function loadFaceModel() {
  if (landmarker) return Promise.resolve(landmarker);
  if (!loading) {
    loading = (async () => {
      const fileset = await FilesetResolver.forVisionTasks(WASM_DIR);
      const options = delegate => ({
        baseOptions: { modelAssetPath: MODEL_URL, delegate },
        runningMode: 'VIDEO',
        numFaces: 2,                     // 2 supaya kita tahu kalau ada lebih dari satu wajah
        minFaceDetectionConfidence: 0.6,
        minFacePresenceConfidence: 0.6,
        minTrackingConfidence: 0.5,
        outputFaceBlendshapes: false,
        outputFacialTransformationMatrixes: false
      });
      try {
        landmarker = await FaceLandmarker.createFromOptions(fileset, options('GPU'));
      } catch (e) {
        console.warn('Delegate GPU tidak tersedia, pakai CPU.', e);
        landmarker = await FaceLandmarker.createFromOptions(fileset, options('CPU'));
      }
      return landmarker;
    })().catch(err => { loading = null; console.error('Face model error:', err); throw new Error(MSG.model); });
  }
  return loading;
}

/** Loop deteksi: satu inferensi per frame video baru. */
export class FaceTracker {
  constructor(video, onResult) {
    this.video = video; this.onResult = onResult; this.raf = 0; this.lastVideoTime = -1;
  }
  start() {
    if (this.raf) return;
    const loop = () => { this.raf = requestAnimationFrame(loop); this.step(); };
    this.raf = requestAnimationFrame(loop);
  }
  stop() { cancelAnimationFrame(this.raf); this.raf = 0; this.lastVideoTime = -1; }
  step() {
    const v = this.video;
    if (!landmarker || v.readyState < 2 || !v.videoWidth || v.currentTime === this.lastVideoTime) return;
    this.lastVideoTime = v.currentTime;
    let ts = performance.now(); if (ts <= lastTs) ts = lastTs + 1; lastTs = ts; // harus naik terus
    let res;
    try { res = landmarker.detectForVideo(v, ts); } catch (e) { console.error(e); return; }
    this.onResult(res?.faceLandmarks || [], v.videoWidth, v.videoHeight);
  }
}

/* ------------------------------------------------------------------ */
/* Geometri: landmark (0..1 di frame video) → koordinat stage 1280×800 */
/* ------------------------------------------------------------------ */
/**
 * Video ditampilkan object-fit:cover di kotak `box` (koordinat stage).
 * @returns {(p:{x:number,y:number}) => {x:number,y:number}}
 */
export function makeMapper(vw, vh, box, mirrored) {
  const s = Math.max(box.w / vw, box.h / vh);
  const dw = vw * s, dh = vh * s, ox = (box.w - dw) / 2, oy = (box.h - dh) / 2;
  return p => {
    let x = p.x * dw + ox;
    if (mirrored) x = box.w - x;
    return { x: box.x + x, y: box.y + p.y * dh + oy };
  };
}

const avg = (lm, ids) => {
  let x = 0, y = 0; for (const i of ids) { x += lm[i].x; y += lm[i].y; }
  return { x: x / ids.length, y: y / ids.length };
};

/**
 * Ringkasan wajah utama (yang terbesar) dalam koordinat stage.
 * yaw: offset hidung terhadap titik tengah mata, dinormalisasi jarak mata (≈0 = menghadap lurus).
 */
export function analyzeFaces(faces, map) {
  if (!faces.length) return { count: 0, face: null };
  let best = null;
  for (const lm of faces) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < 468; i++) {           // 468 titik mesh (tanpa iris)
      const p = lm[i]; if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x; if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y;
    }
    const area = (x1 - x0) * (y1 - y0);
    if (!best || area > best.area) best = { lm, area };
  }
  const lm = best.lm;
  const pts = lm.map(map);                     // semua titik ke koordinat stage
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < 468; i++) {
    const p = pts[i]; if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x; if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y;
  }
  const eyeR = avg(lm, [33, 133]), eyeL = avg(lm, [263, 362]), nose = lm[1];
  const eyeDist = Math.hypot(eyeL.x - eyeR.x, eyeL.y - eyeR.y) || 1e-6;
  const yaw = (nose.x - (eyeR.x + eyeL.x) / 2) / eyeDist;
  return {
    count: faces.length,
    face: { pts, box: { x: x0, y: y0, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 }, yaw }
  };
}

/** Titik "virtual" = rata-rata beberapa indeks landmark. */
export function point(pts, ids) {
  if (typeof ids === 'number') return pts[ids];
  let x = 0, y = 0; for (const i of ids) { x += pts[i].x; y += pts[i].y; }
  return { x: x / ids.length, y: y / ids.length };
}

/* ------------------------------------------------------------------ */
/* Sumber uji tanpa webcam (?uji=1) — hanya untuk development           */
/* ------------------------------------------------------------------ */
/**
 * Mengembalikan factory MediaStream dari canvas yang menggambar foto dummy prototype.
 * Tombol H menyembunyikan/menampilkan wajah untuk menguji "wajah hilang".
 */
export function createTestSource(personSrc, bgSrc) {
  const c = document.createElement('canvas'); c.width = 1280; c.height = 720;
  const ctx = c.getContext('2d');
  const person = new Image(), bg = new Image(); person.src = personSrc; bg.src = bgSrc;
  const state = { hidden: false, t0: performance.now() };
  addEventListener('keydown', e => { if (e.key === 'h' || e.key === 'H') state.hidden = !state.hidden; });
  const draw = () => {
    const t = (performance.now() - state.t0) / 1000;
    ctx.fillStyle = '#cfd6d5'; ctx.fillRect(0, 0, c.width, c.height);
    if (bg.complete && bg.naturalWidth) ctx.drawImage(bg, 0, 0, c.width, c.height);
    if (!state.hidden && person.complete && person.naturalWidth) {
      const h = 640, w = person.naturalWidth * h / person.naturalHeight;
      ctx.drawImage(person, (c.width - w) / 2 + Math.sin(t * 0.9) * 14, c.height - h + 40 + Math.cos(t * 0.7) * 6, w, h);
    }
  };
  setInterval(draw, 1000 / 30); draw();
  return () => c.captureStream(30);
}
