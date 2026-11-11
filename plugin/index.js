import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const name = "agent-hud";
export const inject = ["webServer"];

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROUTE = "/agent-hud";

export function apply(ctx) {
  let store = null;
  let runtime = null;
  let generation = 0;
  let booting = null;
  let disposed = false;

  const stamp = async () => {
    const stats = await Promise.all(["core.mjs", "server.mjs"].map((f) => fsp.stat(path.join(HERE, f))));
    return stats.map((s) => `${s.mtimeMs}.${s.size}`).join("-");
  };

  const close = () => {
    if (runtime !== null) {
      runtime.close();
      runtime = null;
    }
    if (store !== null) {
      store.stop();
      store = null;
    }
  };

  const boot = async () => {
    const gen = ++generation;
    const rev = await stamp();
    const core = await import(new URL(`./core.mjs?rev=${rev}`, import.meta.url).href);
    const server = await import(new URL(`./server.mjs?rev=${rev}`, import.meta.url).href);
    if (disposed || gen !== generation) return { reloaded: false, generation: gen, active: generation - 1 };
    const nextStore = new core.SnapshotStore({ mode: process.env.AGENT_HUD_MODE ?? "file" }).start();
    const nextRuntime = server.createHandler(nextStore, { prefix: ROUTE });
    close();
    store = nextStore;
    runtime = nextRuntime;
    ctx.logger?.info?.(`agent-hud runtime ${store.mode} ${process.pid} rev ${rev}`);
    return { reloaded: true, generation: gen, rev };
  };

  const ready = boot().catch((err) => {
    ctx.logger?.warn?.(`agent-hud boot failed: ${err?.message ?? err}`);
    return { reloaded: false, error: String(err?.message ?? err) };
  });

  ctx.effect(() => () => {
    disposed = true;
    close();
  }, "agent-hud: store");

  ctx.inject(["webServer"], (webCtx) => {
    const handler = (req, res) => {
      const url = req.url ?? "/";
      const at = url.indexOf("?");
      const pathname = at === -1 ? url : url.slice(0, at);
      if (pathname === ROUTE) {
        res.writeHead(302, { location: ROUTE + "/" + (at === -1 ? "" : url.slice(at)), "cache-control": "no-store" });
        res.end();
        return;
      }
      if (pathname === ROUTE + "/reload") {
        if (req.method !== "POST" && req.method !== "GET") {
          res.writeHead(405, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
          res.end("405");
          return;
        }
        if (booting !== null) {
          booting.then((result) => {
            const text = JSON.stringify(result);
            res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
            res.end(text);
          });
          return;
        }
        booting = boot()
          .catch((err) => ({ reloaded: false, error: String(err?.message ?? err) }))
          .then((result) => {
            booting = null;
            return result;
          });
        booting.then((result) => {
          const text = JSON.stringify(result);
          res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
          res.end(text);
        });
        return;
      }
      if (runtime === null) {
        res.writeHead(503, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
        res.end("agent-hud: starting");
        return;
      }
      runtime.handler(req, res);
    };
    webCtx.effect(
      () => webCtx.webServer.register({ kind: "prefix", path: ROUTE, handler }),
      "agent-hud: /agent-hud route"
    );
  });
}
