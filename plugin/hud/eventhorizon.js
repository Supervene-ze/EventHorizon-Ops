const TAU = Math.PI * 2;
const FONT = 'ui-monospace,SFMono-Regular,Consolas,monospace';
let DPR = Math.min(2.5, Math.max(1, window.devicePixelRatio || 1));
const GS = 3, FS = 0.5;
const HAS_FILTER = (() => { try { return 'filter' in CanvasRenderingContext2D.prototype; } catch (e) { return false; } })();

const stage = document.getElementById('stage');
const S_MAIN = stage.getContext('2d');
let S = S_MAIN;

let W = 0, H = 0, cx = 0, cy = 0, R = 0, RO = 0, RMAX = 0, thV = 0, thS = 0;
let webRot = 0, ringRot = 0, T = 0, env = 0, sinceTick = 9;
const OSTEP = 0.0038;

const rr = (a, b) => a + Math.random() * (b - a);
const pick = a => a[(Math.random() * a.length) | 0];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const normA = a => ((a + Math.PI) % TAU + TAU) % TAU - Math.PI;
const easeIO = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const easeO = t => 1 - (1 - t) * (1 - t);
const gauss = () => (Math.random() + Math.random() + Math.random() + Math.random() - 2) / 2;
const hash = x => { const s = Math.sin(x * 12.9898) * 43758.5453; return s - Math.floor(s); };

const C = {
  tempo: 1, camera: 1, camZoom: 1, glow: 0.9, ringSpeed: 1.6, ringPause: 1.1, ringWidth: 1.25,
  rimBright: 1.5, rimWidth: 1, rimDensity: 1, dataFlicker: 0.7,
  webBright: 0.95, webPulseBase: 0.16, webPulseAmp: 0.8, webSpin: 1,
  runnerCount: 420, runnerBright: 0.62, runnerWidth: 1, runnerSpeed: 0.55, runnerVariety: 0.9,
  cometPerBeat: 1.6, cometBurst: 6, cometTrickle: 1.2, cometLines: 1, cometWidth: 1,
  cometBright: 1, cometGlow: 1.1, cometSpeed: 1, cometFollow: 0,
  beamBright: 1.6, beamLen: 1.5, beamWidth: 0.72, beamBounce: 1.8, beamGlow: 3, dashBright: 1.7,
  hazeCount: 16, hazeBright: 1.3, flyerCount: 2, flyerBright: 2.6, flyerWidth: 1.3, flyerSpeed: 2,
  burstRate: 3, burstSize: 2.6, burstBright: 2.2, flareRate: 3, flareBright: 1.8,
  depthBlur: 1.1, depthDim: 0.7, webBlur: 0, parallax: 0.25, bokeh: 8, bokehBright: 0.8,
  atmos: 0.8, ringShadow: 0.6, vignette: 0.6
};

function mk(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h));
  c.x = c.getContext('2d');
  return c;
}
function mkd(w, h, d) {
  const c = mk(w * d, h * d);
  c.x.setTransform(d, 0, 0, d, 0, 0);
  c.d = d;
  return c;
}

const cam = { x: 0, y: 0, z: 1 };
let shots = [], shotI = 0, shotT = 0, camPhase = 'hold', camFrom = null;

function buildShots() {
  const P = (a, r) => ({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  const mid = (R + RO) / 2;
  shots = [
    { x: W / 2, y: H / 2, z: 1, hold: 4.5 },
    { ...P(-thS * 0.42, mid), z: 2.1, hold: 3.4 },
    { ...P(0.05, RO + (RMAX - RO) * 0.28), z: 1.5, hold: 3.2 },
    { x: W / 2, y: H / 2, z: 1, hold: 3 },
    { ...P(0.2, R * 0.78), z: 1.8, hold: 3.4 },
    { ...P(thS * 0.46, mid + 10), z: 2.6, hold: 3 },
    { ...P(-0.1, RO + 40), z: 1.3, hold: 3.2 }
  ];
  shotI = 0; shotT = 0; camPhase = 'hold';
  Object.assign(cam, shots[0]);
}
function clampCam() {
  const hw = W / (2 * cam.z), hh = H / (2 * cam.z);
  cam.x = Math.max(hw, Math.min(W - hw, cam.x));
  cam.y = Math.max(hh, Math.min(H - hh, cam.y));
}
const zf = z => 1 + (z - 1) * C.camZoom;
function updateCam(dt) {
  if (!C.camera) { cam.x = W / 2; cam.y = H / 2; cam.z = 1; return; }
  shotT += dt;
  const cur = shots[shotI], nxt = shots[(shotI + 1) % shots.length];
  if (camPhase === 'hold') {
    const k = shotT / cur.hold;
    cam.x = cur.x; cam.y = cur.y + (cur.z > 1 ? Math.sin(k * Math.PI) * 6 : 0);
    cam.z = zf(cur.z) * (1 + 0.05 * k * C.camZoom);
    if (shotT >= cur.hold) { camPhase = 'move'; shotT = 0; camFrom = { ...cam }; }
  } else {
    const dur = 2.2, e = easeIO(Math.min(1, shotT / dur));
    const lz = Math.log(camFrom.z) + (Math.log(zf(nxt.z)) - Math.log(camFrom.z)) * e;
    let z = Math.exp(lz);
    if (camFrom.z > 1.2 && zf(nxt.z) > 1.2) z *= 1 - 0.4 * Math.sin(Math.PI * e);
    cam.z = Math.max(1, z);
    cam.x = camFrom.x + (nxt.x - camFrom.x) * e;
    cam.y = camFrom.y + (nxt.y - camFrom.y) * e;
    if (shotT >= dur) { shotI = (shotI + 1) % shots.length; camPhase = 'hold'; shotT = 0; }
  }
  clampCam();
}
let ZOOM = 1, PANX = 0, PANY = 0, webTimer = 0, zoomAt = 0;
const ZMIN = 0.45, ZMAX = 3.2;
function camT(ctx, d) {
  const z = cam.z * ZOOM;
  ctx.setTransform(d * z, 0, 0, d * z, d * (W / 2 + PANX - cam.x * z), d * (H / 2 + PANY - cam.y * z));
}
function camTk(ctx, d, k) {
  const z = (1 + (cam.z - 1) * k) * ZOOM, x = W / 2 + (cam.x - W / 2) * k, y = H / 2 + (cam.y - H / 2) * k;
  ctx.setTransform(d * z, 0, 0, d * z, d * (W / 2 + PANX - x * z), d * (H / 2 + PANY - y * z));
}
const toScreen = (x, y) => ({ x: (x - cam.x) * cam.z * ZOOM + W / 2 + PANX, y: (y - cam.y) * cam.z * ZOOM + H / 2 + PANY });

const state = {
  snap: null, sessions: [], base: null, prev: { steps: 0, calls: 0 },
  ringTick: 0, live: false, src: '', graphSig: '', evt: null
};

function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function fmt(v) {
  const n = num(v);
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'G';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return String(Math.round(n));
}
function fmtMs(v) { const n = num(v); return n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 's' : Math.round(n) + 'ms'; }
function fmtTime(t) {
  const d = new Date(num(t));
  const p = n => String(n).padStart(2, '0');
  return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
}
function fmtAge(t) {
  const s = Math.max(0, (Date.now() - num(t)) / 1000);
  if (s < 60) return Math.round(s) + 's';
  if (s < 3600) return Math.round(s / 60) + 'm';
  if (s < 86400) return (s / 3600).toFixed(1) + 'h';
  return (s / 86400).toFixed(1) + 'd';
}
function short(s, n) { s = String(s ?? ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
function tailNum(s, after) {
  const t = String(s || '');
  let i = after ? t.indexOf(after) : 0;
  if (i < 0) i = 0;
  for (; i < t.length; i++) {
    const c = t.charCodeAt(i);
    if (c >= 48 && c <= 57) {
      let j = i;
      while (j < t.length) { const k = t.charCodeAt(j); if ((k >= 48 && k <= 57) || k === 46) j++; else break; }
      const v = Number(t.slice(i, j));
      return Number.isFinite(v) ? v : 0;
    }
  }
  return 0;
}
function numBefore(s, ch) {
  const t = String(s || '');
  const at = t.indexOf(ch);
  if (at <= 0) return 0;
  let i = at;
  while (i > 0) { const k = t.charCodeAt(i - 1); if (k >= 48 && k <= 57) i--; else break; }
  if (i === at) return 0;
  const v = Number(t.slice(i, at));
  return Number.isFinite(v) ? v : 0;
}
function med(a) {
  if (!a || !a.length) return 0;
  const b = a.slice().sort((x, y) => x - y), m = b.length >> 1;
  return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2;
}
function evtStats(snap) {
  const out = { dur: {}, cad: [], gen: [], bytes: {}, seq: [], turn: 0, done: 0, model: 0, span: 0, open: {} };
  const evs = ((snap && snap.events) || []).slice().sort((a, b) => num(a.t) - num(b.t));
  let prevT = 0;
  for (const e of evs) {
    const k = String(e.k || ''), n = String(e.n || ''), d = String(e.d || ''), t = num(e.t);
    const gap = prevT > 0 && t > prevT && t - prevT < 600000 ? t - prevT : 0;
    if (k === 'tool') {
      if (n) out.open[n] = t;
      if (n && gap > 0) out.seq.push(gap);
    } else if (k === 'done') {
      const t0 = out.open[n];
      const real = t0 && t > t0 && t - t0 < 900000 ? t - t0 : gap;
      if (n && real > 0) (out.dur[n] || (out.dur[n] = [])).push(real);
      if (n) delete out.open[n];
      const bsz = numBefore(d, 'b');
      if (n && bsz > 0) out.bytes[n] = (out.bytes[n] || 0) + bsz;
      out.done++;
    } else if (k === 'model') {
      const gt = tailNum(d, 'gen ');
      if (gt > 0) out.gen.push(gt);
      if (gap > 0) out.cad.push(gap);
      out.model++;
    } else if (k === 'turn') {
      const tn = tailNum(d, 'turn ');
      if (tn > 0) out.turn = Math.max(out.turn, tn);
    }
    if (t > prevT) prevT = t;
  }
  out.span = evs.length > 1 ? num(evs[evs.length - 1].t) - num(evs[0].t) : 0;
  delete out.open;
  return out;
}
function evtP95(snap, name) {
  const st = state.evt || evtStats(snap);
  const arr = (st.dur || {})[name];
  if (!arr || !arr.length) return 0;
  const b = arr.slice().sort((x, y) => x - y);
  return b[Math.min(b.length - 1, Math.floor(b.length * 0.95))];
}
function toolLat(snap, t) {
  const shown = num(t.p95);
  if (shown > 0 && shown < 300000) return shown;
  const e = evtP95(snap, String(t.n));
  return e > 0 ? e : shown;
}
function evtCad(snap) {
  const st = state.evt || evtStats(snap);
  const c = med(st.cad || []);
  return c > 0 ? c : med((st.seq || []).slice());
}

let curves = [], webBase = null, webLayers = [], nodes = [], runPool = [];
function buildWeb() {
  const size = 2 * R + 4;
  const d = Math.min(3.2, Math.max(1, ZOOM * DPR * 0.9));
  webBase = mkd(size, size, d);
  webLayers = [0, 1, 2].map(() => mkd(size, size, d));
  const all = [webBase, ...webLayers];
  all.forEach(c => c.x.translate(R + 2, R + 2));
  const b = webBase.x;
  b.beginPath(); b.arc(0, 0, R, 0, TAU);
  const g = b.createRadialGradient(0, 0, R * 0.2, 0, 0, R);
  g.addColorStop(0, '#111215'); g.addColorStop(1, '#0c0d0f');
  b.fillStyle = g; b.fill();
  all.forEach(c => { c.x.save(); c.x.beginPath(); c.x.arc(0, 0, R, 0, TAU); c.x.clip(); });

  const gph = (state.snap && state.snap.graph) || { nodes: [], edges: [] };
  const gn = gph.nodes || [], ge = gph.edges || [];
  const maxCount = gn.length ? Math.max(1, gn[0].v) : 1;
  nodes = gn.map((x, i) => ({
    name: String(x.n), count: num(x.v), a: -Math.PI / 2 + (i / Math.max(1, gn.length)) * TAU,
    r: R * (0.34 + 0.58 * Math.pow(num(x.v) / maxCount, 0.55))
  }));
  const byName = new Map(nodes.map(n => [n.name, n]));

  curves = [];
  runPool = [];
  for (const e of ge) {
    const a = byName.get(String(e.a)), b2 = byName.get(String(e.b));
    if (!a || !b2) continue;
    const p0 = { x: Math.cos(a.a) * a.r, y: Math.sin(a.a) * a.r };
    const p1 = { x: Math.cos(b2.a) * b2.r, y: Math.sin(b2.a) * b2.r };
    const mx = (p0.x + p1.x) / 2, my = (p0.y + p1.y) / 2;
    const cv = { p0, c: { x: mx * 0.35, y: my * 0.35 }, p1, w: num(e.w) };
    curves.push(cv);
    const rep = clamp(Math.round(Math.log2(1 + num(e.w)) * 6), 1, 60);
    for (let i = 0; i < rep; i++) runPool.push(cv);
  }

  const filler = Math.min(1200, Math.round(220 + ge.length * 6 + (W * H) / 3200));
  for (let i = 0; i < filler; i++) {
    if (nodes.length > 1) {
      const a = nodes[i % nodes.length], b2 = nodes[(i * 7 + 3) % nodes.length];
      if (a === b2) continue;
      const p0 = { x: Math.cos(a.a) * a.r, y: Math.sin(a.a) * a.r };
      const p1 = { x: Math.cos(b2.a) * b2.r, y: Math.sin(b2.a) * b2.r };
      const bow = 0.18 + 0.22 * ((i % 5) / 4);
      const cv = { p0, c: { x: (p0.x + p1.x) / 2 * bow, y: (p0.y + p1.y) / 2 * bow }, p1, w: 0 };
      curves.push(cv);
      continue;
    }
    const a1 = (i / filler) * TAU, a2 = a1 + TAU / 3;
    const p0 = { x: Math.cos(a1) * R, y: Math.sin(a1) * R };
    const p1 = { x: Math.cos(a2) * R, y: Math.sin(a2) * R };
    const cv = { p0, c: { x: 0, y: 0 }, p1, w: 0 };
    curves.push(cv);
  }

  for (const cv of curves) {
    const layer = cv.w > 0 ? (Math.random() < 0.5 ? -1 : (Math.random() * 3) | 0) : (Math.random() < 0.7 ? -1 : (Math.random() * 3) | 0);
    const x = layer < 0 ? b : webLayers[layer].x;
    const base = cv.w > 0 ? 0.16 + Math.min(0.4, cv.w * 0.05) : 0.03 + Math.pow(Math.random(), 3) * 0.24;
    const al = Math.min(1, base * C.webBright);
    const k = Math.random();
    x.strokeStyle = cv.w > 0
      ? (k < 0.5 ? `rgba(240,166,198,${al})` : k < 0.8 ? `rgba(180,170,235,${al})` : `rgba(228,231,238,${al})`)
      : (k < 0.05 ? `rgba(240,166,198,${al})` : k < 0.1 ? `rgba(180,170,235,${al})` : `rgba(228,231,238,${al})`);
    x.lineWidth = cv.w > 0 ? rr(0.55, 1.15) : rr(0.35, 0.95);
    x.beginPath(); x.moveTo(cv.p0.x, cv.p0.y); x.quadraticCurveTo(cv.c.x, cv.c.y, cv.p1.x, cv.p1.y); x.stroke();
  }

  b.font = `600 6px ${FONT}`;
  b.textBaseline = 'middle';
  for (const n of nodes) {
    const px = Math.cos(n.a) * n.r, py = Math.sin(n.a) * n.r;
    const s = 2.2 + Math.min(3.4, Math.log2(1 + n.count) * 0.8);
    b.strokeStyle = 'rgba(235,238,244,.75)'; b.lineWidth = 0.85;
    b.beginPath(); b.arc(px, py, s, 0, TAU); b.stroke();
    b.strokeStyle = 'rgba(240,166,198,.5)';
    b.beginPath(); b.arc(px, py, s + 3.4, -1.1, 1.1); b.stroke();
    b.fillStyle = 'rgba(206,210,218,.62)';
    b.fillText(short(n.name, 11), px + s + 5, py);
    b.fillStyle = 'rgba(240,166,198,.72)';
    b.fillText(String(n.count), px + s + 5, py + 7.5);
  }
  if (!nodes.length) {
    for (let i = 0; i < 24; i++) {
      const a = Math.random() * TAU, rd = Math.sqrt(Math.random()) * R * 0.9;
      b.strokeStyle = 'rgba(235,238,244,.28)'; b.lineWidth = 0.8;
      b.beginPath(); b.arc(Math.cos(a) * rd, Math.sin(a) * rd, rr(1.6, 3), 0, TAU); b.stroke();
    }
  }
  all.forEach(c => c.x.restore());
}
const qpt = (cv, t) => {
  const u = 1 - t;
  return { x: u * u * cv.p0.x + 2 * u * t * cv.c.x + t * t * cv.p1.x, y: u * u * cv.p0.y + 2 * u * t * cv.c.y + t * t * cv.p1.y };
};
function newRunner(init) {
  const cv = runPool.length ? runPool[(Math.random() * runPool.length) | 0] : pick(curves);
  const t = init ? Math.random() : 0;
  const p = cv ? qpt(cv, t) : { x: 0, y: 0 };
  const k = Math.random(); let mode, sp;
  if (Math.random() > C.runnerVariety) { mode = 1; sp = rr(0.12, 0.38); }
  else if (k < 0.3) { mode = 0; sp = rr(0.15, 0.28); }
  else if (k < 0.65) { mode = 1; sp = rr(0.1, 0.3); }
  else if (k < 0.8) { mode = 0; sp = rr(0.04, 0.08); }
  else if (k < 0.92) { mode = 0; sp = rr(0.5, 0.85); }
  else { mode = 2; sp = rr(0.06, 0.12); }
  const hot = cv && cv.w > 0;
  return { cv: cv || { p0: { x: 0, y: 0 }, c: { x: 0, y: 0 }, p1: { x: 0, y: 0 } }, t, sp, mode, px: p.x, py: p.y, b: hot ? Math.random() < 0.35 : Math.random() < 0.08 };
}

let comets = [];
function spawnComet() {
  const lines = [], n = Math.max(2, Math.round((8 + (Math.random() * 12 | 0)) * C.cometLines));
  if (Math.random() < 0.6) {
    const rad = R * rr(0.55, 0.9), a0 = rr(-thV, thV) * 0.85, span = rr(0.35, 0.9) * (Math.random() < 0.5 ? -1 : 1), gap = rr(2.6, 4.4) * C.cometWidth;
    for (let k = 0; k < n; k++) lines.push({ arc: true, r: rad - k * gap + gauss() * 0.6, a0: a0 + gauss() * 0.01, span });
  } else {
    const ang = rr(-thV, thV) * 0.8, oa = ang + rr(-1.3, 1.3), orad = R * rr(0.25, 0.75);
    const o = { x: Math.cos(oa) * orad, y: Math.sin(oa) * orad };
    const spread = rr(0.08, 0.25) * C.cometWidth, bend = rr(0.2, 0.5) * (Math.random() < 0.5 ? -1 : 1);
    for (let i = 0; i < n; i++) {
      const ta = ang + (i / n - 0.5) * spread;
      const p1 = { x: Math.cos(ta) * (R - 2), y: Math.sin(ta) * (R - 2) };
      const p0 = { x: o.x + gauss() * 10, y: o.y + gauss() * 10 };
      const mx = (p0.x + p1.x) / 2, my = (p0.y + p1.y) / 2, dx = p1.x - p0.x, dy = p1.y - p0.y;
      lines.push({ p0, c: { x: mx - dy * bend + gauss() * 8, y: my + dx * bend + gauss() * 8 }, p1 });
    }
  }
  comets.push({ lines, life: 0, hit: false, rot0: ringRot, dur: rr(0.4, 0.85) / C.cometSpeed, win: rr(0.22, 0.4), glow: Math.random() < 0.4, tint: Math.random() < 0.15 });
}
const cpt = (l, t) => { if (!l.arc) return qpt(l, t); const r = l.r + (R - 2 - l.r) * t * t, a = l.a0 + l.span * t; return { x: Math.cos(a) * r, y: Math.sin(a) * r }; };
function strokeComet(ctx, c, t0, t1, steps) {
  ctx.beginPath();
  for (const l of c.lines) for (let s = 0; s <= steps; s++) {
    const p = cpt(l, t0 + (t1 - t0) * (s / steps));
    s ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y);
  }
  ctx.stroke();
}

let GR = {}, strandLayers = [], hazes = [], flares = [], pulses = [], wedges = [];
function makeProfile(n) {
  const prof = []; let v = rr(0.45, 1), run = 0;
  for (let k = 0; k < n; k++) {
    if (run-- <= 0) { v = clamp(v + gauss() * 0.4, 0.22, 1); run = 2 + (Math.random() * 5 | 0); }
    prof.push(clamp(v + gauss() * 0.07, 0.18, 1));
  }
  return prof;
}
function makeStrandLayer(stepDeg, rotK, lumK, lw, lenK, solidK, cover, nMin, nMax, brightP, dyn) {
  const step = stepDeg * Math.PI / 180, nb = Math.floor(TAU / step), ws = [];
  const count = Math.round(nb * cover / ((nMin + nMax) / 2));
  for (let j = 0; j < count; j++) {
    const n = nMin + (Math.random() * (nMax - nMin) | 0), bright = Math.random() < brightP;
    ws.push({
      i0: (Math.random() * nb) | 0, n, base: rr(0.35, 1), len: rr(0.1, 0.5), kick: 0,
      ph: Math.random() * TAU, ph2: Math.random() * TAU, f1: rr(0.22, 0.6), f2: rr(0.8, 1.7),
      lum: bright ? rr(0.75, 1) : rr(0.16, 0.55), tint: Math.random() < 0.5 ? 1 : 0,
      lwK: Math.random() < 0.2 ? rr(1.35, 2.1) : rr(0.6, 1.15), lenS: rr(0.6, 1.25),
      prof: makeProfile(n), pf: Array.from({ length: n }, () => rr(1, 4)), pp: Array.from({ length: n }, () => Math.random() * TAU),
      ds: Array.from({ length: n }, () => Math.random()), dsp: rr(0.7, 1.8), flow: 0
    });
  }
  return { step, rotK, lumK, lw, lenK, solidK, wedges: ws, off: Math.random() * TAU, dyn: dyn || 'soft' };
}
function buildOuter() {
  strandLayers = [
    makeStrandLayer(0.22, 0.45, 0.3, 0.55, 1.15, 0.9, 1.1, 20, 90, 0.2),
    makeStrandLayer(0.16, 0.75, 0.58, 0.8, 1.05, 0.7, 0.9, 14, 70, 0.28),
    makeStrandLayer(0.12, 1, 1, 1, 1, 0.5, 0.75, 12, 60, 0.32),
    makeStrandLayer(0.45, 1, 0.5, 1.8, 0.8, 0.6, 0.35, 4, 16, 0.3),
    makeStrandLayer(0.12, 1, 0.85, 1, 1, 0.5, 0.55, 14, 70, 0.32, 'bounce')
  ];
  wedges = strandLayers[2].wedges.concat(strandLayers[4].wedges);
  hazes = []; flares = [];
  GR = {};
  const mkG = (stops, r1) => { const g = S_MAIN.createRadialGradient(cx, cy, RO, cx, cy, r1); stops.forEach(s => g.addColorStop(s[0], s[1])); return g; };
  GR.s0 = mkG([[0, 'rgba(248,248,255,1)'], [0.35, 'rgba(228,226,242,.8)'], [1, 'rgba(190,190,214,.3)']], RMAX * 0.95);
  GR.s2 = mkG([[0, 'rgba(225,245,242,1)'], [0.3, 'rgba(176,214,210,.8)'], [1, 'rgba(140,180,186,.3)']], RMAX * 0.95);
  GR.s1 = mkG([[0, 'rgba(240,236,255,1)'], [0.3, 'rgba(196,182,244,.82)'], [1, 'rgba(160,140,228,.3)']], RMAX * 0.95);
  GR.h0 = mkG([[0, 'rgba(205,190,255,.95)'], [0.25, 'rgba(180,165,240,.7)'], [0.7, 'rgba(150,135,215,.25)'], [1, 'rgba(120,110,190,0)']], RMAX);
  GR.h1 = mkG([[0, 'rgba(250,250,255,1)'], [0.2, 'rgba(225,225,240,.65)'], [0.65, 'rgba(200,200,225,.2)'], [1, 'rgba(180,180,210,0)']], RMAX);
  GR.h2 = mkG([[0, 'rgba(200,230,228,.9)'], [0.25, 'rgba(170,205,210,.6)'], [0.7, 'rgba(140,170,185,.2)'], [1, 'rgba(120,150,170,0)']], RMAX);
  for (let i = 0; i < 14; i++) spawnHaze(true);
  initFlyers();
}
function spawnHaze(init) {
  const k = Math.random();
  hazes.push({
    a: rr(-thS, thS) - ringRot, w: Math.random() < 0.7 ? rr(0.015, 0.07) : rr(0.08, 0.18),
    len: rr(0.35, 1), cur: init ? rr(0.2, 0.8) : 0, age: init ? rr(0, 0.5) : 0,
    life: rr(0.35, 1.6), alpha: rr(0.12, 0.42), tint: k < 0.55 ? 0 : k < 0.85 ? 1 : 2, drift: rr(-0.04, 0.04)
  });
}
function spawnFlare(a) {
  flares.push({ a: a == null ? rr(-thS, thS) * 0.95 - ringRot : a, w: rr(0.006, 0.04), len: rr(18, 110), age: 0, life: rr(0.2, 0.55), alpha: rr(0.6, 1) });
}
let laneC = null;
function buildLanes() {
  laneC = mkd(W, H, DPR);
  const x = laneC.x;
  for (let i = 0; i < 700; i++) {
    const a = rr(-thS, thS);
    x.strokeStyle = `rgba(210,205,235,${rr(0.01, 0.035)})`; x.lineWidth = rr(0.5, 1);
    const r0 = RO + 4, r1 = rr(RO + 60, RMAX * 0.8);
    x.beginPath(); x.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); x.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); x.stroke();
  }
}
function updateOuter(dt) {
  for (let i = pulses.length - 1; i >= 0; i--) { const p = pulses[i]; p.c += p.v * dt; p.life -= dt; if (p.life <= 0) pulses.splice(i, 1); }
  for (const Lr of strandLayers) {
    const rot = ringRot * Lr.rotK + Lr.off;
    for (const w of Lr.wedges) {
      const am = normA((w.i0 + w.n / 2) * Lr.step + rot);
      w.vis = Math.abs(am) < thS + 0.2;
      w.flow += dt * w.dsp * (0.45 + 2.2 * env);
      if (!w.vis) { w.len *= 0.98; continue; }
      let p = 0;
      for (const pl of pulses) { const f = Math.min(1, pl.life / 0.5) * Math.min(1, (pl.L - pl.life) / 0.15 + 0.3); p += pl.amp * f * Math.exp(-(((am - pl.c) / pl.w) ** 2)); }
      if (Lr.dyn === 'bounce') {
        const idle = w.base * (0.36 + 0.14 * Math.sin(T * 0.9 + w.ph));
        const tgt = Math.min(1, idle + p * 0.75 + w.kick * 0.6);
        w.kick *= Math.exp(-dt * 2.4);
        w.len += (tgt - w.len) * Math.min(1, (tgt > w.len ? 15 : 2.2) * dt);
      } else {
        const n1 = 0.5 + 0.5 * Math.sin(T * w.f1 + w.ph), n2 = 0.5 + 0.5 * Math.sin(T * w.f2 + w.ph2);
        const idle = w.base * (0.4 + 0.34 * n1 + 0.14 * n2);
        const tgt = Math.min(1.05, (idle + p * 0.7 + w.kick * 0.55) * w.lenS);
        w.kick *= Math.exp(-dt * 1.8);
        w.len += (tgt - w.len) * Math.min(1, (tgt > w.len ? 5 : 1.3) * dt);
      }
    }
  }
  for (let i = hazes.length - 1; i >= 0; i--) {
    const h = hazes[i]; h.age += dt;
    h.cur += (h.len - h.cur) * Math.min(1, 9 * dt);
    if (h.age > h.life + 0.6) hazes.splice(i, 1);
  }
  if (hazes.length < C.hazeCount && Math.random() < 0.25) spawnHaze(false);
  for (let i = flares.length - 1; i >= 0; i--) { flares[i].age += dt; if (flares[i].age > flares[i].life) flares.splice(i, 1); }
  if (Math.random() < 0.06 * C.flareRate) spawnFlare();
  updateFlyers(dt);
}
function onBeatOuter() {
  onBeatFlyers();
  for (let i = 0; i < 2 + (Math.random() * 5 | 0); i++) { const w = pick(wedges); w.kick = rr(0.4, 1); if (Math.random() < 0.5) w.prof = makeProfile(w.n); }
  for (let i = 0; i < 2; i++) { const w = pick(wedges); w.lum = Math.random() < 0.4 ? rr(0.8, 1) : rr(0.25, 0.6); }
  const nh = 1 + (Math.random() * 3 | 0);
  for (let i = 0; i < Math.round(nh * C.hazeCount / 8); i++) spawnHaze(false);
  const nf = Math.round((1 + (Math.random() * 4 | 0)) * C.flareRate);
  for (let i = 0; i < nf; i++) spawnFlare(hazes.length && Math.random() < 0.6 ? pick(hazes).a : null);
}
function hazeEnv(h) {
  const a = Math.min(1, h.age / 0.12);
  const o = h.age > h.life ? Math.max(0, 1 - (h.age - h.life) / 0.6) : 1;
  return a * o * (0.85 + 0.15 * Math.sin(h.age * 30));
}
const EDGE_A = [0.28, 0.62, 1];
function drawStrands(Lr, collect) {
  const span = RMAX - RO - 20, r0 = RO + 3, rot = ringRot * Lr.rotK + Lr.off;
  S.lineCap = 'butt';
  for (const w of Lr.wedges) {
    if (!w.vis) continue;
    const L = w.len * span * Lr.lenK * C.beamLen;
    if (L < 3) continue;
    const a0 = normA(w.i0 * Lr.step + rot), a1 = a0 + w.n * Lr.step;
    if (a1 < -thS - 0.03 || a0 > thS + 0.03) continue;
    const alpha = Math.min(1, w.lum * Lr.lumK * (0.3 + 0.7 * Math.min(1, w.len * 1.8)) * C.beamBright * (Lr.dyn === 'bounce' ? C.beamBounce : 1));
    if (alpha < 0.005) continue;
    const lwW = Lr.lw * w.lwK * C.beamWidth;
    const paths = [new Path2D(), new Path2D(), new Path2D()];
    for (let k = 0; k < w.n; k++) {
      const a = a0 + (k + 0.5) * Lr.step, ca = Math.cos(a), sa = Math.sin(a);
      const edge = Math.sin(Math.PI * (k + 0.5) / w.n), bb = edge < 0.38 ? 0 : edge < 0.72 ? 1 : 2;
      const pr = w.prof[k];
      const l = L * pr * (0.5 + 0.5 * Math.sqrt(edge)) * (0.92 + 0.08 * Math.sin(T * w.pf[k] + w.pp[k]));
      const solid = l * (Lr.solidK + 0.3 * pr * (1 - Lr.solidK));
      paths[bb].moveTo(cx + ca * r0, cy + sa * r0); paths[bb].lineTo(cx + ca * (r0 + solid), cy + sa * (r0 + solid));
      if (!collect) continue;
      const tail = l - solid, da = alpha * EDGE_A[bb];
      if (tail > 6) for (let d = 0; d < 2; d++) {
        const ph = (w.flow + w.ds[k] + d * 0.5) % 1;
        const s0 = solid + tail * ph, s1 = Math.min(l, s0 + 3 + tail * 0.22 * (1 - ph * 0.5));
        if (s1 > s0) collect.dash.push(ca, sa, s0, s1, da);
      }
      if ((k + (T * 12 | 0)) % 4 === 0) collect.tip.push(ca, sa, l, da);
    }
    S.strokeStyle = GR['s' + w.tint]; S.lineWidth = lwW;
    for (let b = 0; b < 3; b++) { S.globalAlpha = alpha * EDGE_A[b]; S.stroke(paths[b]); }
    if (w.lum > 0.85 && C.beamGlow > 0) { S.globalAlpha = Math.min(1, alpha * 0.06 * C.beamGlow); S.lineWidth = lwW * 2.5; S.stroke(paths[2]); }
  }
}
function radialLines(a0, a1, st, r0, L, seed, lo) {
  S.beginPath();
  let k = 0;
  for (let a = a0; a < a1; a += st, k++) {
    const l = L * (lo + (1 - lo) * hash(k + seed)), ca = Math.cos(a), sa = Math.sin(a);
    S.moveTo(cx + ca * r0, cy + sa * r0); S.lineTo(cx + ca * (r0 + l), cy + sa * (r0 + l));
  }
}
let flyers = [], flyBands = [];
function newFlyBand() { return { a: rr(-thS, thS), w: rr(0.01, 0.05), life: rr(2, 6) }; }
function newFlyer(init) {
  let a;
  if (Math.random() < 0.5) { const b = pick(flyBands); a = b.a + gauss() * b.w; } else a = rr(-thS, thS);
  return {
    a: a - ringRot, len: 20 + Math.pow(Math.random(), 2) * 320, r: init ? rr(RO, RMAX) : RO + rr(0, 25),
    sp: rr(260, 900), lw: Math.random() < 0.08 ? rr(1.2, 1.7) : rr(0.5, 1), lv: Math.random() < 0.12 ? 2 : Math.random() < 0.55 ? 1 : 0,
    tint: Math.random() < 0.22 ? 1 : 0, burst: false
  };
}
function spawnFlyBurst() {
  const a = rr(-thS, thS) * 0.95, n = Math.max(1, Math.round((14 + (Math.random() * 30 | 0)) * C.burstSize)), spread = rr(0.01, 0.045);
  const sp = rr(450, 1150), len = rr(70, 320), r0 = RO + rr(0, 8), tint = Math.random() < 0.3 ? 1 : 0, lv = Math.random() < 0.45 ? 2 : 1;
  for (let i = 0; i < n; i++) {
    flyers.push({
      a: a + (i / n - 0.5) * spread + gauss() * 0.0015 - ringRot, len: len * rr(0.7, 1.15), r: r0 - rr(0, len * 0.35),
      sp: sp * rr(0.92, 1.08), lw: Math.random() < 0.2 ? 1.3 : rr(0.6, 1), lv, tint, burst: true
    });
  }
}
function initFlyers() {
  flyBands = Array.from({ length: 7 }, newFlyBand);
  flyers = Array.from({ length: Math.round(Math.min(620, 260 + W * 0.22) * C.flyerCount) }, () => newFlyer(true));
}
function updateFlyers(dt) {
  for (const b of flyBands) { b.life -= dt; if (b.life <= 0) Object.assign(b, newFlyBand()); }
  const k = (0.7 + 0.9 * env) * C.flyerSpeed;
  for (let i = flyers.length - 1; i >= 0; i--) {
    const f = flyers[i];
    f.r += f.sp * dt * k;
    if (f.r - f.len > RMAX) { if (f.burst) flyers.splice(i, 1); else flyers[i] = newFlyer(false); }
  }
}
function onBeatFlyers() {
  const n = Math.round((1 + (Math.random() * 2 | 0)) * C.burstRate);
  for (let i = 0; i < n; i++) setTimeout(spawnFlyBurst, i * rr(20, 120));
}
const FLY_A = [0.16, 0.36, 0.7];
function drawFlyers(bursts) {
  const buckets = {};
  for (const f of flyers) {
    if (f.burst !== bursts) continue;
    const a = normA(f.a + ringRot);
    if (a < -thS - 0.05 || a > thS + 0.05) continue;
    const key = f.tint * 10 + f.lv + (f.lw > 1.15 ? 100 : 0) + (f.burst ? 1000 : 0);
    (buckets[key] || (buckets[key] = [])).push(f, a);
  }
  for (const key in buckets) {
    const arr = buckets[key], f0 = arr[0];
    S.strokeStyle = f0.tint ? GR.s1 : GR.s0;
    S.globalAlpha = Math.min(1, FLY_A[f0.lv] * (f0.burst ? C.burstBright : C.flyerBright));
    S.lineWidth = ((key % 1000) >= 100 ? 1.5 : 0.8) * C.flyerWidth;
    S.beginPath();
    for (let i = 0; i < arr.length; i += 2) {
      const f = arr[i], a = arr[i + 1], r0 = Math.max(RO + 3, f.r - f.len), r1 = f.r;
      if (r1 <= r0) continue;
      const ca = Math.cos(a), sa = Math.sin(a);
      S.moveTo(cx + ca * r0, cy + sa * r0); S.lineTo(cx + ca * r1, cy + sa * r1);
    }
    S.stroke();
  }
  S.globalAlpha = 1;
}
function drawOuterFar() {
  const span = RMAX - RO - 20, r0 = RO + 3;
  for (const h of hazes) {
    const e = hazeEnv(h); if (e <= 0.01) continue;
    if (h.seed === undefined) h.seed = Math.random() * 1000;
    const L = h.cur * span;
    radialLines(h.a + ringRot - h.w / 2, h.a + ringRot + h.w / 2, OSTEP * 0.55, r0, L, h.seed, 0.45);
    S.strokeStyle = GR['s' + (h.tint === 1 ? 0 : h.tint === 2 ? 2 : 1)];
    S.globalAlpha = Math.min(1, h.alpha * e * 0.05 * C.hazeBright); S.lineWidth = 2.2; S.stroke();
    S.globalAlpha = Math.min(1, h.alpha * e * 0.6 * C.hazeBright); S.lineWidth = 0.55; S.stroke();
  }
  drawStrands(strandLayers[0], null);
  drawStrands(strandLayers[1], null);
  drawFlyers(false);
  S.globalAlpha = 1;
}
function drawOuterNear() {
  const r0 = RO + 3;
  const col = { dash: [], tip: [] };
  drawStrands(strandLayers[2], col);
  drawStrands(strandLayers[4], col);
  drawStrands(strandLayers[3], null);
  S.strokeStyle = '#fff'; S.lineWidth = 1.05;
  for (const lv of [0.35, 0.65, 1]) {
    S.globalAlpha = Math.min(1, lv * C.dashBright); S.beginPath();
    const dp = col.dash;
    for (let i = 0; i < dp.length; i += 5) {
      const a = dp[i + 4]; if (a > lv || a <= lv - 0.35) continue;
      S.moveTo(cx + dp[i] * (r0 + dp[i + 2]), cy + dp[i + 1] * (r0 + dp[i + 2])); S.lineTo(cx + dp[i] * (r0 + dp[i + 3]), cy + dp[i + 1] * (r0 + dp[i + 3]));
    }
    S.stroke();
  }
  S.fillStyle = '#fff';
  for (let i = 0; i < col.tip.length; i += 4) {
    S.globalAlpha = Math.min(1, col.tip[i + 3] * 1.2);
    const r = r0 + col.tip[i + 2];
    S.fillRect(cx + col.tip[i] * r - 0.8, cy + col.tip[i + 1] * r - 0.8, 1.6, 1.6);
  }
  drawFlyers(true);
  S.strokeStyle = GR.s0;
  for (const f of flares) {
    if (f.seed === undefined) f.seed = Math.random() * 1000;
    const t = f.age / f.life, e = (t < 0.15 ? t / 0.15 : Math.pow(1 - (t - 0.15) / 0.85, 2)) * f.alpha;
    const L = f.len * (0.6 + 0.4 * easeO(Math.min(1, t * 3)));
    radialLines(f.a + ringRot - f.w / 2, f.a + ringRot + f.w / 2, OSTEP * 0.45, r0, L, f.seed, 0.4);
    S.globalAlpha = Math.min(1, e * 0.06 * C.flareBright); S.lineWidth = 2.6; S.stroke();
    S.globalAlpha = Math.min(1, e * C.flareBright); S.lineWidth = 0.8; S.stroke();
  }
  S.globalAlpha = 1;
}

let bokehs = [], bokehSpr = null;
function mkBokehSprite() {
  const c = mk(128, 128);
  const x = c.getContext('2d'), g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,.9)'); g.addColorStop(0.5, 'rgba(235,232,255,.5)'); g.addColorStop(0.82, 'rgba(220,215,255,.22)');
  g.addColorStop(0.93, 'rgba(225,220,255,.32)'); g.addColorStop(1, 'rgba(220,215,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128); return c;
}
function newBokeh() {
  const big = Math.random() < 0.3;
  return {
    x: rr(-0.1, 1.1) * W, y: rr(-0.1, 1.1) * H, r: big ? rr(24, 64) : rr(5, 22), a: big ? rr(0.025, 0.07) : rr(0.05, 0.16),
    vx: rr(-10, 10), vy: rr(-6, 6), st: Math.random() < 0.3 ? rr(2, 5) : 1, ph: Math.random() * TAU
  };
}
function drawBokeh(dt) {
  const n = Math.round(C.bokeh);
  while (bokehs.length < n) bokehs.push(newBokeh());
  if (bokehs.length > n) bokehs.length = n;
  if (!n) return;
  if (!bokehSpr) bokehSpr = mkBokehSprite();
  const k = 1 + 0.6 * C.parallax, z = 1 + (cam.z - 1) * k, ox = (cam.x - W / 2) * k, oy = (cam.y - H / 2) * k;
  S.setTransform(DPR, 0, 0, DPR, 0, 0); S.globalCompositeOperation = 'lighter';
  for (const b of bokehs) {
    b.x += b.vx * dt; b.y += b.vy * dt;
    if (b.x < -0.15 * W) b.x += 1.3 * W; if (b.x > 1.15 * W) b.x -= 1.3 * W;
    if (b.y < -0.15 * H) b.y += 1.3 * H; if (b.y > 1.15 * H) b.y -= 1.3 * H;
    const sx = (b.x - W / 2 - ox) * z + W / 2, sy = (b.y - H / 2 - oy) * z + H / 2, r = b.r * z;
    S.globalAlpha = Math.min(1, b.a * C.bokehBright * (0.75 + 0.25 * Math.sin(T * 0.8 + b.ph)) * (1 + env * 0.3));
    S.drawImage(bokehSpr, sx - r * b.st, sy - r, 2 * r * b.st, 2 * r);
  }
  S.globalAlpha = 1; S.globalCompositeOperation = 'source-over';
}

let RING_SC = 3.4;
let slots = [];
const easeOX = t => t >= 1 ? 1 : 1 - Math.pow(2, -10 * t);
const rot = { from: 0, to: 0, t: 1, dur: 1, hold: 0, ease: easeIO };
function ringMove() {
  const r = Math.random(); let d, dur, ease;
  if (r < 0.22) { d = rr(1.1, 2.1); dur = rr(0.7, 1.05); ease = easeIO; }
  else if (r < 0.64) { d = rr(0.14, 0.48); dur = rr(0.18, 0.38); ease = easeOX; }
  else { d = rr(0.05, 0.18); dur = rr(0.3, 0.6); ease = easeIO; }
  if (Math.random() < 0.08) d = -d * 0.5;
  d *= C.ringSpeed;
  Object.assign(rot, { from: ringRot, to: ringRot + d, t: 0, dur, ease, hold: rr(0.04, 0.4) * C.ringPause });
}
function updateRing(dt) {
  if (rot.t < rot.dur) { rot.t += dt; ringRot = rot.from + (rot.to - rot.from) * rot.ease(Math.min(1, rot.t / rot.dur)); }
  else { rot.hold -= dt; ringRot += 0.02 * dt; }
}
function buildCards() {
  slots = [];
  const band = RO - R, mid = R + band * 0.42;
  const lo = 52, hi = 92;
  let a = 0;
  while (a < TAU - 0.03) {
    const hpx = rr(lo, hi), da = hpx / mid, gap = rr(4, 10) / mid;
    slots.push({ a: a + da / 2, da, hpx, c: null, flash: 0, item: null, at: 0 });
    a += da + gap;
  }
  Object.assign(rot, { from: 0, to: 0, t: 1, dur: 1, hold: 0 });
}
function rimW() { return Math.max(3, (RO - R) * 0.065 * C.rimWidth); }

function pool() {
  const s = state.snap || {};
  const a = s.agent || {}, h = s.host || {}, tools = s.tools || [], turns = s.turns || [], ser = s.series || {};
  const list = [];
  for (const t of tools.slice(0, 8)) {
    const l = toolLat(s, t);
    list.push({
      tag: 'TOOL', head: String(t.n), rows: [
        ['calls', fmt(t.calls), clamp(num(t.calls) / Math.max(1, a.calls || 1), 0, 1)],
        ['p95', fmtMs(l), clamp(l / 120000, 0, 1)],
        ['ok', String(t.ok), clamp(num(t.ok) / Math.max(1, num(t.calls)), 0, 1)],
        ['bad', String(t.bad), clamp(num(t.bad) / Math.max(1, num(t.calls)), 0, 1)]
      ]
    });
  }
  const ev = state.evt || evtStats(s);
  list.push({
    tag: 'AGENT', head: short(a.model || 'agent', 14), rows: [
      ['out', fmt(a.outTok), clamp(num(a.outTok) / 1e6, 0, 1)],
      ['in', fmt(a.inTok), clamp(num(a.inTok) / 1e6, 0, 1)],
      ['cache', fmt(a.cacheTok), clamp(num(a.cacheTok) / Math.max(1, num(a.inTok) + num(a.cacheTok)), 0, 1)],
      ['gen', String((ev.gen || []).length) + 'x', clamp((ev.gen || []).length / 40, 0, 1)]
    ]
  });
  list.push({
    tag: 'HOST', head: (h.platform || 'host') + ' ' + (h.cores || '') + 'c', rows: [
      ['cpu', (num(h.cpu)).toFixed(1) + '%', clamp(num(h.cpu) / 100, 0, 1)],
      ['mem', (num(h.mem)).toFixed(1) + '%', clamp(num(h.mem) / 100, 0, 1)],
      ['used', fmt(h.memUsed) + 'M', clamp(num(h.memUsed) / Math.max(1, num(h.memTotal)), 0, 1)],
      ['procs', String(h.procs ?? 0), clamp(num(h.procs) / 400, 0, 1)]
    ]
  });
  list.push({
    tag: 'SERIES', head: 'tok ' + String((ser.tok || []).length), rows: [
      ['lat', fmtMs(a.latency), clamp(num(a.latency) / 120000, 0, 1)],
      ['gap', fmtMs(evtCad(s)), clamp(evtCad(s) / 120000, 0, 1)],
      ['tps', (num(a.tps)).toFixed(1), clamp(num(a.tps) / 200, 0, 1)],
      ['err', String(num(a.errors)), clamp(num(a.errors) / 20, 0, 1)]
    ]
  });
  const tt = turns[turns.length - 1];
  if (tt) list.push({
    tag: 'TURN ' + String(tt.n), head: fmtAge(tt.at), rows: [
      ['steps', String(tt.steps), clamp(num(tt.steps) / 40, 0, 1)],
      ['calls', String(tt.calls), clamp(num(tt.calls) / 40, 0, 1)],
      ['tok', fmt(tt.tok), clamp(num(tt.tok) / 2e5, 0, 1)],
      ['err', String(tt.err), clamp(num(tt.err) / 10, 0, 1)]
    ]
  });
  for (const e of (s.events || []).slice(-16)) {
    list.push({ tag: 'EVENT', head: fmtTime(e.t) + ' ' + String(e.k || ''), rows: [['text', short(e.d || '', 46), 0]], text: String(e.d || '') });
  }
  return list.length ? list : [{ tag: 'IDLE', head: 'waiting', rows: [['stream', 'no events', 0]] }];
}

function fitText(x, s, maxW) {
  const t = String(s ?? '');
  if (maxW <= 0) return '';
  if (x.measureText(t).width <= maxW) return t;
  let lo = 0, hi = t.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (x.measureText(t.slice(0, mid) + '…').width <= maxW) lo = mid; else hi = mid - 1;
  }
  return lo > 0 ? t.slice(0, lo) + '…' : '';
}

function renderSlot(s, it) {
  const band = RO - R, h = s.hpx;
  const want = Math.max(RING_SC, ZOOM * DPR * 1.3);
  const areaCap = Math.sqrt(420000 / Math.max(1, band * (h + 2)));
  const sc = Math.max(1.6, Math.min(6, areaCap, 1600 / band, 900 / (h + 2), want));
  const c = mk(band * sc, (h + 2) * sc);
  const x = c.getContext('2d');
  x.scale(sc, sc);
  x.textBaseline = 'top';
  const RB = rimW(), x0 = RB + 4, xR = band - RB - 4;
  const strip = 7, x1 = xR - strip - 3;
  const w = x1 - x0, full = xR - x0;
  if (w < 20 || h < 26) { s.c = c; return; }
  const fs = clamp(Math.round(full * 0.052 * 10) / 10, 5.6, 10);
  const fh = Math.round(fs * 0.8 * 10) / 10;
  const rowH = Math.round(fs * 1.85 * 10) / 10;
  const headY = Math.round(fs * 1.22 * 10) / 10;
  const divY = Math.round(fs * 2.5 * 10) / 10;
  const rowY = divY + Math.round(fs * 0.45 * 10) / 10;
  x.fillStyle = 'rgba(236,239,246,.95)';
  x.font = `700 ${fs}px ${FONT}`;
  x.fillText(fitText(x, it.tag, full), x0, Math.round(fs * 0.18 * 10) / 10);
  const tg = x.measureText(it.tag).width;
  x.fillStyle = 'rgba(196,184,246,.88)';
  x.font = `600 ${fh}px ${FONT}`;
  const hx = x0 + Math.min(full * 0.52, tg + fs * 0.7);
  const room = xR - hx;
  if (room > fs * 2) x.fillText(fitText(x, it.head, room), hx, headY);
  x.fillStyle = 'rgba(232,235,242,.3)';
  x.fillRect(x0, divY, full, 0.6);
  const knobW = Math.min(w * 0.4, fs * 3.6);
  const valW = Math.max(fs * 2.2, w - knobW - fs * 0.8);
  x.font = `500 ${fh}px ${FONT}`;
  let y = rowY;
  for (const [k, v, p] of it.rows) {
    if (y + rowH > h - 0.6) break;
    x.fillStyle = 'rgba(232,235,242,.52)';
    x.fillText(fitText(x, k, knobW), x0, y);
    x.fillStyle = 'rgba(244,248,255,.96)';
    x.textAlign = 'right';
    x.fillText(fitText(x, v, valW), x1, y);
    x.textAlign = 'left';
    const by = y + fh * 1.32;
    if (by < h - 0.4) {
      x.fillStyle = 'rgba(232,235,242,.14)';
      x.fillRect(x0, by, w, 0.9);
      x.fillStyle = p > 0.85 ? 'rgba(240,166,198,.95)' : 'rgba(206,212,226,.8)';
      x.fillRect(x0, by, w * clamp(p, 0, 1), 0.9);
    }
    y += rowH;
  }
  if (it.text && strip > 3) {
    const pitch = 1.7;
    for (let lx = xR - strip, i = 0; lx < xR; lx += pitch, i++) {
      const ch = it.text.charCodeAt(i % Math.max(1, it.text.length)) || 65;
      const len = (h - 2) * (0.3 + (ch % 61) / 100);
      x.fillStyle = `rgba(225,228,236,${0.16 + (ch % 41) / 120})`;
      x.fillRect(lx, 1, 0.9, len);
    }
  }
  s.c = c;
}
function drawRing(dt) {
  const band = RO - R;
  S.globalCompositeOperation = 'source-over';
  S.save(); S.translate(cx, cy);
  S.beginPath(); S.arc(0, 0, RO, 0, TAU); S.arc(0, 0, R, 0, TAU, true);
  S.fillStyle = '#040506'; S.fill('evenodd');
  const items = state.poolCache || (state.poolCache = pool());
  let regen = Date.now() - zoomAt < 900 ? 12 : 2, idx = 0;
  for (const s of slots) {
    const A = s.a + ringRot;
    if (s.flash > 0) s.flash = Math.max(0, s.flash - dt * 2.2);
    const mid = R + band * 0.42;
    const sp = toScreen(cx + Math.cos(A) * mid, cy + Math.sin(A) * mid);
    if (sp.x < -140 || sp.x > W + 140 || sp.y < -140 || sp.y > H + 140) { s.c = null; s.item = null; idx++; continue; }
    const stale = !s.item || Date.now() - s.at > 9000;
    const need = !s.c || (regen > 0 && (Math.random() < 0.03 || stale));
    if (need && (regen > 0 || !s.c)) {
      const it = items[(idx * 7 + Math.floor(Date.now() / 2600)) % items.length];
      s.item = it; s.at = Date.now();
      renderSlot(s, it);
      regen--;
    }
    if (!s.c) { idx++; continue; }
    S.save(); S.rotate(A);
    const hh = s.hpx + 2;
    S.drawImage(s.c, R, -hh / 2, band, hh);
    if (s.flash > 0.02) { S.globalCompositeOperation = 'lighter'; S.globalAlpha = s.flash; S.drawImage(s.c, R, -hh / 2, band, hh); S.globalAlpha = 1; S.globalCompositeOperation = 'source-over'; }
    S.restore();
    idx++;
  }
  const tick = (step, fn) => {
    const n0 = Math.floor((-thV - 0.05 - ringRot) / step), n1 = Math.ceil((thV + 0.05 - ringRot) / step);
    for (let n = n0; n <= n1; n++) { const a = n * step + ringRot; fn(Math.cos(a), Math.sin(a), n); }
  };
  const RB = rimW();
  S.beginPath();
  tick(0.14 / C.rimDensity * Math.PI / 180, (ca, sa, n) => {
    const m = ((n % 6) + 6) % 6;
    const li = m === 0 ? RB : RB * (0.5 + 0.35 * hash(n));
    const lo = m === 0 ? RB : RB * (0.5 + 0.35 * hash(n + 77));
    S.moveTo(ca * (R + 1.5), sa * (R + 1.5)); S.lineTo(ca * (R + 1.5 + li), sa * (R + 1.5 + li));
    S.moveTo(ca * (RO - 1.5), sa * (RO - 1.5)); S.lineTo(ca * (RO - 1.5 - lo), sa * (RO - 1.5 - lo));
  });
  S.globalCompositeOperation = 'lighter';
  S.strokeStyle = `rgba(232,235,242,${Math.min(1, 0.035 * C.rimBright * C.rimBright)})`; S.lineWidth = 1.2 + 2.4 * C.rimBright; S.stroke();
  S.strokeStyle = `rgba(232,235,242,${Math.min(1, 0.08 * C.rimBright)})`; S.lineWidth = 1.4; S.stroke();
  S.globalCompositeOperation = 'source-over';
  S.strokeStyle = `rgba(240,242,248,${Math.min(1, 0.88 * C.rimBright)})`; S.lineWidth = 0.55; S.stroke();
  const arc = (r, lw, a) => { S.strokeStyle = `rgba(232,235,242,${a})`; S.lineWidth = lw; S.beginPath(); S.arc(0, 0, r, -thV, thV); S.stroke(); };
  arc(R, 1.5, 1); arc(R + RB + 3, 0.6, 0.6); arc(RO - RB - 3, 0.6, 0.55);
  S.globalCompositeOperation = 'lighter'; arc(RO, 3.5, 0.1); S.globalCompositeOperation = 'source-over';
  arc(RO, 1.3, 0.95);
  S.beginPath();
  tick(1 * Math.PI / 180, (ca, sa) => { S.moveTo(ca * (R - 2), sa * (R - 2)); S.lineTo(ca * (R - 5), sa * (R - 5)); });
  tick(0.25 * Math.PI / 180, (ca, sa, n) => {
    const m = ((n % 20) + 20) % 20, L = m === 0 ? 9 : m % 5 === 0 ? 5 : 2.5;
    S.moveTo(ca * (RO + 2), sa * (RO + 2)); S.lineTo(ca * (RO + 2 + L), sa * (RO + 2 + L));
  });
  S.strokeStyle = 'rgba(230,233,240,.5)'; S.lineWidth = 0.6; S.stroke();
  S.restore();
}

let traffic = 0;
function beat(strength) {
  sinceTick = 0;
  env = Math.min(1, env + strength);
  if (rot.t >= rot.dur && rot.hold <= 0) ringMove();
  const n = Math.round(strength > 0.6 ? C.cometBurst : C.cometPerBeat);
  for (let i = 0; i < n; i++) setTimeout(spawnComet, i * rr(30, 90));
  const dir = Math.random() < 0.5 ? 1 : -1;
  pulses.push({ c: dir > 0 ? -thS - 0.15 : thS + 0.15, v: dir * rr(0.7, 1.6) * clamp(strength, 0.3, 1), w: rr(0.05, 0.3), amp: clamp(strength, 0.3, 1), life: rr(1.2, 2), L: 0 });
  onBeatOuter();
  state.poolCache = null;
}

let trailC = null, farC = null, glowC = null, runners = [];
function resizeStage() {
  const r = stage.getBoundingClientRect();
  W = Math.max(320, r.width); H = Math.max(240, r.height);
  DPR = Math.min(2.5, Math.max(1, window.devicePixelRatio || 1));
  RING_SC = Math.min(5, Math.max(2.4, DPR * 1.9 * Math.pow(ZOOM, 0.85)));
  zoomAt = Date.now();
  stage.width = Math.ceil(W * DPR); stage.height = Math.ceil(H * DPR);
  cx = W * 0.07; cy = H * 0.5;
  R = Math.max(H * 0.78, W * 0.3);
  RO = R + Math.max(90, Math.min(240, H * 0.3, W * 0.13)) * C.ringWidth;
  RMAX = Math.hypot(W - cx, H / 2) + 60;
  thV = Math.asin(Math.min(1, (H / 2 + 60) / R));
  thS = Math.asin(Math.min(1, (H / 2 + 40) / RO));
  buildWeb(); buildLanes(); buildCards(); buildOuter();
  trailC = mkd(2 * R + 4, 2 * R + 4, Math.min(DPR, 1.5));
  trailC.width = Math.ceil((2 * R + 4) * Math.min(DPR, 1.5));
  trailC.height = Math.ceil((2 * R + 4) * Math.min(DPR, 1.5));
  trailC.x.setTransform(Math.min(DPR, 1.5), 0, 0, Math.min(DPR, 1.5), 0, 0);
  farC = mk(W * FS, H * FS);
  glowC = mk(W / GS, H / GS);
  runners = [];
  const rc = Math.round(clamp(num((state.snap && state.snap.agent && state.snap.agent.calls) || 0) * 1.2, 160, 620));
  C.runnerCount = rc;
  for (let i = 0; i < rc; i++) runners.push(newRunner(true));
  comets = []; pulses = [];
  buildShots();
}

function drawStage(dt) {
  updateCam(dt); updateOuter(dt);
  if (Math.random() < dt * C.cometTrickle) spawnComet();
  webRot += dt * (0.03 + env * 0.12) * C.webSpin;
  updateRing(dt);
  for (let k = 0; k < 3; k++) { if (!state.webEnv) state.webEnv = [0, 0, 0]; state.webEnv[k] *= Math.exp(-dt * 2.2); }
  const layEnv = state.webEnv || [0, 0, 0];

  S.setTransform(DPR, 0, 0, DPR, 0, 0);
  S.globalCompositeOperation = 'source-over'; S.globalAlpha = 1;
  S.fillStyle = '#08090b'; S.fillRect(0, 0, W, H);

  const G = glowC.getContext('2d');
  G.setTransform(1, 0, 0, 1, 0, 0); G.clearRect(0, 0, glowC.width, glowC.height);
  camT(G, 1 / GS); G.globalCompositeOperation = 'lighter';

  camTk(S, DPR, 1 - 0.1 * C.parallax);
  S.save(); S.translate(cx, cy); S.rotate(webRot);
  const ws = 2 * R + 4;
  S.drawImage(webBase, -R - 2, -R - 2, ws, ws);
  S.globalCompositeOperation = 'lighter';
  webLayers.forEach((c, k) => { S.globalAlpha = Math.min(1, C.webPulseBase + C.webPulseAmp * layEnv[k]); S.drawImage(c, -R - 2, -R - 2, ws, ws); });
  S.globalAlpha = 1;

  const tx = trailC.x, surge = 0.5 + 2.5 * env;
  while (runners.length < C.runnerCount) runners.push(newRunner(true));
  if (runners.length > C.runnerCount) runners.length = Math.max(0, Math.round(C.runnerCount));
  tx.globalCompositeOperation = 'destination-out';
  tx.fillStyle = `rgba(0,0,0,${0.05 + env * 0.05})`; tx.fillRect(0, 0, ws, ws);
  tx.globalCompositeOperation = 'source-over';
  tx.save(); tx.translate(R + 2, R + 2); tx.lineCap = 'round';
  for (let i = 0; i < runners.length; i++) {
    const r = runners[i];
    r.t += dt * C.runnerSpeed * (r.mode === 1 ? r.sp * surge : r.mode === 2 ? r.sp + 1.3 * r.t * r.t : r.sp);
    if (r.t >= 1) { runners[i] = newRunner(false); continue; }
    const p = qpt(r.cv, r.t);
    tx.strokeStyle = r.b ? `rgba(240,166,198,${Math.min(1, 0.9 * C.runnerBright)})` : `rgba(250,251,255,${Math.min(1, 0.75 * C.runnerBright)})`;
    tx.lineWidth = (r.b ? 1.3 : 0.9) * C.runnerWidth;
    tx.beginPath(); tx.moveTo(r.px, r.py); tx.lineTo(p.x, p.y); tx.stroke();
    r.px = p.x; r.py = p.y;
  }
  tx.restore();
  S.drawImage(trailC, -R - 2, -R - 2, ws, ws);
  S.restore();
  camT(S, DPR);

  if (C.ringShadow > 0) {
    const sg = S.createRadialGradient(cx, cy, R - 110, cx, cy, R);
    sg.addColorStop(0, 'rgba(4,5,6,0)'); sg.addColorStop(1, `rgba(4,5,6,${Math.min(1, 0.8 * C.ringShadow)})`);
    S.globalCompositeOperation = 'source-over'; S.globalAlpha = 1; S.fillStyle = sg;
    S.beginPath(); S.arc(cx, cy, R, 0, TAU); S.arc(cx, cy, R - 110, 0, TAU, true); S.fill('evenodd');
  }

  S.save(); S.translate(cx, cy); S.globalCompositeOperation = 'lighter'; S.lineCap = 'round';
  G.save(); G.translate(cx, cy);
  for (let i = comets.length - 1; i >= 0; i--) {
    const c = comets[i];
    c.life += dt;
    const p = easeIO(Math.min(1, c.life / c.dur));
    const head = Math.min(1, p * (1 + c.win)), tail = Math.max(0, p * (1 + c.win) - c.win);
    const fade = c.life > c.dur ? Math.max(0, 1 - (c.life - c.dur) / 0.25) : 1;
    if (fade <= 0) { comets.splice(i, 1); continue; }
    const cr = C.cometFollow ? ringRot - c.rot0 : 0;
    S.save(); S.rotate(cr); G.save(); G.rotate(cr);
    const col = c.tint ? '200,190,250' : '255,255,255';
    S.strokeStyle = `rgba(${col},${Math.min(1, 0.5 * fade * C.cometBright)})`; S.lineWidth = 1;
    strokeComet(S, c, tail, head, 18);
    const hs = head - (head - tail) * 0.35;
    S.strokeStyle = `rgba(${col},${Math.min(1, fade * C.cometBright)})`; S.lineWidth = 1.7;
    strokeComet(S, c, hs, head, 8);
    if (c.glow && C.cometGlow > 0) { G.strokeStyle = `rgba(${col},${Math.min(1, 0.5 * fade * C.cometGlow)})`; G.lineWidth = 2.8; strokeComet(G, c, hs, head, 6); }
    G.restore(); S.restore();
  }
  G.restore();
  S.restore();

  S.globalCompositeOperation = 'lighter';
  if (laneC) S.drawImage(laneC, 0, 0, W, H);
  const F = farC.getContext('2d');
  F.setTransform(1, 0, 0, 1, 0, 0); F.globalAlpha = 1; F.globalCompositeOperation = 'source-over'; F.clearRect(0, 0, farC.width, farC.height);
  camT(F, FS); F.globalCompositeOperation = 'lighter';
  S = F; drawOuterFar(); S = S_MAIN;
  S.save(); S.setTransform(DPR, 0, 0, DPR, 0, 0); S.globalCompositeOperation = 'lighter';
  if (HAS_FILTER && C.depthBlur > 0) S.filter = `blur(${C.depthBlur}px)`;
  S.globalAlpha = Math.min(1, C.depthDim); S.drawImage(farC, 0, 0, W, H);
  S.restore();
  if (C.atmos > 0) {
    const ag = S.createRadialGradient(cx, cy, RO, cx, cy, RO + (RMAX - RO) * 0.7);
    ag.addColorStop(0, `rgba(190,180,240,${Math.min(1, 0.07 * C.atmos)})`);
    ag.addColorStop(0.4, `rgba(150,145,210,${Math.min(1, 0.028 * C.atmos)})`);
    ag.addColorStop(1, 'rgba(0,0,0,0)');
    S.globalAlpha = 1; S.fillStyle = ag;
    S.beginPath(); S.arc(cx, cy, RMAX, 0, TAU); S.arc(cx, cy, RO, 0, TAU, true); S.fill('evenodd');
  }
  drawOuterNear();
  drawRing(dt);

  S.setTransform(DPR, 0, 0, DPR, 0, 0);
  S.globalCompositeOperation = 'lighter';
  if (HAS_FILTER) S.filter = 'blur(6px)';
  S.globalAlpha = Math.min(1, 0.9 * C.glow);
  S.drawImage(glowC, 0, 0, glowC.width * GS, glowC.height * GS);
  if (HAS_FILTER) S.filter = 'none';
  S.globalAlpha = 1; S.globalCompositeOperation = 'source-over';

  drawBokeh(dt);
  if (C.vignette > 0) {
    S.setTransform(DPR, 0, 0, DPR, 0, 0);
    const vg = S.createRadialGradient(W * 0.45, H * 0.5, Math.min(W, H) * 0.35, W * 0.45, H * 0.5, Math.hypot(W, H) * 0.62);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, `rgba(0,0,0,${Math.min(1, 0.75 * C.vignette)})`);
    S.fillStyle = vg; S.fillRect(0, 0, W, H);
  }
  drawCallout();
}

const CHECKS = [
  () => ['CTX PRESSURE', (() => { const a = (state.snap && state.snap.agent) || {}; return num(a.contextWindow) > 0 ? ((num(a.pressure) * 100).toFixed(3)) + ' %' : 'ctx unknown'; })()],
  () => ['ERROR RATE', (num(state.snap && state.snap.agent && state.snap.agent.errorRate)).toFixed(1) + ' %'],
  () => ['P95 TOOL LATENCY', fmtMs(Math.max(0, ...(state.snap && state.snap.tools ? state.snap.tools.slice(0, 8).map(t => toolLat(state.snap, t)) : [0])))],
  () => ['STEP TURN GAP', fmtMs(evtCad(state.snap) || (state.snap && state.snap.agent ? state.snap.agent.cadence : 0))],
  () => ['HOST CPU', (num(state.snap && state.snap.host && state.snap.host.cpu)).toFixed(1) + ' %'],
  () => ['MEMORY USED', fmt(state.snap && state.snap.host ? state.snap.host.memUsed : 0) + ' / ' + fmt(state.snap && state.snap.host ? state.snap.host.memTotal : 0) + ' M'],
  () => ['CACHE READ', fmt(state.snap && state.snap.agent ? state.snap.agent.cacheTok : 0)],
  () => ['OUTPUT TOKENS', fmt(state.snap && state.snap.agent ? state.snap.agent.outTok : 0)]
];
let chkI = 0;
const chkEl = document.getElementById('chk');
const chkK = document.getElementById('chkK');
const chkV = document.getElementById('chkV');
function drawCallout() {
  const a = -thS * 0.32;
  const anchor = toScreen(cx + Math.cos(a) * (RO + 30), cy + Math.sin(a) * (RO + 30));
  const box = toScreen(cx + Math.cos(a) * (RO + 30) + 120, cy + Math.sin(a) * (RO + 30) - 40);
  const bx = Math.min(W - 210, Math.max(8, box.x)), by = Math.min(H - 60, Math.max(40, box.y));
  chkEl.style.transform = `translate(${bx}px,${by}px)`;
  S.strokeStyle = 'rgba(230,233,238,.55)'; S.lineWidth = 0.8;
  S.beginPath(); S.moveTo(anchor.x, anchor.y); S.lineTo(bx, by + 12); S.stroke();
  S.fillStyle = '#fff'; S.fillRect(anchor.x - 1.5, anchor.y - 1.5, 3, 3);
}
setInterval(() => {
  chkEl.style.opacity = 0;
  setTimeout(() => {
    chkI = (chkI + 1) % CHECKS.length;
    const [k, v] = CHECKS[chkI]();
    chkK.textContent = k; chkV.textContent = v;
    chkEl.style.opacity = 1;
  }, 400);
}, 3200);

const segs = [...document.querySelectorAll('.kpi .seg i')];
const kEl = [0, 1, 2, 3, 4].map(i => document.getElementById('k' + i));
function renderKpi() {
  const a = (state.snap && state.snap.agent) || {};
  const turns = num(a.turns), steps = num(a.steps), calls = num(a.calls);
  const out = num(a.outTok), cache = num(a.cacheTok), inp = num(a.inTok);
  kEl[0].textContent = fmt(turns);
  kEl[1].textContent = fmt(steps);
  kEl[2].textContent = fmt(calls);
  kEl[3].textContent = fmt(out);
  kEl[4].textContent = ((cache / Math.max(1, cache + inp)) * 100).toFixed(1) + '%';
  const w = [
    clamp(turns / 60, 0, 1),
    clamp(steps / Math.max(60, turns * 14), 0, 1),
    clamp(calls / Math.max(10, steps * 1.2), 0, 1),
    clamp(out / 1e6, 0, 1),
    clamp(cache / Math.max(1, cache + inp), 0, 1)
  ];
  segs.forEach((s, i) => { s.style.width = (w[i] * 100).toFixed(1) + '%'; });
  const live = !!a.live;
  document.getElementById('stBig').textContent = `${fmt(steps)} STEPS / ${fmt(calls)} CALLS · ${live ? 'LIVE' : 'IDLE'}`;
  const prov = a.provider ? a.provider + '/' : '';
  document.getElementById('stSm').textContent = `${prov}${a.model || 'route pending'} · ctx ${num(a.contextWindow) > 0 ? fmt(num(a.contextWindow)) : 'unknown'} · gap ${fmtMs(evtCad(state.snap) || a.cadence)}`;
  document.getElementById('brandSub').textContent = `${a.source || 'file'} · ${state.src || 'same-origin'} · ${state.sessions.length} sessions on disk`;
  document.getElementById('brandTitle').textContent = a.title ? short(String(a.title).toUpperCase(), 40) : 'EventHorizon-Ops · LIVE CONSOLE';
}

const feedEl = document.getElementById('feed');
let feedKeys = new Set();
function renderFeed() {
  const evs = (state.snap && state.snap.events) || [];
  const txt = (state.snap && state.snap.text) || [];
  const merged = [];
  for (const e of evs) merged.push({ t: num(e.t), k: String(e.k || 'sys'), n: String(e.n || ''), d: String(e.d || ''), key: 'e' + e.t + e.k + e.d });
  for (const x of txt) merged.push({ t: num(x.t), k: 'code', n: String(x.n || ''), d: String(x.s || ''), key: 'x' + x.t + x.s });
  merged.sort((a, b) => a.t - b.t);
  const frag = document.createDocumentFragment();
  let count = 0, recent = 0;
  const now = Date.now();
  for (const m of merged) {
    if (feedKeys.has(m.key)) continue;
    feedKeys.add(m.key);
    const d = document.createElement('div');
    const vb = m.k === 'tool' ? 'tool' : m.k === 'done' ? 'done' : m.k === 'model' ? 'model' : m.k === 'user' ? 'user' : m.k === 'err' ? 'err' : m.k === 'turn' ? 'turn' : m.k === 'code' ? 'sys' : 'sys';
    d.innerHTML = `<span class="n">${fmtTime(m.t)}</span><span class="vb ${vb}">${short(m.n || m.k, 6)}</span>${short(m.d, 120)}`;
    frag.appendChild(d);
    count++;
    if (now - m.t < 60000) recent++;
  }
  if (feedKeys.size > 3000) feedKeys = new Set([...feedKeys].slice(-1200));
  if (count) {
    feedEl.appendChild(frag);
    const lh = 13;
    const room = Math.max(3, Math.floor((feedEl.clientHeight || 180) / lh));
    while (feedEl.children.length > room) feedEl.removeChild(feedEl.firstChild);
  }
  document.title = 'EventHorizon-Ops · LIVE AGENT CONSOLE';
}
setInterval(() => {
  const evs = (state.snap && state.snap.events) || [];
  const now = Date.now();
  const rate = evs.filter(e => now - num(e.t) < 60000).length;
  const el = document.getElementById('logRate');
  if (el) el.textContent = rate + '/m';
}, 2000);

function rowsRender(el, list) {
  if (!el) return;
  const html = list.map(r => `<div class="r${r.bad ? ' bad' : ''}"><b>${r.a}</b><span>${r.b}</span><em>${r.c}</em>${r.p == null ? '' : `<i><u style="width:${(clamp(r.p, 0, 1) * 100).toFixed(1)}%"></u></i>`}</div>`).join('');
  if (el.innerHTML !== html) el.innerHTML = html;
}
function renderPanels() {
  const s = state.snap || {};
  const a = s.agent || {}, h = s.host || {};
  const tools = (s.tools || []).slice(0, 6);
  const lat = tools.map(t => toolLat(s, t));
  const maxLat = Math.max(1, ...lat);
  rowsRender(document.getElementById('tools'), tools.map((t, i) => ({
    a: short(String(t.n), 15), b: fmt(t.calls) + 'c', c: fmtMs(lat[i]),
    p: lat[i] / maxLat, bad: num(t.bad) > 0
  })).concat(tools.length ? [] : [{ a: 'no calls', b: '', c: '' }]));

  const top = (h.top || []).slice(0, 3);
  const maxMb = Math.max(1, ...top.map(x => num(x.mb)));
  rowsRender(document.getElementById('host'), [
    { a: 'CPU', b: (h.cores || 0) + 'c ' + (h.platform || ''), c: num(h.cpu).toFixed(1) + '%', p: num(h.cpu) / 100, bad: num(h.cpu) > 92 },
    { a: 'MEM', b: fmt(h.memUsed) + '/' + fmt(h.memTotal) + 'M', c: num(h.mem).toFixed(1) + '%', p: num(h.mem) / 100, bad: num(h.mem) > 92 },
    { a: 'PROCS', b: 'uptime ' + fmtAge(Date.now() - num(h.uptime) * 1000), c: String(h.procs ?? 0), p: num(h.procs) / 400 }
  ].concat(top.map(x => ({ a: short(String(x.name), 15), b: x.pid + ' · ' + fmt(x.mb) + 'M', c: fmt(x.mb) + 'M', p: num(x.mb) / maxMb }))));

  const turns = (s.turns || []).slice(-6).reverse();
  const maxTok = Math.max(1, ...turns.map(t => num(t.tok)));
  rowsRender(document.getElementById('turns'), turns.map(t => ({
    a: 'T' + t.n + ' ' + fmtAge(t.at), b: t.steps + 'st ' + t.calls + 'c', c: fmt(t.tok),
    p: num(t.tok) / maxTok, bad: num(t.err) > 0
  })).concat(turns.length ? [] : [{ a: 'no turns', b: '', c: '' }]));

  const models = (a.models || []).map(m => (m.p ? m.p + '/' : '') + m.m);
  const nd = s.node || {};
  const ev = state.evt || evtStats(s);
  const ctxW = num(a.contextWindow);
  const routed = !!a.provider || !!a.model;
  const modelRows = [
    { a: 'provider', b: (ev.model || 0) + ' gen', c: routed ? short(String(a.provider), 14) : 'route pending', bad: !routed },
    { a: 'model', b: '', c: routed ? short(String(a.model), 14) : 'route pending', bad: !routed },
    { a: 'runtime', b: String(nd.mode || ''), c: short(String(nd.version || '—'), 14) },
    { a: 'context', b: ctxW > 0 ? fmt(ctxW) : 'unknown', c: ctxW > 0 ? ((num(a.pressure) * 100).toFixed(2)) + '%' : '—', p: ctxW > 0 ? clamp(num(a.pressure), 0, 1) : null },
    { a: 'in / out', b: fmt(a.inTok), c: fmt(a.outTok) },
    { a: 'cache', b: '', c: fmt(a.cacheTok), p: num(a.cacheTok) / Math.max(1, num(a.inTok) + num(a.cacheTok)) },
    { a: 'gap', b: 'derived', c: fmtMs(evtCad(s)) },
    { a: 'latency', b: 'request', c: fmtMs(a.latency) },
    { a: 'gen tok', b: (ev.gen || []).length + 'x', c: fmt(med(ev.gen || [])) },
    { a: 'span', b: (s.events || []).length + ' ev', c: fmtMs(ev.span) },
    { a: 'errors', b: num(a.errorRate).toFixed(1) + '%', c: String(num(a.errors)), bad: num(a.errors) > 0 }
  ];
  if (models.length > 1) modelRows.push({ a: 'seen', b: '', c: short(models.slice(-3).join(' '), 22) });
  rowsRender(document.getElementById('model'), modelRows);

  const sess = state.sessions.slice(0, 6);
  const sc = document.getElementById('sessCount');
  if (sc) sc.textContent = String(state.sessions.length);
  rowsRender(document.getElementById('sessions'), sess.map(x => ({
    a: short(String(x.id).replace(/^session-/, ''), 12), b: fmtAge(x.mtime), c: fmt(x.bytes / 1024) + 'k',
    p: num(x.bytes) / Math.max(1, num(sess[0].bytes))
  })).concat(sess.length ? [] : [{ a: 'listing…', b: '', c: '' }]));
}

let cTok = null, cStep = null;
function drawSeries() {
  const ser = (state.snap && state.snap.series) || {};
  const paint = (cv, a, b) => {
    if (!cv) return;
    const r = cv.getBoundingClientRect();
    if (cv.width !== Math.ceil(r.width * DPR) || cv.height !== Math.ceil(r.height * DPR)) {
      cv.width = Math.ceil(r.width * DPR); cv.height = Math.ceil(r.height * DPR);
    }
    const x = cv.getContext('2d');
    const w = r.width, h = r.height;
    x.setTransform(DPR, 0, 0, DPR, 0, 0);
    x.clearRect(0, 0, w, h);
    const pad = 2;
    const series = [a, b].filter(s => Array.isArray(s) && s.length);
    const all = series.flat().map(num);
    if (!all.length) {
      x.fillStyle = 'rgba(107,111,120,.6)';
      x.font = `9px ${FONT}`;
      x.fillText('no samples', pad, h / 2);
      return;
    }
    const max = Math.max(1, ...all);
    const cols = ['rgba(240,166,198,.95)', 'rgba(152,224,207,.85)'];
    series.forEach((s, si) => {
      const n = s.length;
      x.beginPath();
      for (let i = 0; i < n; i++) {
        const px = pad + (w - pad * 2) * (n === 1 ? 1 : i / (n - 1));
        const py = h - pad - (h - pad * 2) * (num(s[i]) / max);
        i ? x.lineTo(px, py) : x.moveTo(px, py);
      }
      x.strokeStyle = cols[si % 2]; x.lineWidth = si ? 1 : 1.3; x.stroke();
      const last = num(s[s.length - 1]);
      const px = w - pad, py = h - pad - (h - pad * 2) * (last / max);
      x.fillStyle = cols[si % 2];
      x.fillRect(px - 1.5, py - 1.5, 3, 3);
    });
    x.fillStyle = 'rgba(196,184,246,.9)';
    x.font = `9px ${FONT}`;
    x.fillText('max ' + fmt(max), pad, 9);
  };
  const clean = a => Array.isArray(a) ? a.map(num).filter(v => v > 0 && v < 599000) : [];
  const st = state.evt || evtStats(state.snap);
  const stepSeries = clean(ser.step).length ? clean(ser.step) : (st.cad || []).slice(-96).map(v => Math.round(v));
  const durAll = [].concat(...Object.keys(st.dur || {}).map(k => st.dur[k] || []));
  const latSeries = clean(ser.lat).length ? clean(ser.lat) : durAll.slice(-96);
  paint(cTok, clean(ser.tok), clean(ser.call));
  paint(cStep, stepSeries, latSeries);
}

function graphSig(snap) {
  const g = (snap && snap.graph) || {};
  const ns = g.nodes || [], es = g.edges || [];
  return ns.map(n => String(n.n) + ':' + num(n.v)).join('|') + '#' + es.length;
}
function applySnapshot(snap) {
  if (!snap || typeof snap !== 'object') return;
  state.snap = snap;
  state.evt = evtStats(snap);
  const sig = graphSig(snap);
  if (sig !== state.graphSig) {
    state.graphSig = sig;
    if (W > 0) buildWeb();
  }
  const a = snap.agent || {};
  const dSteps = num(a.steps) - state.prev.steps;
  const dCalls = num(a.calls) - state.prev.calls;
  state.prev.steps = num(a.steps); state.prev.calls = num(a.calls);
  if (dSteps > 0 || dCalls > 0) {
    const strength = clamp(0.35 + Math.min(0.5, dSteps * 0.12 + dCalls * 0.06), 0.3, 1);
    beat(strength);
    if (!state.webEnv) state.webEnv = [0, 0, 0];
    const lastEv = (snap.events || []).filter(e => String(e.k) === 'tool').pop();
    const src = String((lastEv && lastEv.n) || (snap.tools && snap.tools[0] && snap.tools[0].n) || '');
    state.webEnv[src.length % 3] = 1;
    if (dSteps > 3) state.webEnv = state.webEnv.map((v, i) => Math.max(v, clamp(dSteps / Math.max(1, i + 2) / 12, 0.6, 1)));
  }
  renderKpi(); renderFeed(); renderPanels(); drawSeries();
}

function url(p) { return (state.base == null ? '' : state.base) + p; }

async function probe() {
  if (location.port === '7788') { state.base = ''; state.src = 'local:7788'; return; }
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), 800);
  try {
    const res = await fetch('http://127.0.0.1:7788/state.json?t=' + Date.now(), { signal: ctl.signal, cache: 'no-store' });
    clearTimeout(to);
    if (res.ok) {
      const body = await res.json();
      if (body && body.t) { state.base = 'http://127.0.0.1:7788/'; state.src = 'local:7788'; return; }
    }
  } catch (e) { clearTimeout(to); }
  state.base = ''; state.src = 'host';
}

async function loadSessions() {
  try {
    const res = await fetch(url('sessions.json?t=' + Date.now()), { cache: 'no-store' });
    if (!res.ok) return;
    const body = await res.json();
    const rows = Array.isArray(body) ? body : (body && Array.isArray(body.sessions) ? body.sessions : []);
    if (rows.length) { state.sessions = rows; renderPanels(); }
  } catch (e) { }
}

let es = null, pollTimer = null;
function beginPoll() {
  if (pollTimer) return;
  pollTimer = setInterval(async () => {
    try {
      const res = await fetch(url('state.json?t=' + Date.now()), { cache: 'no-store' });
      if (!res.ok) return;
      applySnapshot(await res.json());
    } catch (e) { }
  }, 900);
}
function run() {
  try { if (es) es.close(); } catch (e) { }
  es = new EventSource(url('stream'));
  es.onmessage = ev => { try { applySnapshot(JSON.parse(ev.data)); } catch (e) { } };
  es.onerror = () => {
    try { es.close(); } catch (e) { }
    es = null;
    beginPoll();
    setTimeout(run, 4000);
  };
}
async function pullState() {
  try {
    const res = await fetch(url('state.json?t=' + Date.now()), { cache: 'no-store' });
    if (res.ok) { applySnapshot(await res.json()); return true; }
  } catch (e) { }
  return false;
}
async function upgradeCollector() {
  const s = state.snap;
  if (!s) return false;
  const ser = s.series || {};
  const a = s.agent || {};
  if (ser.step && ser.step.length && a.provider) return false;
  try {
    const res = await fetch(url('reload?t=' + Date.now()), { cache: 'no-store', method: 'GET' });
    if (!res.ok) return false;
    await new Promise(r => setTimeout(r, 900));
    return pullState();
  } catch (e) { return false; }
}
async function boot() {
  await pullState();
  await upgradeCollector();
  loadSessions();
  run();
  setInterval(loadSessions, 15000);
  setInterval(() => { if (!state.snap) pullState(); }, 2000);
}

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now; T += dt;
  sinceTick += dt;
  env *= Math.exp(-dt * 4.5);
  const agent = (state.snap && state.snap.agent) || {};
  if (sinceTick > 6 && agent.live) beat(0.22);
  drawStage(dt);
  requestAnimationFrame(frame);
}

function resizeAll() {
  resizeStage();
  drawSeries();
}
let rt = null;
function watchResize() {
  if (rt) clearTimeout(rt);
  rt = setTimeout(resizeAll, 120);
}
window.addEventListener('resize', watchResize);
if (typeof ResizeObserver === 'function') new ResizeObserver(watchResize).observe(document.getElementById('stageWrap'));
if (window.matchMedia) {
  const dprq = () => {
    const q = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    const on = () => {
      DPR = Math.min(2.5, Math.max(1, window.devicePixelRatio || 1));
      zoomAt = Date.now();
      resizeStage();
      for (const s of slots) { s.c = null; s.item = null; }
      q.removeEventListener && q.removeEventListener('change', on);
      dprq();
    };
    q.addEventListener && q.addEventListener('change', on);
  };
  dprq();
}
const zoomTag = document.getElementById('zoomTag');
function syncZoom() {
  if (zoomTag) zoomTag.textContent = '×' + (Math.round(ZOOM * 100) / 100).toFixed(2);
  document.body.classList.toggle('zoomed', ZOOM > 1.001);
}
function setZoom(z, sx, sy) {
  const nz = clamp(z, ZMIN, ZMAX);
  if (Math.abs(nz - ZOOM) < 1e-4) return;
  const ax = sx === undefined ? 0 : sx - W / 2, ay = sy === undefined ? 0 : sy - H / 2;
  PANX = ax - (ax - PANX) * (nz / ZOOM);
  PANY = ay - (ay - PANY) * (nz / ZOOM);
  ZOOM = nz;
  zoomAt = Date.now();
  if (ZOOM <= 1.001) { PANX = 0; PANY = 0; }
  RING_SC = Math.min(5, Math.max(2.4, DPR * 1.9 * Math.pow(ZOOM, 0.85)));
  for (const s of slots) { s.c = null; s.item = null; }
  if (webTimer) clearTimeout(webTimer);
  webTimer = setTimeout(() => { webTimer = 0; if (W > 0) buildWeb(); }, 220);
  syncZoom(); drawSeries();
}
function resetView() { ZOOM = 1; PANX = 0; PANY = 0; zoomAt = Date.now(); RING_SC = Math.min(5, Math.max(2.4, DPR * 1.9)); for (const s of slots) { s.c = null; s.item = null; } if (webTimer) clearTimeout(webTimer); webTimer = setTimeout(() => { webTimer = 0; if (W > 0) buildWeb(); }, 120); syncZoom(); drawSeries(); }
const stageWrap = document.getElementById('stageWrap');
window.addEventListener('wheel', e => {
  if (!e.target || !stageWrap.contains(e.target)) return;
  e.preventDefault();
  const r = stageWrap.getBoundingClientRect();
  setZoom(ZOOM * Math.exp(-e.deltaY * 0.0016), e.clientX - r.left, e.clientY - r.top);
}, { passive: false });
let drag = null;
stageWrap.addEventListener('pointerdown', e => {
  if (e.button !== 0) return;
  if (e.target && e.target.tagName === 'BUTTON') return;
  drag = { x: e.clientX, y: e.clientY, px: PANX, py: PANY, moved: false };
  stageWrap.setPointerCapture && stageWrap.setPointerCapture(e.pointerId);
});
stageWrap.addEventListener('pointermove', e => {
  if (!drag) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  if (!drag.moved && Math.abs(dx) + Math.abs(dy) > 3) { drag.moved = true; stageWrap.classList.add('grabbing'); }
  if (!drag.moved) return;
  PANX = drag.px + dx; PANY = drag.py + dy;
});
const endDrag = () => { if (drag) { drag = null; stageWrap.classList.remove('grabbing'); } };
stageWrap.addEventListener('pointerup', endDrag);
stageWrap.addEventListener('pointercancel', endDrag);
document.addEventListener('dblclick', () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen && document.documentElement.requestFullscreen();
});
window.addEventListener('keydown', e => {
  const tag = (e.target && e.target.tagName) || '';
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  if (e.key === 'f' || e.key === 'F') {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen && document.documentElement.requestFullscreen();
  } else if (e.key === '+' || e.key === '=') { setZoom(ZOOM * 1.18); }
  else if (e.key === '-' || e.key === '_') { setZoom(ZOOM / 1.18); }
  else if (e.key === '0') { resetView(); }
});
const zIn = document.getElementById('zIn'), zOut = document.getElementById('zOut'), zFit = document.getElementById('zFit');
if (zIn) zIn.addEventListener('click', () => setZoom(ZOOM * 1.3));
if (zOut) zOut.addEventListener('click', () => setZoom(ZOOM / 1.3));
if (zFit) zFit.addEventListener('click', resetView);
let UIZ = 1;
function setUi(z) {
  UIZ = clamp(z, 0.75, 1.6);
  document.documentElement.style.setProperty('--uiz', UIZ.toFixed(2));
  document.body.classList.toggle('uibig', UIZ > 1.14);
  if (typeof watchResize === 'function') watchResize();
  try { localStorage.setItem('eventhorizon.uiz', String(UIZ)); } catch (e) { }
  drawSeries();
}
try { const v = Number(localStorage.getItem('eventhorizon.uiz')); if (v > 0) setUi(v); } catch (e) { }
const uiIn = document.getElementById('uiIn'), uiOut = document.getElementById('uiOut');
if (uiIn) uiIn.addEventListener('click', () => setUi(UIZ * 1.12));
if (uiOut) uiOut.addEventListener('click', () => setUi(UIZ / 1.12));
syncZoom();
cTok = document.getElementById('cTok');
cStep = document.getElementById('cStep');
resizeStage();
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { resizeStage(); });
requestAnimationFrame(frame);
probe().then(boot);
