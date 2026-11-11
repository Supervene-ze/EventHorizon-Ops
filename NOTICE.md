NOTICE
======

EventHorizon-Ops — real-time holographic operations HUD for AI agent sessions.

Copyright (c) 2026 EventHorizon-Ops. All rights reserved.
https://github.com/EventHorizon-Ops/eventhorizon-ops

Licensed under the PolyForm Noncommercial License 1.0.0.
Noncommercial use only. ANY COMMERCIAL USE IS STRICTLY PROHIBITED.
Keep this notice and credit "EventHorizon-Ops" when sharing or remixing.

源代码与视觉设计受著作权保护，按 PolyForm Noncommercial 1.0.0 授权。
仅限非商业用途，严格禁止任何商业用途。转载或二创须保留本声明并注明出处。

Every value rendered by this HUD is bound to live telemetry: the host system
sampler (CPU, memory, process table) and the DSH session event log
(JSONL stream compressed as appended zstd frames). There is no synthetic
dataset, no random KPI ticker, no typewriter pseudo-code, no mock agent grid,
and no background music. When a number does not exist upstream, the HUD derives
it from event timestamps instead of inventing one, and reports nothing when the
input is missing.
