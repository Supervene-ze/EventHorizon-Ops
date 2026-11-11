# EventHorizon-Ops 使用说明

这份文档只讲一件事：**拿到这个文件夹之后，怎么让它跑起来、怎么读屏幕上的东西**。技术细节和字段映射在 `README.md` 里，这里按操作顺序写。

---

## 一、它是什么

一张实时作战图，把一次 AI Agent 会话的运行过程画出来：花了多少轮、调了多少次工具、每次工具耗时多久、token 怎么涨、机器现在多忙。

所有数字都来自真实数据，只有两个来源：

1. **本机系统采样** —— CPU、内存、进程表（`tasklist` 实测内存占用）。
2. **DSH 会话事件流** —— 磁盘上的会话文件，JSONL 正文按 zstd 多帧追加压缩。

没有合成数据集，没有随机跳动的 KPI，没有打字机伪代码，没有假代理网格。上游没给的数，要么从事件时间戳推，要么留空——**不会编一个出来**。

---

## 二、跑起来

### 需要什么

- Node.js **22.15 或更高**（`node -v` 确认）。
- 不需要 `npm install`，整个项目零第三方依赖。

### 最快的一条路（独立进程）

Windows 双击仓库根目录的 `start-hud.cmd`，它会：杀掉占用 7788 端口的老进程 → 后台起服务 → 打开浏览器。

命令行等价写法：

```bash
node plugin/server.mjs 7788
```

然后打开 `http://127.0.0.1:7788/`。换端口就把 `7788` 改成别的数字，或者设环境变量：

```bash
set AGENT_HUD_PORT=8899        # Windows
export AGENT_HUD_PORT=8899     # macOS / Linux
node plugin/server.mjs
```

### 挂进 DSH 宿主（想让它跟着宿主一起启动时）

1. 把 `plugin/` 挂到 profile 的 `node_modules` 下。Windows 下中文长路径用 `mklink /J` 会失败，用 PowerShell：

   ```powershell
   New-Item -ItemType Junction `
     -Path "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\agent-hud" `
     -Target "D:\你的路径\eventhorizon-ops\plugin"
   ```

2. 在 `%USERPROFILE%\.dsh\profiles\desktop\cordis.patch.yml` 的 insert 段加：

   ```yaml
   - id: agent-hud
     name: 'agent-hud'
   ```

3. 重启宿主。之后地址是 `http://127.0.0.1:50824/agent-hud/`，会话视图里也会多一个 `HUD` 标签页。

> 目录名和插件 id 都保持 `agent-hud` 不要改——它跟 profile 里的 link 名字必须一致，改了宿主就加载不到。

---

## 三、屏幕上在读什么

### 顶部五格

| 格子 | 含义 |
| --- | --- |
| TURNS | 会话轮数，`agent.turns` |
| STEPS | 步数，`agent.steps` |
| TOOL CALLS | 工具调用次数，`agent.calls` |
| OUT TOKENS | 累计输出 token，`agent.outTok` |
| CACHE HIT | 缓存命中率，`cacheTok / (cacheTok + inTok)` |

每格下面那根细条是真实比值，不是装饰。

### 中间的大环

- **圈内网络**：每个节点是一个真实出现过的工具，节点大小＝调用次数；连线粗细＝两个工具之间的调用转移次数。沿边奔跑的亮线数量按 `log2(权重)×6` 算。
- **环上卡片**：六类，分别是工具、代理、主机、序列、轮次、事件。卡片里每一行都是一个字段值。
- **卡片右侧竖排条**：事件正文的字符码，竖着画出来。
- **环外光带与粒子**：只有 `agent.steps` / `agent.calls` 真的涨了才会跳——不动就是没进展。

### 底部八个面板

EVENT FEED（事件流）、TOOL LATENCY / CALLS（工具延迟与调用数）、HOST / PROCESSES（主机与前三个进程）、TOKEN THROUGHPUT（每步 token 曲线）、STEP CADENCE（步间隔曲线）、TURN LEDGER（每轮台账）、MODEL / CONTEXT（模型与上下文占用）、SESSION LEDGER（磁盘上的会话文件）。

---

## 四、怎么操作这份图

| 操作 | 结果 |
| --- | --- |
| 滚轮 | 以指针为中心缩放主舞台，0.45× 到 3.2× |
| 按住拖拽 | 平移 |
| `+` / `-` | 放大 / 缩小 1.18 倍 |
| `0` | 复位 |
| `F` 或双击 | 全屏 |
| 右下 `−` `+` `FIT` | 缩小 / 放大 / 复位按钮 |
| 右下 `A−` `A+` | 界面文字整体缩放，记在本机 |

放大不是把小图拉大：卡片会按当前缩放级别和屏幕像素比重画一遍，所以放到最大也还是清晰的。卡片里的文字按可用宽度截断并补 `…`，不会出现半个字，也不会越出卡片底边。

---

## 五、把别的程序也画进来

`POST /ingest` 接受单条或数组，返回 `{accepted:n}`：

```bash
curl -X POST http://127.0.0.1:7788/ingest ^
  -H "content-type: application/json" ^
  -d "{\"kind\":\"tool\",\"name\":\"my_job\",\"text\":\"scan finished in 1.2s\"}"
```

`kind` 认 `tool` / `error` / 其它（归为 ext），`name` 会变成环上的一个节点，`tokens` 是数字时会进吞吐曲线。

---

## 六、遇到问题先看这三条

**页面一直显示 `0 / 0 EVENTS · IDLE`**
采集层没读到会话文件。开 `http://127.0.0.1:7788/state.json` 看 `node.mode` 是不是 `file`、`agent.id` 是不是空。宿主里的会话可能需要先产生一条事件。

**数字是 0，但事件流在滚**
多半是上游只给了占位值（比如 600000ms 这种）。看 `series.step` / `series.lat` 是不是空数组——空说明没拿到可用样本，这是数据缺失，不是前端坏了。

**改了文件没反应**
页面文件每次请求都重新读盘，刷新即可。采集层（`core.mjs`）在插件模式下 `POST /agent-hud/reload` 换新，独立进程模式下重启 node。

---

## 七、自检与上传

提交前跑一遍：

```bash
node selftest.mjs
```

它会在随机端口起一个临时实例，逐项断言首页、CSS、JS、404、`/state.json` 字段、`POST /ingest` 接受两条、注入后事件可见、`/stream` 至少两帧。全过会打印 `all pass`，有失败项会打印失败清单并以退出码 1 结束。

上传 GitHub 的完整命令在 `README.md` 的「上传到 GitHub」一节，`.gitignore` 已经排掉了本地快照、探测脚本、日志和 `node_modules/`。

---

## 八、许可

PolyForm Noncommercial License 1.0.0，仅限非商业使用。全文见 `LICENSE`；转载或二创须保留 `NOTICE.md` 里的声明并注明出处。
