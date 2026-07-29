# 🦞 Lobster-Tracer

> **AI Agent Observability Engine** — making every decision in multi-agent collaboration transparent and traceable.

[![Version](https://img.shields.io/badge/version-0.5.14-blue)](https://github.com/sshnuke3/lobster-tracer)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org)
[![Demo](https://img.shields.io/badge/demo-online-brightgreen)](https://lobster-tracer-production.up.railway.app)
[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new/template)

---

## The Problem It Solves

When an AI Agent runs a long task (writing a long article, multi-turn collaboration, automated workflows), you can't see what it's doing:

- Which agent got stuck retrying in some phase?
- When multiple agents hand off, who dropped the ball?
- For a long task, where did the tokens actually get burned?

**Lobster-Tracer visualizes every LLM call, every state transition, and every self-loop stall in real time — as a Sankey flow diagram + phase-transition timeline + aggregate dashboard.**

It's to Agents what DevTools is to web pages — but positioned as observability infrastructure that Agents *need at runtime*, not a debugger you only reach for when something breaks.

**Most同类 projects only do log replay or trace trees. Lobster-Tracer adds three things**: ① models the abstract flow as a **measurable state machine**; ② flags **self-loops** as a **stall signal** and highlights them; ③ **aggregates** across sessions into org-level knowledge ("which model burns the most tokens, which phase stalls most").

## ✨ Features

| Capability | Description |
|---|---|
| 🔀 Real-time Sankey state machine | Draws agent phase transitions as measurable paths; an `A → A` self-loop edge = a visible "agent stall" signal |
| 👥 Multi-agent timeline | Each node shows the responsible agent + model; see who dropped the ball in a handoff |
| 📊 Aggregate dashboard | Cross-session token totals / per-model cost / self-loop stall ranking / top sessions (Fleet observability) |
| ⚡ WebSocket live push | Events broadcast on write; dashboard refreshes without polling; "live" indicator top-right |
| 🔌 OpenAI-compatible Stream Proxy | Hand-written undici proxy with real token accounting; `metadata.phase` auto-records transitions |
| 🚨 Anomaly detection | Self-loops / cycles auto-highlighted; stalls and retries are obvious |
| 🎲 One-click Demo | `DEMO_MODE=1` auto-seeds 8 example sessions (writing / code review / trip planning) on boot |

## 🚀 30-Second Quickstart

```bash
npm install
npm start
# open http://localhost:3000/dashboard.html
```

Point your LLM call at Lobster-Tracer's proxy and attach `metadata.phase` — the transition is recorded automatically:

```js
await fetch('http://localhost:3000/proxy/v1/chat/completions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model: 'qwen3.7-flash',
    stream: true,
    messages: [{ role: 'user', content: 'Write a 3000-word article' }],
    metadata: { phase: 'chapter_gen' }   // ← auto-recorded as a state transition
  })
});
```

Refresh the dashboard — a new path appears in the Sankey diagram immediately.

## 📦 Install (by scenario)

| Scenario | How |
|---|---|
| **Local dev** | `npm install && npm start`, visit `http://localhost:3000` |
| **Public Demo (Railway)** | Remove `ADMIN_TOKEN` + add `DEMO_MODE=1` → anonymous, auto-seeds on boot |
| **Production (Railway)** | Add `ADMIN_TOKEN` (strong random) + `WS_ALLOWED_ORIGIN` (frontend domain) to lock down |
| **Container** | `docker build -t lobster-tracer . && docker run -p 3000:3000 -e DEMO_MODE=1 lobster-tracer` |

> Write endpoints and WebSocket are auth-gated but **off by default** (only enforced once `ADMIN_TOKEN` is set); zero-config for local dev. See "Security" below.

## 🌐 Public Instance

https://lobster-tracer-production.up.railway.app

## 🧭 Reviewer Tour (5-minute path)

Open the [public instance](https://lobster-tracer-production.up.railway.app/dashboard.html) — demo data is pre-loaded, **no signup/login needed**.

1. **Global view** — the Sankey diagram shows the full flow `init → outline → chapter_gen → verify → done`; notice the `chapter_gen → chapter_gen` self-loop edge = a visible "agent stall".
2. **Multi-agent collab** — click "AI 编辑部：三个 Agent 接力写文章"; the timeline shows `outline_agent → chapter_gen_agent → verify_agent` with agent + model on each node.
3. **Anomaly detection** — click "写作 Agent 卡壳实录：大纲被打回 3 次"; the Sankey draws a clear cycle and the aggregate panel ranks self-loops.
4. **Live push** — the "live" indicator top-right lights up = WebSocket connected; new events broadcast on write, dashboard refreshes without polling.

## 🛠️ Tech Stack

- **Backend**: Node.js 20 + Express + better-sqlite3 (WAL mode)
- **Frontend**: vanilla HTML + ECharts 5 (Sankey state machine + chunk character-stream timeline)
- **Proxy**: hand-written undici OpenAI-compatible Stream Proxy (no SDK; SSE cross-packet buffering + real token accounting)
- **Deploy**: Railway / Docker (free tier works)

## 📡 API Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Health check + DB stats |
| GET | `/sessions` | List all sessions |
| GET | `/sessions/:id` | Single session detail + event stream |
| GET | `/analytics/statemachine` | State machine definition (Sankey source; returns aggregated paths when real data exists) |
| GET | `/analytics/aggregate` | Cross-session aggregate (token totals / per-model cost / self-loop stall signal / top sessions) |
| POST | `/analytics/transition` | Report one phase transition `{"from","to","reason?","sessionId?"}` (integration point) |
| POST | `/analytics/seed` | Inject one example workflow (with self-loop + error recovery), for demo |
| DELETE | `/analytics/transitions` | Clear real transition data (demo reset) |
| POST | `/proxy/v1/chat/completions` | OpenAI-compatible Stream Proxy (`metadata.phase` auto-records `init→phase`) |
| WS | `ws://host/` | Live push: broadcast on write, dashboard refreshes without polling |
| GET | `/dashboard.html` | 📊 Visual panel (with "inject example" button + live indicator) |
| GET | `/playground.html` | ▶ Stream Proxy test / session history |

## 🔐 Security (read before public deploy)

Since D9 all write endpoints, `/proxy`, and WebSocket are auth-gated, but **off by default** — only enforced once env vars are set (zero-config local dev):

| Var | Role | Required for public? |
|---|---|---|
| `ADMIN_TOKEN` | Bearer / `?token=` for write endpoints + WebSocket | Public demo **unset** (anonymous); production **must set** a strong random string |
| `WS_ALLOWED_ORIGIN` | Restrict WebSocket origin, prevent cross-site subscribe | Recommended |

- **Local**: `cp .env.example .env` (gitignored) fill `ADMIN_TOKEN`, then `set -a; . ./.env; set +a` before start (no dotenv auto-load).
- With `ADMIN_TOKEN` set, open dashboard with `?token=YOUR_ADMIN_TOKEN` to establish the WS connection; public demo omits it.

## 🏆 Hackathon Track & Qoder Symbiosis

**Qoder — AI Agent Observability Engine / Multi-agent Collaboration Visualization / Long-horizon Execution Chain Observation**

| Qoder provides | Lobster-Tracer complements |
|---|---|
| Multi-agent orchestration | **Visualization** of collaboration — who did what, in which phase, at a glance |
| Long-horizon delegation | **Observability** of execution — where a long task stalls, how many self-loops, in real time |
| Memory & knowledge engine | **Persistence verification** — every LLM call fully stored, agent memory never lost |
| understand→plan→execute→verify→iterate | **State-machine modeling** of that loop — Sankey turns the abstract flow into measurable paths |

**Qoder lets Agents act. Lobster-Tracer lets you see what Agents are doing.**

### 🧠 Memory Engine: observation is accumulation

The `transitions` table persists every phase transition (with agent / model / duration); the `sessions` table keeps the full prompt / response — any historical decision is replayable. Cross-session aggregation (`/analytics/aggregate`) distills "which model burns the most tokens, which phase stalls most" into org-level knowledge — the **verifiable data foundation** for Qoder's memory & knowledge engine.

### 🔗 Three steps to integrate Qoder Quest mode

Report each phase via the `/analytics/transition` API — decoupled from any multi-agent system (no Qoder source changes needed):

1. Each time an agent enters a phase, call `POST /analytics/transition` with `{ from, to, reason, sessionId?, agent?, model? }`;
2. The panel renders Sankey / timeline in real time; stall self-loops auto-highlight;
3. To observe another workflow, just extend `PHASE_MACHINE.phases` (e.g. `analyze` / `review` / `fix`) — the state machine and Sankey adapt automatically.

> The demo "代码审查 Agent：自动 Review 并修 Bug" uses the `init → analyze → review → fix → done` path, proving the observability engine isn't limited to long-form writing.

## 🧪 Tests

```bash
npm test   # runs test/smoke.mjs —— checks /health /aggregate /statemachine /sessions + 401/200 auth on write endpoints
```

The smoke script has no extra deps (Node built-in `child_process` + `fetch`); temp DB at `data/smoke-test.db` (gitignored), no pollution of real data.

## 🤝 Contributing

1. Fork and create a feature branch (`git checkout -b feat/xxx`);
2. Run `npm install && npm start` locally; add smoke assertions (`test/smoke.mjs`) for new capabilities;
3. Follow the `Dxx: summary` commit convention for traceable development history;
4. Open a PR describing "what it solves / how to verify".

All write endpoints and WebSocket are auth-off by default (only enforced with `ADMIN_TOKEN`); never commit secrets or `.env` in a PR.

## 📜 License

[MIT](LICENSE)

---

*Updated: 2026-07-29 · Version v0.5.14 · Deployed on Railway*
