import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { SnapshotStore, listSessions } from "./core.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HUD_DIR = path.join(HERE, "hud");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2"
};

const SSE_MS = 700;

function json(res, body, status = 200) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(text)
  });
  res.end(text);
}

function readBody(req, limit = 1 << 20) {
  return new Promise((resolve) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        req.destroy();
        resolve("");
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", () => resolve(""));
  });
}

export function createHandler(store, options = {}) {
  const prefix = options.prefix ?? "";
  const clients = new Set();

  const broadcast = () => {
    if (clients.size === 0) return;
    let payload;
    try {
      payload = "data: " + JSON.stringify(store.snapshot()) + "\n\n";
    } catch {
      return;
    }
    for (const res of clients) res.write(payload);
  };

  const timer = setInterval(broadcast, SSE_MS);
  const unref = () => clearInterval(timer);

  const serveFile = async (res, file, status = 200) => {
    try {
      const body = await fsp.readFile(file);
      res.writeHead(status, {
        "content-type": MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream",
        "cache-control": "no-store",
        "content-length": body.length
      });
      res.end(body);
    } catch {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("404");
    }
  };

  const handler = async (req, res) => {
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-headers", "content-type");
    const target = new URL(req.url ?? "/", "http://x");
    let tail = target.pathname;
    if (prefix && tail.startsWith(prefix)) tail = tail.slice(prefix.length);
    if (tail === "" || tail === "/") {
      await serveFile(res, path.join(HUD_DIR, "eventhorizon.html"));
      return;
    }
    if (tail === "/state.json") {
      json(res, store.snapshot());
      return;
    }
    if (tail === "/sessions.json") {
      json(res, { sessions: listSessions(store.root).slice(0, 20) });
      return;
    }
    if (tail === "/stream") {
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-store",
        connection: "keep-alive",
        "x-accel-buffering": "no"
      });
      res.write(": open\n\n");
      res.write("retry: 2000\n\n");
      try {
        res.write("data: " + JSON.stringify(store.snapshot()) + "\n\n");
      } catch {
        res.end();
        return;
      }
      clients.add(res);
      const beat = setInterval(() => {
        res.write(": beat\n\n");
      }, 15000);
      const close = () => {
        clearInterval(beat);
        clients.delete(res);
      };
      req.on("close", close);
      req.on("error", close);
      return;
    }
    if (tail === "/ingest") {
      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }
      const raw = await readBody(req);
      let payload = null;
      try {
        payload = raw === "" ? null : JSON.parse(raw);
      } catch {
        payload = { kind: "ext", text: raw.slice(0, 400) };
      }
      const list = Array.isArray(payload) ? payload : payload ? [payload] : [];
      let accepted = 0;
      for (const item of list) if (store.ingestExternal(item)) accepted += 1;
      json(res, { accepted });
      return;
    }
    const safe = tail.replace(/^\/+/, "");
    if (safe.includes("..")) {
      res.writeHead(403);
      res.end();
      return;
    }
    await serveFile(res, path.join(HUD_DIR, safe));
  };

  return { handler, close: unref, clients };
}

export function start(port = 7788, host = "127.0.0.1", options = {}) {
  const store = new SnapshotStore({ mode: options.mode ?? "file" }).start();
  const { handler, close } = createHandler(store, { prefix: "" });
  const server = http.createServer((req, res) => {
    Promise.resolve(handler(req, res)).catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  server.listen(port, host, () => {
    const url = `http://${host}:${server.address().port}/`;
    process.stdout.write(`EventHorizon-Ops ${url}\n`);
  });
  const shutdown = () => {
    close();
    store.stop();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 800);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  return server;
}

const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const args = process.argv.slice(2);
  const portArg = args.find((a) => /^\d+$/.test(a));
  start(portArg ? Number(portArg) : Number(process.env.AGENT_HUD_PORT ?? 7788), process.env.AGENT_HUD_HOST ?? "127.0.0.1");
}
