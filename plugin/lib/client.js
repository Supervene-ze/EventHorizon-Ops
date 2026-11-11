(() => {
  if (typeof window === "undefined" || !window.__ModuleLoader__) return;
  const loader = window.__ModuleLoader__;
  const ID = "agent-hud";
  const HOST_SRC = "/agent-hud/";
  const LOCAL_SRC = "http://127.0.0.1:7788/";

  const probe = async () => {
    const ctl = typeof AbortController === "function" ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), 700) : null;
    try {
      const res = await fetch(LOCAL_SRC + "state.json?t=" + Date.now(), {
        cache: "no-store",
        signal: ctl ? ctl.signal : undefined
      });
      if (!res.ok) return HOST_SRC;
      const body = await res.json();
      return body && body.t ? LOCAL_SRC : HOST_SRC;
    } catch {
      return HOST_SRC;
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  const factory = (require) => {
    const React = require("react");
    const h = React.createElement;

    const Frame = ({ sessionId }) => {
      const [src, setSrc] = React.useState(null);
      const [ready, setReady] = React.useState(false);

      React.useEffect(() => {
        let alive = true;
        setReady(false);
        probe().then((base) => {
          if (!alive) return;
          setSrc(base + "?s=" + encodeURIComponent(sessionId ?? "") + "&v=" + Date.now());
        });
        return () => {
          alive = false;
        };
      }, [sessionId]);

      const overlay = ready
        ? null
        : h(
            "div",
            {
              style: {
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                font: "12px ui-monospace, Consolas, monospace",
                color: "#8b74c9",
                background: "#05030c",
                letterSpacing: "0.08em"
              }
            },
            "EVENT HORIZON OPS"
          );

      return h(
        "div",
        { style: { position: "relative", width: "100%", height: "100%", minHeight: 0, overflow: "hidden" } },
        src === null
          ? null
          : h("iframe", {
              src,
              title: "EVENT HORIZON OPS",
              style: {
                width: "100%",
                height: "100%",
                border: "0",
                display: "block",
                background: "#05030c",
                colorScheme: "dark"
              },
              allow: "clipboard-read; clipboard-write",
              onLoad: () => setReady(true)
            }),
        overlay
      );
    };

    const inject = ["slots"];

    const apply = (ctx) => {
      ctx.slots.inject("conversation.view", () =>
        ctx.slots.register(
          { name: "conversation.view", id: ID, order: 60, label: () => "HUD" },
          Frame
        )
      );
      ctx.slots.inject("conversation.session.header.views.actions", () =>
        ctx.slots.register({ name: "conversation.session.header.views.actions", id: ID + "-open", order: 60 }, ({ openView }) =>
          h(
            "button",
            {
              type: "button",
              title: "EVENT HORIZON OPS",
              onClick: () => {
                if (typeof openView === "function") openView(ID);
              },
              style: {
                padding: "2px 8px",
                border: "1px solid rgba(150,108,255,0.35)",
                borderRadius: 3,
                background: "rgba(160,107,255,0.08)",
                color: "#c9b6ff",
                font: "11px ui-monospace, Consolas, monospace",
                cursor: "pointer",
                letterSpacing: "0.08em"
              }
            },
            "HUD"
          )
        )
      );
    };

    return { name: ID, inject, apply };
  };

  if (typeof loader.define === "function") loader.define(ID, factory);
  if (typeof loader.load === "function") loader.load({ id: ID, factory });
})();
