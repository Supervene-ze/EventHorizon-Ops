import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import zlib from "node:zlib";
import { execFile } from "node:child_process";
import { EventEmitter } from "node:events";

const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
const MAGIC_U32 = 0xfd2fb528;
const MAX_FILE_BYTES = 96 * 1024 * 1024;
const FULL_DECODE_BYTES = 9 * 1024 * 1024;
const HEAD_BYTES = 700_000;
const HEAD_FRAMES = 64;
const WINDOW_BYTES = 2_400_000;
const WINDOW_FRAMES = 110;
const MAX_EVENTS = 320;
const MAX_SERIES = 96;
const MAX_TEXT = 40;
const SEEN_LIMIT = 40_000;
const LIVE_MS = 30_000;

function frameOffsets(buf) {
  const out = [];
  let at = buf.indexOf(MAGIC, 0);
  while (at !== -1) {
    out.push(at);
    at = buf.indexOf(MAGIC, at + 4);
  }
  return out;
}

export function decodeTail(buf) {
  const offsets = frameOffsets(buf);
  if (offsets.length === 0) return "";
  const start = offsets[Math.max(0, offsets.length - WINDOW_FRAMES)];
  for (const offset of offsets) {
    if (offset < start) continue;
    try {
      const text = zlib.zstdDecompressSync(buf.subarray(offset)).toString("utf8");
      if (text.includes("{\"type\"")) return text;
    } catch {
      continue;
    }
  }
  return "";
}

function flat(value, size) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > size ? text.slice(0, size) + "\u2026" : text;
}

function bodyText(message) {
  if (!message || !Array.isArray(message.content)) return "";
  const parts = [];
  for (const block of message.content) {
    if (typeof block?.text === "string") parts.push(block.text);
    else if (block?.type === "image") parts.push("[img]");
    else if (block?.type === "reasoning") parts.push("[think]");
  }
  return parts.join(" ");
}

function parseTasklist(csv) {
  const rows = [];
  for (const line of csv.split(/\r?\n/)) {
    const m = line.match(/^"([^"]+)","(\d+)","[^"]*","[^"]*","([\d,. ]+) K"$/);
    if (!m) continue;
    rows.push({ name: m[1], pid: Number(m[2]), mb: Math.round(Number(m[3].replace(/[^\d]/g, "")) / 1024) });
  }
  return rows;
}

function cpuTotals() {
  let busy = 0n;
  let total = 0n;
  for (const cpu of os.cpus()) {
    const t = cpu.times;
    busy += BigInt(t.user + t.nice + t.sys + t.irq);
    total += BigInt(t.user + t.nice + t.sys + t.irq + t.idle);
  }
  return { busy, total };
}

function quantile(values, q) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const at = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * q)));
  return sorted[at];
}

export class SnapshotStore extends EventEmitter {
  constructor(options = {}) {
    super();
    this.root = options.sessionRoot ?? process.env.DSH_SESSION_ROOT ?? path.join(os.homedir(), ".dsh", "sessions");
    this.mode = options.mode ?? "file";
    this.seen = new Map();
    this.events = [];
    this.text = [];
    this.toolStats = new Map();
    this.pendingCalls = new Map();
    this.nodeCount = new Map();
    this.edges = new Map();
    this.lastTool = null;
    this.series = { tok: [], cpu: [], mem: [], call: [], lat: [], step: [] };
    this.lastStepAt = 0;
    this.turns = [];
    this.stepStart = new Map();
    this.usage = [];
    this.errors = 0;
    this.calls = 0;
    this.file = null;
    this.cursor = 0;
    this.sid = null;
    this.clock = 0;
    this.bulk = false;
    this.procs = { count: 0, top: [], at: 0 };
    this.procBusy = false;
    this.cpuPrev = cpuTotals();
    this.cpuSmooth = 0;
    this.memSmooth = 0;
    this.totalMem = Math.round(os.totalmem() / 1048576);
    this.startedAt = Date.now();
    this.timers = [];
    this.host = {
      cpu: 0,
      mem: 0,
      memUsed: 0,
      memTotal: this.totalMem,
      cores: os.cpus().length,
      platform: `${os.platform()} ${os.arch()}`,
      release: os.release(),
      node: process.version,
      pid: process.pid,
      uptime: 0
    };
    this.agent = {
      id: "",
      cwd: "",
      title: "",
      provider: "",
      model: "",
      contextWindow: 0,
      pressure: 0,
      inTok: 0,
      outTok: 0,
      cacheTok: 0,
      turns: 0,
      steps: 0,
      calls: 0,
      errors: 0,
      models: [],
      tps: 0,
      latency: 0,
      cadence: 0,
      live: false,
      lastAt: 0,
      lastKind: "",
      source: this.mode
    };
  }

  start() {
    this.sampleHost();
    if (this.mode === "file") {
      this.pump();
      this.pumpProcs();
      this.timers.push(setInterval(() => {
        this.pump();
        this.pumpProcs();
      }, 1200));
    }
    this.timers.push(setInterval(() => this.sampleHost(), 500));
    return this;
  }

  stop() {
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
    this.removeAllListeners();
  }

  sampleHost() {
    const now = cpuTotals();
    const busy = Number(now.busy - this.cpuPrev.busy);
    const total = Number(now.total - this.cpuPrev.total);
    this.cpuPrev = now;
    const raw = total > 0 ? (busy / total) * 100 : 0;
    this.cpuSmooth = this.cpuSmooth === 0 ? raw : this.cpuSmooth * 0.6 + raw * 0.4;
    const memPct = ((this.totalMem - os.freemem() / 1048576) / this.totalMem) * 100;
    this.memSmooth = this.memSmooth === 0 ? memPct : this.memSmooth * 0.6 + memPct * 0.4;
    this.host.cpu = Math.round(this.cpuSmooth * 10) / 10;
    this.host.mem = Math.round(this.memSmooth * 10) / 10;
    this.host.memUsed = Math.round(this.totalMem - os.freemem() / 1048576);
    this.host.uptime = Math.round(process.uptime());
    this.push(this.series.cpu, this.host.cpu);
    this.push(this.series.mem, this.host.mem);
    const edge = Date.now() - 5000;
    this.usage = this.usage.filter((s) => s.t > edge);
    this.agent.tps = Math.round((this.usage.reduce((sum, s) => sum + s.n, 0) / 5) * 10) / 10;
    this.agent.live = Date.now() - this.agent.lastAt < LIVE_MS;
  }

  push(list, value) {
    list.push(Math.round(value * 10) / 10);
    if (list.length > MAX_SERIES) list.splice(0, list.length - MAX_SERIES);
  }

  pumpProcs() {
    if (this.procBusy || process.platform !== "win32") return;
    this.procBusy = true;
    execFile("tasklist", ["/nh", "/fo", "csv"], { windowsHide: true, maxBuffer: 8 * 1048576 }, (error, stdout) => {
      this.procBusy = false;
      if (error) return;
      const rows = parseTasklist(stdout);
      rows.sort((a, b) => b.mb - a.mb);
      this.procs = { count: rows.length, top: rows.slice(0, 5), at: Date.now() };
    });
  }

  async newestSession() {
    let best = null;
    const projects = await fsp.readdir(this.root, { withFileTypes: true }).catch(() => []);
    for (const project of projects) {
      if (!project.isDirectory()) continue;
      const projectDir = path.join(this.root, project.name);
      const sessions = await fsp.readdir(projectDir, { withFileTypes: true }).catch(() => []);
      for (const session of sessions) {
        if (!session.isDirectory()) continue;
        const file = path.join(projectDir, session.name, "session.v4.jsonl.zstd");
        const stat = await fsp.stat(file).catch(() => null);
        if (stat === null) continue;
        if (best === null || stat.mtimeMs > best.mtime) best = { file, mtime: stat.mtimeMs, size: stat.size };
      }
    }
    return best;
  }

  async readAt(file, start, length) {
    const buf = Buffer.allocUnsafe(length);
    const handle = await fsp.open(file, "r");
    try {
      await handle.read(buf, 0, length, start);
    } finally {
      await handle.close();
    }
    return buf;
  }

  async feed(text, chunk) {
    const lines = text.split("\n");
    const sid = this.sid;
    if (sid === null) return;
    for (let i = 0; i < lines.length; i += chunk) {
      const end = Math.min(lines.length, i + chunk);
      for (let k = i; k < end; k += 1) {
        const line = lines[k];
        if (line === "" || line.charCodeAt(0) !== 123) continue;
        let event;
        try {
          event = JSON.parse(line);
        } catch {
          continue;
        }
        this.ingest(sid, event);
      }
      if (end < lines.length) await new Promise((done) => setImmediate(done));
    }
  }

  reset(sid) {
    this.seen.clear();
    this.events.length = 0;
    this.text.length = 0;
    this.toolStats.clear();
    this.pendingCalls.clear();
    this.nodeCount.clear();
    this.edges.clear();
    this.lastTool = null;
    this.turns.length = 0;
    this.stepStart.clear();
    this.usage.length = 0;
    this.errors = 0;
    this.calls = 0;
    this.series.tok.length = 0;
    this.series.call.length = 0;
    this.series.step.length = 0;
    this.series.lat.length = 0;
    this.series.lat.length = 0;
    this.agent.id = sid ?? "";
    this.agent.title = "";
    this.agent.provider = "";
    this.agent.model = "";
    this.agent.contextWindow = 0;
    this.agent.pressure = 0;
    this.agent.inTok = 0;
    this.agent.outTok = 0;
    this.agent.cacheTok = 0;
    this.agent.turns = 0;
    this.agent.steps = 0;
    this.agent.calls = 0;
    this.agent.errors = 0;
    this.agent.latency = 0;
    this.agent.lastAt = 0;
    this.agent.models.length = 0;
  }

  async hydrate(file, size) {
    this.cursor = size;
    if (size <= 0 || size > MAX_FILE_BYTES) return;
    let text = "";
    if (size <= FULL_DECODE_BYTES) {
      const buf = await this.readAt(file, 0, size);
      try {
        text = zlib.zstdDecompressSync(buf).toString("utf8");
      } catch {
        text = decodeTail(buf);
      }
    } else {
      const head = await this.readAt(file, 0, HEAD_BYTES);
      const offsets = frameOffsets(head);
      const cut = offsets.length > HEAD_FRAMES ? offsets[Math.min(HEAD_FRAMES, offsets.length - 1)] : head.length;
      try {
        text = zlib.zstdDecompressSync(head.subarray(0, cut)).toString("utf8");
      } catch {
        text = "";
      }
      const tailStart = Math.max(0, size - WINDOW_BYTES);
      const tail = await this.readAt(file, tailStart, size - tailStart);
      text += "\n" + decodeTail(tail);
    }
    if (text === "") return;
    this.reset(this.sid);
    this.bulk = true;
    try {
      await this.feed(text, 2500);
    } finally {
      this.bulk = false;
    }
  }

  async pump() {
    if (this.pumping) return;
    this.pumping = true;
    try {
      const newest = await this.newestSession();
      if (newest === null) return;
      const sid = path.basename(path.dirname(newest.file));
      if (this.file !== newest.file) {
        this.file = newest.file;
        this.sid = sid;
        this.cursor = 0;
        this.clock = 0;
        await this.hydrate(newest.file, newest.size);
        return;
      }
      if (newest.size < this.cursor) this.cursor = 0;
      if (newest.size === this.cursor) return;
      const buf = await this.readAt(newest.file, this.cursor, newest.size - this.cursor);
      let offset = 0;
      if (buf.length < 4 || buf.readUInt32LE(0) !== MAGIC_U32) {
        const at = buf.indexOf(MAGIC, 0, Math.min(buf.length, 1 << 20));
        if (at === -1) {
          if (buf.length > 1 << 20) this.cursor = newest.size;
          return;
        }
        offset = at;
      }
      let text = "";
      try {
        text = zlib.zstdDecompressSync(buf.subarray(offset)).toString("utf8");
      } catch {
        return;
      }
      this.cursor = newest.size;
      this.clock = 0;
      if (text !== "") await this.feed(text, 4000);
    } catch {
      this.file = null;
    } finally {
      this.pumping = false;
    }
  }

  markSeen(key) {
    if (this.seen.has(key)) return true;
    this.seen.set(key, 1);
    if (this.seen.size > SEEN_LIMIT) {
      let drop = SEEN_LIMIT >> 1;
      for (const k of this.seen.keys()) {
        this.seen.delete(k);
        if (--drop <= 0) break;
      }
    }
    return false;
  }

  log(kind, text, name) {
    const entry = { t: this.clock > 0 ? this.clock : Date.now(), k: kind, n: name ?? "", d: flat(text, 108) };
    this.events.push(entry);
    if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS);
    this.agent.lastKind = kind;
    if (entry.t > this.agent.lastAt) this.agent.lastAt = entry.t;
    if (kind === "err") this.errors += 1;
    return entry;
  }

  turnRow(turn, time) {
    const n = Number(turn ?? 0);
    let row = this.turns.find((r) => r.n === n);
    if (row === undefined) {
      row = { n, at: time, ms: 0, steps: 0, calls: 0, tok: 0, err: 0, ok: -1 };
      this.turns.push(row);
      if (this.turns.length > 64) this.turns.shift();
    }
    if (this.agent.turns < n) this.agent.turns = n;
    return row;
  }

  ingest(sessionId, event) {
    if (!event || typeof event.type !== "string") return;
    const key = `${sessionId}:${event.seq ?? event.type + ":" + (event.time ?? 0)}`;
    if (event.seq !== undefined && this.markSeen(key)) return;
    const data = event.data ?? {};
    const time = Number(event.time ?? Date.now());
    this.clock = time;
    if (data.turn !== undefined && event.type !== "turn/start") this.turnRow(data.turn, time);
    switch (event.type) {
      case "session": {
        this.agent.id = String(data.id ?? sessionId);
        this.agent.cwd = String(data.cwd ?? "");
        this.log("sys", `session ${this.agent.cwd || this.agent.id}`);
        break;
      }
      case "session/title": {
        this.agent.title = String(data.title ?? "");
        this.log("sys", `title ${this.agent.title}`);
        break;
      }
      case "request/context": {
        this.agent.provider = String(data.provider ?? "");
        this.agent.model = String(data.model ?? "");
        this.agent.contextWindow = Number(data.contextWindow ?? 0);
        if (this.agent.model && !this.agent.models.some((x) => x.m === this.agent.model && x.p === this.agent.provider)) this.agent.models.push({ m: this.agent.model, p: this.agent.provider, at: time });
        if (this.agent.models.length > 24) this.agent.models.shift();
        this.log("model", `route ${this.agent.provider}/${this.agent.model} ctx ${this.agent.contextWindow}`);
        break;
      }
      case "turn/start": {
        const row = this.turnRow(data.turn, time);
        row.at = time;
        row.ok = -1;
        this.log("turn", `turn ${row.n} start`);
        break;
      }
      case "turn/end": {
        const row = this.turns.find((r) => r.n === Number(data.turn));
        const reason = String(data.reason?.kind ?? "");
        if (row) {
          row.ms = time - row.at;
          row.ok = reason === "completed" ? 1 : 0;
        }
        this.log(row !== undefined && row.ok === 0 ? "err" : "turn", `turn ${data.turn} ${reason}`);
        break;
      }
      case "step/start": {
        this.agent.steps += 1;
        this.stepStart.set(`${data.turn}:${data.step}`, time);
        this.turnRow(data.turn, time).steps += 1;
        if (this.lastStepAt > 0 && time > this.lastStepAt) this.push(this.series.step, time - this.lastStepAt);
        this.lastStepAt = time;
        this.agent.cadence = this.series.step.length === 0 ? 0 : this.series.step[this.series.step.length - 1];
        break;
      }
      case "step/end": {
        break;
      }
      case "tool/call": {
        this.calls += 1;
        this.agent.calls = this.calls;
        const name = String(data.name ?? "tool");
        const callId = String(data.callId ?? "");
        const args = String(data.arguments ?? "");
        this.pendingCalls.set(callId || `${name}:${time}`, { name, at: time, args });
        const stat = this.toolStats.get(name) ?? { n: name, calls: 0, ok: 0, bad: 0, lat: [], bytes: 0, at: 0, args: "" };
        stat.calls += 1;
        stat.at = time;
        stat.args = flat(args, 160);
        this.toolStats.set(name, stat);
        this.nodeCount.set(name, (this.nodeCount.get(name) ?? 0) + 1);
        if (this.lastTool !== null && this.lastTool !== name) {
          const edge = `${this.lastTool}|${name}`;
          this.edges.set(edge, (this.edges.get(edge) ?? 0) + 1);
        }
        this.lastTool = name;
        this.turnRow(data.turn, time).calls += 1;
        this.text.push({ t: time, k: "call", n: name, s: flat(args, 220) });
        this.log("tool", `\u25b8 ${name} ${flat(args, 84)}`, name);
        break;
      }
      case "tool/result": {
        const message = data.message ?? {};
        const callId = String(message.toolCallId ?? data.callId ?? "");
        const pending = this.pendingCalls.get(callId);
        if (pending) this.pendingCalls.delete(callId);
        const name = pending?.name ?? this.lastTool ?? "tool";
        const exitCode = Number(message.meta?.opsShell?.exitCode ?? 0);
        const failed = Boolean(message.isError) || exitCode !== 0;
        const output = bodyText(message);
        const stat = this.toolStats.get(name);
        if (stat) {
          const spent = pending ? time - pending.at : 0;
          const ms = Math.max(0, Math.min(spent, 600000));
          stat.lat.push(ms);
          if (stat.lat.length > 48) stat.lat.shift();
          stat.bytes += output.length;
          if (failed) stat.bad += 1;
          else stat.ok += 1;
          this.push(this.series.lat, ms);
        }
        if (failed) this.turnRow(data.turn, time).err += 1;
        this.text.push({ t: time, k: failed ? "err" : "out", n: name, s: flat(output, 240) || `exit ${exitCode}` });
        this.log(failed ? "err" : "done", `${failed ? "\u00d7" : "\u2713"} ${name} ${output.length}b ${pending ? Math.round(time - pending.at) + "ms" : ""}`.trim(), name);
        break;
      }
      case "assistant/message": {
        const usage = data.usage ?? {};
        const out = Number(usage.outputTokens ?? 0);
        const input = Number(usage.inputTokens ?? 0);
        const cache = Number(usage.cacheReadTokens ?? 0);
        this.agent.outTok += out;
        this.agent.inTok = input;
        this.agent.cacheTok = cache;
        if (this.agent.contextWindow > 0) this.agent.pressure = Math.min(1, input / this.agent.contextWindow);
        this.usage.push({ t: time, n: out });
        this.turnRow(data.turn, time).tok += out;
        const startAt = this.stepStart.get(`${data.turn}:${data.step}`);
        if (startAt !== undefined) this.agent.latency = time - startAt;
        this.push(this.series.tok, out);
        this.log("model", `gen ${out} tok in ${input} cache ${cache}`);
        break;
      }
      case "user/message": {
        this.log("user", `user ${flat(bodyText(data), 88)}`);
        break;
      }
      case "system/message": {
        this.log("sys", `system ${flat(bodyText(data.message ?? data), 72)}`);
        break;
      }
      case "llm/retry": {
        this.log("err", `retry ${data.retry ?? "?"} ${flat(JSON.stringify(data.failure ?? {}), 60)}`);
        break;
      }
      case "assistant/attempt": {
        this.log("model", `attempt ${data.turn ?? "?"}.${data.step ?? "?"}`);
        break;
      }
      default:
        break;
    }
    this.clock = 0;
  }

  ingestExternal(payload) {
    if (!payload || typeof payload !== "object") return false;
    const kind = String(payload.kind ?? payload.type ?? "ext");
    const name = payload.name === undefined ? "" : String(payload.name);
    const text = payload.text ?? payload.data ?? payload.message ?? "";
    this.log(kind === "tool" ? "tool" : kind === "error" ? "err" : "ext", typeof text === "string" ? text : JSON.stringify(text), name);
    if (name) this.nodeCount.set(name, (this.nodeCount.get(name) ?? 0) + 1);
    if (typeof payload.tokens === "number") this.usage.push({ t: Date.now(), n: payload.tokens });
    return true;
  }

  snapshot() {
    const nodes = [];
    for (const [name, count] of this.nodeCount) nodes.push({ n: name, v: count });
    nodes.sort((a, b) => b.v - a.v);
    const top = nodes.slice(0, 16);
    const keep = new Set(top.map((x) => x.n));
    const edges = [];
    for (const [key, weight] of this.edges) {
      const [a, b] = key.split("|");
      if (keep.has(a) && keep.has(b)) edges.push({ a, b, w: weight });
    }
    const tools = [];
    for (const stat of this.toolStats.values()) {
      tools.push({
        n: stat.n,
        calls: stat.calls,
        ok: stat.ok,
        bad: stat.bad,
        bytes: stat.bytes,
        p50: Math.round(quantile(stat.lat, 0.5)),
        p95: Math.round(quantile(stat.lat, 0.95)),
        at: stat.at,
        args: stat.args
      });
    }
    tools.sort((a, b) => b.calls - a.calls);
    const recentCalls = this.events.filter((e) => e.k === "tool" && e.t > Date.now() - 5000).length;
    this.push(this.series.call, recentCalls);
    return {
      t: Date.now(),
      node: { version: process.version, pid: process.pid, started: this.startedAt, mode: this.mode },
      host: { ...this.host, procs: this.procs.count, top: this.procs.top },
      agent: {
        ...this.agent,
        models: this.agent.models.slice(-6),
        errors: this.errors,
        toolCount: this.toolStats.size,
        errorRate: this.calls === 0 ? 0 : Math.round((this.errors / this.calls) * 1000) / 10
      },
      events: this.events.slice(-110),
      text: this.text.slice(-MAX_TEXT),
      tools: tools.slice(0, 14),
      graph: { nodes: top, edges },
      series: {
        tok: this.series.tok.slice(-96),
        cpu: this.series.cpu.slice(-96),
        mem: this.series.mem.slice(-96),
        call: this.series.call.slice(-96),
        lat: this.series.lat.slice(-96),
        step: this.series.step.slice(-96)
      },
      turns: this.turns.slice(-22)
    };
  }
}

export function listSessions(root) {
  const base = root ?? process.env.DSH_SESSION_ROOT ?? path.join(os.homedir(), ".dsh", "sessions");
  const rows = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === "session.v4.jsonl.zstd") {
        const stat = fs.statSync(full);
        rows.push({ id: path.basename(path.dirname(full)), project: path.basename(dir), bytes: stat.size, mtime: stat.mtimeMs });
      }
    }
  };
  walk(base);
  rows.sort((a, b) => b.mtime - a.mtime);
  return rows;
}
