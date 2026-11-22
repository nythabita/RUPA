/* =====================================================================
 * RUPA · App registrasi (One-Time Setup) — MVP
 *
 * ASLI   : kamera (foto KTP & wajah), deteksi wajah + landmark MediaPipe (lokal).
 * SIMULASI (tidak ada backend): kode OTP, pembacaan data KTP, cek Dukcapil,
 *          liveness, pembuatan/enkripsi/penyimpanan template wajah, penautan
 *          sumber dana. Foto KTP & frame kamera hanya ada di memori browser.
 * ===================================================================== */
import { Camera, FaceTracker, loadFaceModel, analyzeFaces, makeMapper, createTestSource, MSG } from './face-engine.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const app = $('#app');
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const sleep = ms => new Promise(r => setTimeout(r, reduce ? Math.min(ms, 80) : ms));
const rupiah = n => 'Rp' + Number(n).toLocaleString('id-ID');

const SAMPLE = { nik: '3201011405030001', lahir: '2003-05-14' };   // data contoh "hasil baca" KTP
const fresh = () => ({ name: '', phone: '', email: '', nik: '', namaKtp: '', lahir: '', ktpUrl: '', provider: 'GoPay', limit: 500000 });
let state = fresh();

/* ---------- header langkah (tombol kembali + 4 segmen + label) ---------- */
$$('.screen[data-step]').forEach(s => {
  const step = +s.dataset.step, back = !s.hasAttribute('data-noback');
  s.querySelector('.top').innerHTML =
    `<div class="row">${back ? '<button class="back" data-back aria-label="Kembali"><svg class="ic"><use href="#i-back"/></svg></button>' : ''}` +
    `<div class="segs">${[1, 2, 3, 4].map(i => `<i class="${i <= step ? 'on' : ''}"></i>`).join('')}</div></div>` +
    `<p class="step-label">Langkah ${step} dari 4</p>`;
});

/* ---------- router ---------- */
const ORDER = ['splash', 'onboard', 'akun', 'otp', 'ktpfoto', 'ktpcek', 'ktpverif', 'ktpok', 'izin', 'pindai', 'memindai', 'amankan', 'terdaftar', 'sumber', 'tautkan', 'aktif'];
const SECTION = { pindai: 'scan', memindai: 'scan' };
// tujuan tombol kembali (termasuk tombol back Android); layar proses tidak bisa dikembalikan
const BACK = { onboard: 'splash', akun: 'onboard', otp: 'akun', ktpfoto: 'otp', ktpcek: 'ktpfoto', izin: 'ktpok', pindai: 'izin', memindai: 'pindai', sumber: 'terdaftar' };
const sec = name => $(`.screen[data-screen="${SECTION[name] || name}"]`);
const enter = {}, leave = {};
let cur = null, runId = 0;

function go(name, { pop = false, replace = false } = {}) {
  if (name === cur) return;
  const prev = cur, id = ++runId;
  if (prev) leave[prev]?.(name);
  const prevEl = prev && sec(prev), nextEl = sec(name);
  app.style.setProperty('--dir', ORDER.indexOf(name) >= ORDER.indexOf(prev) ? 1 : -1);
  if (prevEl !== nextEl) {
    if (prevEl) { prevEl.classList.remove('is-active'); prevEl.classList.add('is-leaving'); setTimeout(() => prevEl.classList.remove('is-leaving'), 480); }
    nextEl.classList.add('is-active'); nextEl.scrollTop = 0;
  }
  cur = name;
  if (!pop) history[replace ? 'replaceState' : 'pushState']({ s: name }, '');
  enter[name]?.(() => id === runId, prev);
  requestAnimationFrame(markScroll);
}
// layar yang isinya lebih tinggi dari layar → tombol bawah diberi latar pudar
function markScroll() { const el = cur && sec(cur); if (el) el.classList.toggle('scrolly', el.scrollHeight > el.clientHeight + 2); }
addEventListener('popstate', () => {
  const b = BACK[cur];
  if (b) go(b, { pop: true }); else history.pushState({ s: cur }, '');   // tidak bisa mundur dari layar ini
});
document.addEventListener('click', e => {
  const back = e.target.closest('[data-back]'); if (back) { history.back(); return; }
  const to = e.target.closest('[data-go]'); if (to) go(to.dataset.go);
});

let toastT;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2800);
}
function setHint(el, kind, text) {
  el.className = 'hint' + (kind ? ' ' + kind : '');
  el.replaceChildren();
  if (!text) return;
  if (kind === 'ok') el.insertAdjacentHTML('beforeend', '<svg class="ic"><use href="#i-check"/></svg>');
  el.append(text);
}
// checklist proses (spinner → centang), lalu kembalikan apakah layar masih aktif
async function runChecklist(screen, alive, times = [900, 1150, 950]) {
  const lis = $$('.checklist li', sec(screen));
  lis.forEach(li => li.className = '');
  for (let i = 0; i < lis.length; i++) {
    lis[i].className = 'doing';
    await sleep(times[i] ?? 900); if (!alive()) return false;
    lis[i].className = 'done';
  }
  await sleep(500);
  return alive();
}

/* ---------- 01 splash · 02 onboarding ---------- */
$('#splashGo').addEventListener('click', () => go('onboard'));
$('#btnMasuk').addEventListener('click', () => toast('Masuk belum tersedia di versi MVP ini.'));

/* ---------- 03 buat akun ---------- */
const inNama = $('#inNama'), inHp = $('#inHp'), inEmail = $('#inEmail'), btnAkun = $('#btnAkun');
const touched = {};
const normHp = v => { let d = v.replace(/\D/g, ''); if (d.startsWith('62')) d = d.slice(2); else if (d.startsWith('0')) d = d.slice(1); return d; };
const hpValid = v => /^8\d{8,11}$/.test(normHp(v));
const fmtHp = v => { const d = normHp(v); return '+62 ' + [d.slice(0, 3), d.slice(3, 7), d.slice(7)].filter(Boolean).join(' '); };
const emailValid = v => /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(v.trim());
function checkAkun() {
  const okN = inNama.value.trim().length >= 3, okH = hpValid(inHp.value), okE = emailValid(inEmail.value);
  const badH = !okH && inHp.value && touched.hp, badE = !okE && inEmail.value && touched.email;
  inHp.classList.toggle('bad', !!badH); inEmail.classList.toggle('bad', !!badE); inEmail.classList.toggle('ok', okE);
  setHint($('#hintHp'), badH ? 'bad' : '', badH ? 'Nomor HP belum valid. Contoh: 0812 3456 7890' : '');
  setHint($('#hintEmail'), okE ? 'ok' : badE ? 'bad' : '', okE ? 'Format email valid' : badE ? 'Format email belum valid. Contoh: nama@gmail.com' : '');
  btnAkun.disabled = !(okN && okH && okE);
}
[inNama, inHp, inEmail].forEach(i => i.addEventListener('input', checkAkun));
inHp.addEventListener('blur', () => { touched.hp = true; if (hpValid(inHp.value)) inHp.value = fmtHp(inHp.value); checkAkun(); });
inEmail.addEventListener('blur', () => { touched.email = true; checkAkun(); });
$('#formAkun').addEventListener('submit', e => { e.preventDefault(); if (!btnAkun.disabled) btnAkun.click(); });
btnAkun.addEventListener('click', () => {
  Object.assign(state, { name: inNama.value.trim().replace(/\s+/g, ' '), phone: fmtHp(inHp.value), email: inEmail.value.trim() });
  go('otp');
});

/* ---------- 04 OTP (simulasi: 6 digit apa saja diterima) ---------- */
const inOtp = $('#inOtp'), otpBoxes = $$('#otpBoxes span'), btnOtp = $('#btnOtp');
let otpTimer = 0;
function renderOtp() {
  const v = inOtp.value, focused = document.activeElement === inOtp;
  otpBoxes.forEach((b, i) => {
    const ch = v[i] || '';
    if (b.textContent !== ch) { b.textContent = ch; b.classList.remove('fill'); if (ch) { void b.offsetWidth; b.classList.add('fill'); } }
    b.classList.toggle('cur', focused && i === Math.min(v.length, 5));
  });
  btnOtp.disabled = v.length !== 6;
}
inOtp.addEventListener('input', () => { inOtp.value = inOtp.value.replace(/\D/g, '').slice(0, 6); renderOtp(); });
inOtp.addEventListener('focus', renderOtp); inOtp.addEventListener('blur', renderOtp);
// ketuk kotak saat masih kosong → isi otomatis (demo); kalau sudah terisi → bisa diedit manual
inOtp.addEventListener('pointerdown', async e => {
  if (inOtp.value) return;
  e.preventDefault();
  const code = String(Math.floor(100000 + Math.random() * 900000));
  for (const c of code) { inOtp.value += c; renderOtp(); await sleep(70); }
});
function startOtpTimer(sec = 45) {
  clearInterval(otpTimer);
  const el = $('#otpResend'); let left = sec;
  const tick = () => {
    if (left <= 0) {
      clearInterval(otpTimer);
      el.innerHTML = '<button class="link" id="btnResend">Kirim ulang kode</button>';
      $('#btnResend').onclick = () => { toast('Kode baru dikirim (demo).'); inOtp.value = ''; renderOtp(); startOtpTimer(); };
      return;
    }
    el.innerHTML = `Kirim ulang kode dalam <b>00:${String(left).padStart(2, '0')}</b>`; left--;
  };
  tick(); otpTimer = setInterval(tick, 1000);
}
enter.otp = () => { $('#otpPhone').textContent = state.phone; inOtp.value = ''; renderOtp(); startOtpTimer(); };
leave.otp = () => clearInterval(otpTimer);
btnOtp.addEventListener('click', async () => {
  const id = runId;
  btnOtp.disabled = true; btnOtp.classList.add('busy'); btnOtp.textContent = 'Memverifikasi…';
  await sleep(900);
  btnOtp.classList.remove('busy'); btnOtp.textContent = 'Verifikasi';
  if (id === runId) go('ktpfoto');
});

/* ---------- mode uji tanpa kamera: ?uji=1 (landscape) · ?uji=hp (portrait) ---------- */
const TEST = new URLSearchParams(location.search).get('uji');
const testSource = TEST !== null ? createTestSource('assets/cam-person-dummy.webp', 'assets/cam-bg-dummy.webp', TEST === 'hp') : null;
const portraitScreen = () => innerHeight > innerWidth;
const camConstraints = () => portraitScreen()
  ? { width: { ideal: 720 }, height: { ideal: 1280 }, frameRate: { ideal: 30 } }
  : { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } };
// kotak "cover" video di dalam area kamera (dipakai untuk posisi video & pemetaan landmark)
function coverRect(vw, vh, W, H) {
  const s = Math.max(W / vw, H / vh), w = vw * s, h = vh * s;
  return { x: (W - w) / 2, y: (H - h) / 2, w, h, s };
}

/* ---------- 05 foto KTP (kamera belakang asli) ---------- */
const ktpCamEl = $('#ktpCam'), ktpVid = $('#ktpVid'), ktpFrame = $('#ktpFrame'), ktpShot = $('#ktpShot');
const ktpStatus = $('#ktpStatus'), btnShot = $('#btnKtpShot'), ktpErr = $('#ktpErr');
const ktpCam = new Camera([ktpVid], { storageKey: 'rupa.app.ktpCameraId', facingMode: 'environment' });
ktpCam.videoConstraints = camConstraints;
if (testSource) ktpCam.sourceFactory = testSource;
let KF = null;   // geometri bingkai KTP (px, relatif area kamera)
function layoutKtp() {
  const W = ktpCamEl.clientWidth, H = ktpCamEl.clientHeight;
  const w = Math.min(W * 0.86, 520), h = w / 1.586;
  const x = (W - w) / 2, y = Math.max(76, (H - h) / 2 - 8);
  KF = { x, y, w, h, W, H };
  for (const el of [ktpFrame, ktpShot]) Object.assign(el.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' });
  ktpStatus.style.top = Math.min(y + h + 18, H - 44) + 'px';
}
function ktpMode(m, msg) {   // 'loading' | 'live' | 'review' | 'error'
  btnShot.hidden = m === 'review'; $('#ktpReview').hidden = m !== 'review';
  $('#btnKtpSkip').hidden = m !== 'error'; ktpErr.hidden = m !== 'error'; $('#ktpTips').hidden = m === 'error';
  ktpShot.hidden = m !== 'review';
  btnShot.disabled = m === 'loading';
  btnShot.innerHTML = m === 'error' ? 'Coba Lagi' : '<svg class="ic"><use href="#i-camera"/></svg>Ambil Foto';
  if (m === 'error') ktpErr.textContent = msg;
  ktpStatus.textContent = { loading: 'Menyiapkan kamera…', live: 'Posisikan KTP di dalam bingkai', review: 'Pastikan tulisan di KTP terbaca jelas', error: 'Kamera tidak tersedia' }[m];
}
async function startKtp(alive) {
  ktpMode('loading'); ktpVid.classList.remove('on');
  try { await ktpCam.start(); }
  catch (err) { if (!err.aborted && alive()) ktpMode('error', err.message || MSG.generic); return; }
  if (!alive()) { ktpCam.stop(); return; }
  ktpVid.classList.add('on'); ktpMode('live');
}
enter.ktpfoto = alive => { layoutKtp(); startKtp(alive); };
leave.ktpfoto = () => { ktpCam.stop(); ktpVid.classList.remove('on'); };
btnShot.addEventListener('click', () => {
  if (!ktpErr.hidden) { const id = runId; startKtp(() => id === runId); return; }
  const vw = ktpVid.videoWidth, vh = ktpVid.videoHeight; if (!vw || !KF) return;
  // potong tepat area bingkai dari frame video (object-fit: cover)
  const r = coverRect(vw, vh, KF.W, KF.H);
  const sx = (KF.x - r.x) / r.s, sy = (KF.y - r.y) / r.s, sw = KF.w / r.s, sh = KF.h / r.s;
  const c = document.createElement('canvas'); c.width = Math.round(Math.min(sw, 1400)); c.height = Math.round(c.width / 1.586);
  c.getContext('2d').drawImage(ktpVid, sx, sy, sw, sh, 0, 0, c.width, c.height);
  c.toBlob(b => {
    if (!b) return;
    if (ktpShot.dataset.url) URL.revokeObjectURL(ktpShot.dataset.url);
    const url = URL.createObjectURL(b); ktpShot.src = url; ktpShot.dataset.url = url;
    ktpCam.stop(); ktpVid.classList.remove('on'); ktpMode('review');
  }, 'image/jpeg', 0.9);
});
$('#btnKtpRetake').addEventListener('click', () => { const id = runId; startKtp(() => id === runId); });
$('#btnKtpUse').addEventListener('click', () => {
  if (state.ktpUrl && state.ktpUrl !== ktpShot.dataset.url) URL.revokeObjectURL(state.ktpUrl);
  state.ktpUrl = ktpShot.dataset.url; ktpShot.dataset.url = '';
  go('ktpcek');
});
$('#btnKtpSkip').addEventListener('click', () => { state.ktpUrl = ''; go('ktpcek'); });

/* ---------- 06 cek data KTP (pembacaan simulasi) ---------- */
const inNik = $('#inNik'), inNamaKtp = $('#inNamaKtp'), inLahir = $('#inLahir'), btnKtpCek = $('#btnKtpCek');
inLahir.max = new Date().toISOString().slice(0, 10);
function checkKtp() {
  inNik.value = inNik.value.replace(/\D/g, '').slice(0, 16);
  const okNik = inNik.value.length === 16;
  setHint($('#hintNik'), okNik ? 'ok' : inNik.value ? 'bad' : '', okNik ? '16 digit' : inNik.value ? `NIK harus 16 digit (sekarang ${inNik.value.length})` : '');
  inNik.classList.toggle('bad', !okNik && !!inNik.value);
  btnKtpCek.disabled = !(okNik && inNamaKtp.value.trim().length >= 3 && inLahir.value);
}
[inNik, inNamaKtp, inLahir].forEach(i => i.addEventListener('input', checkKtp));
enter.ktpcek = async alive => {
  const thumb = $('#ktpThumb');
  if (state.ktpUrl) { const img = new Image(); img.src = state.ktpUrl; img.alt = 'Foto KTP'; thumb.replaceChildren(img); }
  else thumb.innerHTML = '<span>Tanpa foto (demo)</span>';
  if (state.nik) { checkKtp(); return; }
  // "membaca" KTP: kolom berkilau sebentar lalu terisi data contoh
  const ins = [inNik, inNamaKtp, inLahir];
  ins.forEach(i => { i.value = ''; i.classList.add('reading'); i.disabled = true; });
  btnKtpCek.disabled = true;
  await sleep(1100);
  ins.forEach(i => { i.classList.remove('reading'); i.disabled = false; });
  if (!alive()) return;
  inNik.value = SAMPLE.nik; inNamaKtp.value = state.name.toUpperCase(); inLahir.value = SAMPLE.lahir;
  checkKtp(); markScroll();
};
btnKtpCek.addEventListener('click', () => {
  Object.assign(state, { nik: inNik.value, namaKtp: inNamaKtp.value.trim().replace(/\s+/g, ' '), lahir: inLahir.value });
  go('ktpverif');
});

/* ---------- 07 memverifikasi KTP · 08 terverifikasi (simulasi) ---------- */
enter.ktpverif = async alive => { if (await runChecklist('ktpverif', alive)) go('ktpok', { replace: true }); };
enter.ktpok = () => {
  $('#okNama').textContent = state.namaKtp || state.name;
  $('#okNik').textContent = `${state.nik.slice(0, 4)} •••• •••• ${state.nik.slice(-4)}`;
};

/* ---------- 09 izin ---------- */
const cbIzin = $('#cbIzin'), btnIzin = $('#btnIzin');
cbIzin.addEventListener('change', () => btnIzin.disabled = !cbIzin.checked);
enter.izin = () => { loadFaceModel().catch(() => {}); };   // muat model di belakang layar
btnIzin.addEventListener('click', () => go('pindai'));
$('#btnNanti').addEventListener('click', () => toast('Pendaftaran wajah dibutuhkan untuk mengaktifkan Face Pay. Kamu bisa melanjutkannya nanti.'));

/* ---------- 10–11 pindai / memindai wajah (kamera depan + MediaPipe, asli) ---------- */
const scanSec = sec('pindai'), faceCamEl = $('#faceCam'), faceVid = $('#faceVid'), dotsCv = $('#faceDots');
const overlay = $('#faceOverlay'), faceLine = $('#faceLine'), faceStatus = $('#faceStatus'), btnPindai = $('#btnPindai'), faceErr = $('#faceErr');
const scanBar = $('#scanBar'), scanHead = $('#scanHead'), scanChecks = $$('#scanChecks li');
const faceCam = new Camera([faceVid], { storageKey: 'rupa.app.faceCameraId', facingMode: 'user' });
faceCam.videoConstraints = camConstraints;
if (testSource) faceCam.sourceFactory = testSource;
let G = null, vidKey = '';
// heksagon "pointy-top" dengan sudut membulat, rasio sama dengan desain (0,893)
function hexPath(cx, cy, w, h, r) {
  const hw = w / 2, hh = h / 2;
  const V = [[cx, cy - hh], [cx + hw, cy - hh / 2], [cx + hw, cy + hh / 2], [cx, cy + hh], [cx - hw, cy + hh / 2], [cx - hw, cy - hh / 2]];
  const pt = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  let d = '';
  V.forEach((v, i) => {
    const p = V[(i + 5) % 6], n = V[(i + 1) % 6];
    const tp = r / Math.hypot(v[0] - p[0], v[1] - p[1]), tn = r / Math.hypot(n[0] - v[0], n[1] - v[1]);
    const a = pt(v, p, tp), b = pt(v, n, tn);
    d += `${i ? 'L' : 'M'}${a[0].toFixed(1)} ${a[1].toFixed(1)}Q${v[0].toFixed(1)} ${v[1].toFixed(1)} ${b[0].toFixed(1)} ${b[1].toFixed(1)}`;
  });
  return d + 'Z';
}
function layoutFace() {
  const W = faceCamEl.clientWidth, H = faceCamEl.clientHeight;
  const hexH = Math.min(H * 0.6, W * 0.7 / 0.893), hexW = hexH * 0.893;
  const cx = W / 2, cy = Math.max(hexH / 2 + 58, H * 0.47);
  G = { W, H, cx, cy, hexW, hexH };
  overlay.setAttribute('viewBox', `0 0 ${W} ${H}`);
  const hp = hexPath(cx, cy, hexW, hexH, hexW * 0.06);
  overlay.querySelector('.shade').setAttribute('d', `M0 0H${W}V${H}H0Z` + hp);
  overlay.querySelectorAll('.hex-line,.hex-glow').forEach(p => p.setAttribute('d', hp));
  Object.assign(faceLine.style, { left: cx - hexW * 0.42 + 'px', width: hexW * 0.84 + 'px', top: cy - hexH * 0.32 + 'px' });
  faceLine.style.setProperty('--sweep', hexH * 0.62 + 'px');
  faceStatus.style.top = Math.min(cy + hexH / 2 + 16, H - 46) + 'px';
  const dpr = Math.min(devicePixelRatio || 1, 2);
  dotsCv.width = W * dpr; dotsCv.height = H * dpr; dotsCv.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
  vidKey = '';
}
// penilaian posisi wajah relatif terhadap heksagon (ketat untuk mulai, longgar selama memindai)
const TOL = { strict: { c: 0.2, cy: 0.18, min: 0.45, max: 1.05, yaw: 0.28 }, loose: { c: 0.32, cy: 0.28, min: 0.35, max: 1.2, yaw: 0.45 } };
function judge(count, f, t) {
  if (count > 1) return 'multi';
  if (!f) return 'none';
  if (f.box.w < G.hexW * t.min) return 'far';
  if (f.box.w > G.hexW * t.max) return 'near';
  if (Math.abs(f.box.cx - G.cx) > G.hexW * t.c || Math.abs(f.box.cy - G.cy) > G.hexH * t.cy) return 'off';
  if (Math.abs(f.yaw) > t.yaw) return 'turn';
  return 'ok';
}
const SAY = {
  none: 'Posisikan wajah Anda di dalam bingkai', multi: 'Pastikan hanya satu wajah di kamera', far: 'Dekatkan wajah ke kamera',
  near: 'Jauhkan sedikit wajah dari kamera', off: 'Posisikan wajah di tengah bingkai', turn: 'Hadapkan wajah lurus ke kamera', ok: 'Wajah terdeteksi'
};
const scan = { mode: 'pindai', prog: 0, lostAt: 0, last: 0, finishing: false, ready: false };
const tracker = new FaceTracker(faceVid, (faces, vw, vh) => {
  if (!G) return;
  const rect = coverRect(vw, vh, G.W, G.H), key = [vw, vh, G.W, G.H].join();
  if (key !== vidKey) { vidKey = key; Object.assign(faceVid.style, { left: rect.x + 'px', top: rect.y + 'px', width: rect.w + 'px', height: rect.h + 'px', objectFit: 'fill' }); }
  const { count, face } = analyzeFaces(faces, makeMapper(rect, { x: 0, y: 0, w: G.W, h: G.H }, true));
  const strict = judge(count, face, TOL.strict), loose = judge(count, face, TOL.loose);
  const now = performance.now(), dt = scan.last ? Math.min(100, now - scan.last) : 16; scan.last = now;
  faceCamEl.classList.toggle('good', loose === 'ok');
  if (scan.mode === 'pindai') {
    faceStatus.textContent = SAY[strict] + (strict === 'ok' ? ' — siap dipindai' : '');
  } else {
    // progres hanya berjalan selama wajah tetap di posisi; hilang > 0,3 dtk → ulang dari awal
    if (loose === 'ok' && (scan.prog > 0 || strict === 'ok')) { scan.prog = Math.min(1, scan.prog + dt / 3200); scan.lostAt = 0; }
    else { if (!scan.lostAt) scan.lostAt = now; if (now - scan.lostAt > 300) scan.prog = 0; }
    const p = scan.prog, holding = loose === 'ok' && p > 0;
    scanBar.style.width = (p * 100).toFixed(1) + '%';
    scanHead.textContent = holding || p >= 1 ? 'Tetap diam, jangan bergerak' : SAY[loose === 'ok' ? strict : loose];
    faceStatus.textContent = holding ? 'Memindai wajah…' : SAY[loose === 'ok' ? strict : loose];
    scanChecks[0].className = loose === 'ok' ? 'done' : '';
    scanChecks[1].className = p >= 0.5 ? 'done' : p > 0 ? 'doing' : '';
    scanChecks[2].className = p >= 1 ? 'done' : p >= 0.5 ? 'doing' : '';
    if (p >= 1 && !scan.finishing) finishScan();
  }
  drawDots(scan.mode === 'memindai' && loose === 'ok' ? face : null);
});
function drawDots(face) {
  const ctx = dotsCv.getContext('2d'); ctx.clearRect(0, 0, G.W, G.H);
  if (!face) return;
  ctx.fillStyle = 'rgba(191,243,240,.9)';
  for (let i = 0; i < 468; i += 5) { const p = face.pts[i]; ctx.beginPath(); ctx.arc(p.x, p.y, 1.6, 0, 6.283); ctx.fill(); }
}
function scanMode(m) {
  scan.mode = m; scanSec.dataset.mode = m;
  $('#scanTitle').textContent = m === 'pindai' ? 'Pindai Wajah' : 'Memindai Wajah';
  Object.assign(scan, { prog: 0, lostAt: 0, finishing: false });
  scanBar.style.width = '0%'; scanChecks.forEach(li => li.className = '');
}
async function startFace(alive) {
  faceErr.hidden = true; btnPindai.disabled = true; btnPindai.textContent = 'Mulai Pindai Wajah';
  faceStatus.textContent = 'Menyiapkan kamera…';
  if (faceCam.running && scan.ready) { tracker.start(); btnPindai.disabled = false; return; }
  faceVid.classList.remove('on'); scan.ready = false;
  try { await Promise.all([faceCam.start(), loadFaceModel()]); }
  catch (err) {
    if (err.aborted || !alive()) return;
    faceCam.stop(); faceErr.textContent = err.message || MSG.generic; faceErr.hidden = false;
    faceStatus.textContent = 'Kamera tidak tersedia'; btnPindai.textContent = 'Coba Lagi'; btnPindai.disabled = false; btnPindai.dataset.retry = '1';
    return;
  }
  if (!alive()) { faceCam.stop(); return; }
  scan.ready = true; faceVid.classList.add('on'); tracker.start(); btnPindai.disabled = false; delete btnPindai.dataset.retry;
}
function stopFace() { tracker.stop(); faceCam.stop(); faceVid.classList.remove('on'); scan.ready = false; faceCamEl.classList.remove('good'); if (G) dotsCv.getContext('2d').clearRect(0, 0, G.W, G.H); }
async function finishScan() {
  scan.finishing = true; const id = runId;
  faceStatus.textContent = 'Pemindaian selesai';
  await sleep(600);
  if (id === runId) go('amankan', { replace: true });
}
enter.pindai = (alive, prev) => { layoutFace(); scanMode('pindai'); if (prev !== 'memindai' || !faceCam.running) startFace(alive); else tracker.start(); };
enter.memindai = () => { scanMode('memindai'); };
leave.pindai = next => { if (next !== 'memindai') stopFace(); };
leave.memindai = next => { if (next !== 'pindai') stopFace(); };
btnPindai.addEventListener('click', () => {
  if (btnPindai.dataset.retry) { const id = runId; startFace(() => id === runId); return; }
  go('memindai', { replace: true });
});

/* ---------- 12 mengamankan · 13 terdaftar (simulasi) ---------- */
enter.amankan = async alive => { if (await runChecklist('amankan', alive)) go('terdaftar', { replace: true }); };

/* ---------- 14 pilih sumber · 15 menautkan · 16 aktif ---------- */
function radio(group, cls = 'sel') {
  group.addEventListener('click', e => {
    const b = e.target.closest('[role="radio"]'); if (!b) return;
    $$('[role="radio"]', group).forEach(x => { x.classList.toggle(cls, x === b); x.setAttribute('aria-checked', x === b); });
  });
}
radio($('#opts')); radio($('#limits'));
$('#btnAktifkan').addEventListener('click', () => {
  state.provider = $('#opts .sel').dataset.p; state.limit = +$('#limits .sel').dataset.v;
  go('tautkan');
});
const setProv = () => $$('[data-prov]').forEach(n => n.textContent = state.provider);
enter.tautkan = async alive => { setProv(); if (await runChecklist('tautkan', alive)) go('aktif', { replace: true }); };
enter.aktif = () => { setProv(); $('#sumLimit').textContent = rupiah(state.limit); };
$('#btnBeranda').addEventListener('click', () => {
  // MVP: belum ada beranda → kembali ke awal & hapus semua data sesi
  if (state.ktpUrl) URL.revokeObjectURL(state.ktpUrl);
  state = fresh();
  $$('input').forEach(i => { if (i.type === 'checkbox') i.checked = false; else i.value = ''; i.classList.remove('ok', 'bad'); });
  Object.keys(touched).forEach(k => delete touched[k]);
  checkAkun(); btnIzin.disabled = true;
  go('splash');
  toast('Beranda belum tersedia di MVP. Pendaftaran demo selesai.');
});

/* ---------- siklus hidup kamera ---------- */
addEventListener('resize', () => {
  markScroll();
  if (cur === 'ktpfoto') layoutKtp();
  if (cur === 'pindai' || cur === 'memindai') layoutFace();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { ktpCam.stop(); stopFace(); return; }
  const id = runId, alive = () => id === runId;
  if (cur === 'ktpfoto' && $('#ktpReview').hidden) startKtp(alive);
  if (cur === 'pindai' || cur === 'memindai') { scanMode(cur); startFace(alive); }
});
addEventListener('pagehide', () => { ktpCam.stop(); faceCam.stop(); });

history.replaceState({ s: 'splash' }, '');
go('splash', { pop: true });
