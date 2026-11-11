import http from "node:http";
import { SnapshotStore } from "./plugin/core.mjs";
import { createHandler } from "./plugin/server.mjs";

const store = new SnapshotStore({ mode: "file" }).start();
const rt = createHandler(store, { prefix: "/eventhorizon" });
const server = http.createServer((req, res) => rt.handler(req, res));
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}/eventhorizon`;

const get = async (p, init) => {
  const res = await fetch(base + p, init);
  return { status: res.status, type: res.headers.get("content-type"), body: await res.text() };
};

const fail = [];
const check = (name, ok, detail) => {
  if (!ok) fail.push(name + " " + detail);
  console.log((ok ? "PASS " : "FAIL ") + name + "  " + detail);
};

const html = await get("/");
check("GET /", html.status === 200 && html.body.includes("eventhorizon.js"), html.status + " " + html.type + " " + html.body.length + "b");

const css = await get("/eventhorizon.css");
check("GET /eventhorizon.css", css.status === 200 && css.body.length > 1000, css.status + " " + css.body.length + "b");

const js = await get("/eventhorizon.js");
check("GET /eventhorizon.js", js.status === 200 && js.body.length > 10000, js.status + " " + js.body.length + "b");

const missing = await get("/nope.js");
check("GET /nope.js", missing.status === 404, String(missing.status));

const state = JSON.parse((await get("/state.json")).body);
check("GET /state.json", typeof state.t === "number" && typeof state.host === "object", "cpu " + state.host.cpu + " mem " + state.host.mem + " procs " + state.host.procs + " events " + state.events.length + " tools " + state.tools.length + " nodes " + state.graph.nodes.length);

const post = await get("/ingest", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify([{ kind: "tool", name: "unit_probe", text: "selftest ping" }, { kind: "error", text: "selftest fail sample" }])
});
check("POST /ingest", post.status === 200 && JSON.parse(post.body).accepted === 2, post.body);

const after = JSON.parse((await get("/state.json")).body);
check("ingest visible in snapshot", after.events.length >= 2, "events " + after.events.length);

const stream = await new Promise((resolve) => {
  const req = http.get(base + "/stream", (res) => {
    let buf = "";
    let frames = 0;
    res.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      frames = (buf.match(/\ndata: /g) || []).length;
      if (frames >= 2) {
        req.destroy();
        resolve({ status: res.statusCode, type: res.headers["content-type"], frames, bytes: buf.length });
      }
    });
  });
  req.on("error", () => resolve({ status: 0, frames: 0, bytes: 0 }));
  setTimeout(() => {
    req.destroy();
    resolve({ status: 0, frames: 0, bytes: 0 });
  }, 4000);
});
check("GET /stream", stream.status === 200 && stream.frames >= 2, JSON.stringify(stream));

rt.close();
store.stop();
server.close();

if (fail.length > 0) {
  console.log("\n" + fail.length + " failing");
  process.exit(1);
}
console.log("\nall pass");
process.exit(0);
