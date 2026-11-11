# EventHorizon-Ops

实时全息 HUD，把一次 AI Agent 会话的运行过程画成一张可读的作战图：环上的每张卡、面板里的每根柱子、顶部每个 KPI，全部取自真实落盘数据 —— 本机系统指标 + DSH 会话事件流（JSONL，按 zstd 多帧追加压缩）。没有合成数据集、没有假 KPI 跳数、没有打字机伪代码、没有 mock 代理网格、没有背景音乐。

![status](https://img.shields.io/badge/data-live-ff5fa2) ![runtime](https://img.shields.io/badge/runtime-node%20%3E%3D22.15-7ee7ff) ![license](https://img.shields.io/badge/license-PolyForm%20Noncommercial%201.0.0-8b74c9)

---

## 目录

- [它长什么样](#它长什么样)
- [数据从哪来](#数据从哪来)
- [快速开始](#快速开始)
- [两种运行方式](#两种运行方式)
- [视图操作](#视图操作)
- [HTTP 接口](#http-接口)
- [采集参数](#采集参数)
- [文件结构](#文件结构)
- [排错](#排错)
- [上传到 GitHub](#上传到-github)
- [许可](#许可)

---

## 它长什么样

界面分三层：

1. **顶部 KPI 条** —— 5 个计数，每个都带一条进度条，进度条是真实比值，不是装饰。
2. **主舞台** —— Canvas 2D 手绘的环形 HUD。圈内是工具调用关系网络（贝塞尔连线 + 沿边奔跑的亮线），圈上是数据卡，圈外是五层光带与粒子。整块可缩放、可平移。
3. **底部 8 个面板** —— 事件流、工具延迟、主机与进程、token 吞吐曲线、步间隔曲线、轮次台账、模型上下文、会话台账。

---

## 数据从哪来

### 主舞台

| 元素 | 真实来源 |
| --- | --- |
| 圈内贝塞尔网络节点 | `graph.nodes`（工具名 + 调用次数），节点数 = 实际出现过的工具数 |
| 网络连线与奔跑亮线密度 | `graph.edges[].w`（工具间调用转移次数），`log2(w) * 6` 决定该边上的 runner 数量 |
| 圈内补白曲线 | 端点全部落在 `graph.nodes` 的真实节点位置上，数量随边数增长（`220 + edges * 6`） |
| 环上卡片（TOOL / AGENT / HOST / SERIES / TURN / EVENT） | `tools[]`、`agent.*`、`host.*`、`series.*`、`turns[]`、`events[]` 逐条取值 |
| 卡片右侧竖排文字条 | 事件正文 `events[].d` 的字符码序列 |
| 节拍脉冲 / 彗星 / 环外光带 | `agent.steps`、`agent.calls` 的增量触发；没有增量就不跳动 |
| 环上刻度与 rim | 面板宽度、环半径按窗口尺寸实时计算 |

### 顶部 KPI

| KPI | 字段 |
| --- | --- |
| TURNS | `agent.turns` |
| STEPS | `agent.steps` |
| TOOL CALLS | `agent.calls` |
| OUT TOKENS | `agent.outTok` |
| CACHE HIT | `cacheTok / (cacheTok + inTok)` |

### 左上浮动检查点（8 项循环）

`agent.pressure`、`agent.errorRate`、工具 p95 延迟、步间间隔、`host.cpu`、`host.memUsed / memTotal`、`agent.cacheTok`、`agent.outTok`。

### 底部 8 面板

| 面板 | 字段 |
| --- | --- |
| EVENT FEED | `events[]`（tool / done / model / user / sys / err / turn）+ `text[]`（工具原始输出），右上角是近 60 秒事件速率 |
| TOOL LATENCY / CALLS | `tools[].n / calls / bad / p95`；p95 异常时用事件流重算 |
| HOST / PROCESSES | `host.cpu / mem / memUsed / memTotal / procs` + `host.top[]` 前 3 个进程（`tasklist` 实测内存） |
| TOKEN THROUGHPUT | `series.tok`（每步输出 token）与 `series.call` |
| STEP CADENCE | `series.step`（步间隔毫秒）与 `series.lat`；上游缺该序列时分别回退到事件时间戳推导的步间隔、tool→done 配对耗时 |
| TURN LEDGER | `turns[].n / at / steps / calls / tok / err` |
| MODEL / CONTEXT | `node.version / mode`、`agent.provider / model / contextWindow / inTok / outTok / cacheTok / errors`、事件推导的 gen token 与跨度 |
| SESSION LEDGER | `/sessions.json` 返回的磁盘会话文件（id / mtime / 字节数） |

### 缺数时怎么办

上游上报的 600000ms 一类占位值会被过滤掉，工具延迟、步间隔、gen token 改由事件时间戳推导；推导不出来就留空，不编数字。

---

## 快速开始

需要 Node.js ≥ 22.15。没有任何第三方依赖，不用 `npm install`。

```bash
git clone https://github.com/你的账号/eventhorizon-ops.git
cd eventhorizon-ops
node plugin/server.mjs 7788
```

浏览器打开 `http://127.0.0.1:7788/`。

Windows 上也可以直接双击仓库根目录的 `start-hud.cmd`：它会先杀掉占用 7788 的旧进程，再后台起服务并打开页面。

---

## 两种运行方式

### 方式一：独立进程（最简单，推荐先跑这个）

```bash
node plugin/server.mjs 7788
```

换端口就改数字，或用环境变量：

```bash
set AGENT_HUD_PORT=8899   # Windows
export AGENT_HUD_PORT=8899 # macOS / Linux
node plugin/server.mjs
```

页面会自行探测 `http://127.0.0.1:7788/`；探测不到时回落到同源 `/agent-hud/`，两种部署都能用。

### 方式二：作为 DSH 插件（被宿主托管，随宿主启动）

前提：本机装了 DeepSeek Harness。

1. 把 `plugin/` 目录挂进 profile 的 `node_modules`（Windows 用 junction，中文长路径下 `mklink /J` 会失败，用 PowerShell）：

   ```powershell
   New-Item -ItemType Junction `
     -Path "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\agent-hud" `
     -Target "D:\path\to\eventhorizon-ops\plugin"
   ```

2. 在 `%USERPROFILE%\.dsh\profiles\desktop\cordis.patch.yml` 的 insert 段加入：

   ```yaml
   - id: agent-hud
     name: 'agent-hud'
   ```

3. 重启宿主。启动后宿主日志里会出现 `agent-hud runtime file <pid> rev <stamp>`。

宿主路由挂在 `http://127.0.0.1:50824/agent-hud/` 下；会话视图里会多出一个 `HUD` 标签页，点开就是同一张图。

> 插件入口 `plugin/index.js` 用 `mtime + size` 拼成 rev 动态 `import`，所以改了 `core.mjs` / `server.mjs` 之后 `POST /agent-hud/reload` 就能换新采集层，不必重启宿主。`hud/` 下的静态文件本来每次请求都读盘，改完刷新页面即可。

---

## 视图操作

| 操作 | 结果 |
| --- | --- |
| 滚轮 | 以指针位置为锚缩放主舞台（0.45× ~ 3.2×） |
| 按住拖拽 | 平移主舞台 |
| `+` / `-` | 缩放 1.18 倍 |
| `0` | 复位视图 |
| `F` 或双击 | 全屏 |
| 右下 `−` `+` `FIT` | 缩小 / 放大 / 复位按钮 |
| 右下 `A−` `A+` | 界面文字整体缩放（记住在本机 localStorage） |

环上卡片按当前缩放级别与 DPR 重绘位图，放大后是真矢量重绘，不是把一张小图拉大；卡片里的文字按可用宽度二分截断并补 `…`，不会出现半个字，行也不会越出卡片底边。

---

## HTTP 接口

独立进程模式下路径是 `/state.json`；插件模式下前面加 `/agent-hud`。

| 路由 | 说明 |
| --- | --- |
| `GET /` | HUD 页面 |
| `GET /state.json` | 当前快照（完整 JSON） |
| `GET /stream` | SSE，700ms 一帧，15s 一次心跳注释 |
| `GET /sessions.json` | 磁盘上的会话文件列表 |
| `POST /ingest` | 外部事件注入，body 是单条或数组，返回 `{accepted:n}` |

`/ingest` 的一条事件长这样，用来把别的程序也画进这张图：

```bash
curl -X POST http://127.0.0.1:7788/ingest \
  -H "content-type: application/json" \
  -d '{"k":"tool","n":"my_job","d":"scan finished in 1.2s"}'
```

---

## 采集参数

全部在 `plugin/core.mjs` 顶部，改完 `POST /reload` 生效。

| 常量 | 值 | 含义 |
| --- | --- | --- |
| `WINDOW_BYTES` | 2400000 | 会话文件尾部切片字节数 |
| `WINDOW_FRAMES` | 110 | 尾部回溯的 zstd frame 数 |
| `FULL_DECODE_BYTES` | 9437184 | 小于该值整文件解压 |
| `HEAD_FRAMES` | 64 | 大文件时补解头部 frame 数（取 provider / model / contextWindow） |
| `MAX_EVENTS` | 320 | 事件环形缓冲 |
| `MAX_SERIES` | 96 | 各序列保留点数 |
| `MAX_TEXT` | 40 | 工具输出文本缓冲 |
| `LIVE_MS` | 30000 | 判定 LIVE 的空闲阈值 |

会话文件是 zstd 多帧追加格式。采集端先扫 `28 B5 2F FD` 定位 frame 边界，再增量解码 `cursor` 之后的新字节，不重复解析历史。

---

## 文件结构

```
plugin/core.mjs           采集层：会话事件流 + 系统指标 -> 快照
plugin/server.mjs         HTTP / SSE 服务，静态资源，/ingest
plugin/index.js           宿主插件入口，注册 /agent-hud 路由与热重载
plugin/lib/client.js      客户端插槽：会话视图 HUD 标签
plugin/hud/eventhorizon.html   页面骨架
plugin/hud/eventhorizon.css    界面样式（--uiz 界面缩放变量）
plugin/hud/eventhorizon.js     渲染引擎 + 真实数据绑定
plugin/hud/hud.html       兼容跳转壳，指向 eventhorizon.html
plugin/package.json       插件清单
package.json              仓库清单
selftest.mjs              无依赖自检：跑一遍路由与 SSE
start-hud.cmd             Windows 一键启动
LICENSE                   PolyForm Noncommercial 1.0.0 全文
NOTICE.md                 版权与数据真实性声明
.gitignore                排除本地快照、日志、node_modules
```

---

## 排错

**页面一直显示 `0 / 0 EVENTS · IDLE`**
采集层没读到会话文件。检查 `GET /state.json` 里 `node.mode` 是否为 `file`、`agent.id` 是否为空。`agent.source` 为 `file` 表示走的是磁盘解析；宿主内的会话可能需要先产生一条事件。

**数字全 0 但事件流在动**
多半是上游只给了占位值（如 600000ms）。看 `series.step` / `series.lat` 是否为空数组 —— 空说明没拿到可用样本，这是数据缺失，不是前端 bug。

**改了 `core.mjs` 没反应**
插件模式下 `POST /agent-hud/reload`；独立进程模式下重启 node。

**改了页面没反应**
`hud/` 下的文件每次请求都重新读盘，正常刷新即可。如果还不行，看浏览器控制台 —— 页面右下的状态行会把脚本错误直接打出来。

**端口被占**
`start-hud.cmd` 会自动杀掉占用 7788 的进程；手动的话 `netstat -ano | findstr :7788` 找到 PID 再 `taskkill /F /PID`。

---

## 上传到 GitHub

这个目录本身就是仓库根，已经 `git init` 并完成第一个提交（`EventHorizon-Ops 1.0.0`，17 个文件，分支 `main`）。只差接上你自己的远程地址：

```bash
cd D:\\EventHorizon-Ops
git remote add origin https://github.com/你的账号/eventhorizon-ops.git
git push -u origin main
```

还没建远程仓库就先在 GitHub 网页建一个空仓库（名字随意，比如 `eventhorizon-ops`），再跑上面两条。

想要一份全新的提交历史，删掉 `.git` 重来：

```bash
cd D:\\EventHorizon-Ops
rm -rf .git
git init
git add .
git commit -m "EventHorizon-Ops 1.0.0"
git branch -M main
git remote add origin https://github.com/你的账号/eventhorizon-ops.git
git push -u origin main
```

在 GitHub 网页建仓库时**不要**勾选 "Add a README / .gitignore / license"，否则会跟本地文件冲突，推送被拒。仓库建好后如果要改远程地址：`git remote set-url origin <新地址>`。

`.gitignore` 已经排掉本地快照、探测脚本、日志和 `node_modules/`，`git add .` 不会带上它们。`git status` 里应该只有这些：

```
.gitignore  LICENSE  NOTICE.md  README.md  package.json  selftest.mjs  start-hud.cmd
plugin/index.js  plugin/core.mjs  plugin/server.mjs  plugin/package.json  plugin/lib/client.js
plugin/hud/eventhorizon.html  plugin/hud/eventhorizon.css  plugin/hud/eventhorizon.js
plugin/hud/hud.html
```

提交前想自检一遍，跑 `node selftest.mjs`：它会在随机端口起一个临时实例，逐个断言 `/`、CSS、JS、404、`/state.json` 字段、`POST /ingest` 接受 2 条、注入后事件可见、`/stream` 至少两帧，任何一项失败都以退出码 1 结束。

---

## 许可

PolyForm Noncommercial License 1.0.0，仅限非商业使用。全文见 `LICENSE`，转载与二创须保留 `NOTICE.md` 里的声明并注明出处。
