# StudyRelay

**Make room for what matters.** An explainable study-planning companion that helps students recover when a day does not go to plan.

Built for the **Alexa+ primary track** in Build, Ship, Shape: Amazon Developer Hackathon 2026, using the permitted web simulator path. This new project was created on October 21, 2026. It includes a real **MCP 2025-11-25 Streamable HTTP server**, a web MCP client, a deterministic planning engine, and durable workspace storage.

## Run it

Install **Node.js 22 or newer** from https://nodejs.org/. No package installation, API key, paid service, Amazon device, or gated Alexa+ SDK is needed.

```sh
npm run build
npm start
```

Open **http://127.0.0.1:8787**. The MCP endpoint is **http://127.0.0.1:8787/mcp**. State is saved in `.data/workspace.json`, excluded from source control. Set `PORT` or `STUDYRELAY_DATA_DIR` to override the defaults. The local app binds only to loopback and rejects foreign Origin and Host headers. It is a single-user application; do not expose the local server to a public network. On Windows, `start-studyrelay.cmd` builds and opens the app.

## Try the complete story

1. Click **Try a sample week**. All four tasks and 750 minutes fit.
2. Say **I lost today**. The proposed plan shows 60 minutes of quiz preparation that no longer fit. Nothing is committed yet.
3. Say **I have 3 hours tomorrow**. The second change combines with the first. All deadlines fit again.
4. Click **Apply this plan**. Availability and the plan are saved; deadlines do not change.
5. Ask **What should I study next?** Then say **I finished 45 minutes**.
6. Refresh. Progress persists. Use **Undo** to reverse a committed change.
7. Inspect the **MCP connection** panel for real initialization, tool discovery and tool calls.

The conversational web demo uses a small, explicitly documented phrase router. It is **not an LLM** and is **not connected to a real Alexa+ device or Amazon's gated tools**. An MCP-capable assistant can use the same tools for free-form conversations. The project makes no claim of Amazon certification or a production Alexa integration.

## Why this helps

A calendar can show a missed day; it rarely explains whether the remaining work can still fit. StudyRelay accounts for estimated effort, hard deadline dates, completed work and available focused minutes. It explains the consequences of changes, combines proposals, requires approval and remembers the outcome. Unschedulable work remains visible instead of disappearing or being moved beyond a deadline.

The planner uses **earliest deadline first**, with importance breaking ties. Work is split into sessions of at most 45 minutes. This supports splittable, independent tasks on a shared daily time budget. It is not a learning-outcome predictor. Break time is excluded from capacity, sessions have no fixed clock times, due dates include that local day, and the planning horizon is 28 days. Up to 100 tasks and eight undo snapshots are supported.

## MCP tools

| Tool | Purpose |
| --- | --- |
| `get_workspace` | Read persisted tasks, progress, capacity, risks and pending changes |
| `load_demo` | Add fictional sample data only to an empty workspace |
| `add_task` | Save a deadline and effort estimate |
| `build_plan` | Build a feasible schedule and show missing time |
| `preview_availability` | Preview and combine availability changes without committing them |
| `confirm_plan` | Apply the exact current proposal after explicit approval |
| `record_progress` | Record completed work and replan |
| `undo_change` | Restore the last committed state |

The server handles `initialize`, `notifications/initialized`, `ping`, `tools/list` and `tools/call`. JSON responses are valid Streamable HTTP. GET and DELETE return 405 because server-initiated SSE and protocol sessions are not needed. The protocol is stateless; workspace state is durable. Tool results include text and structured content. `server/discover` is also exposed for Sites' 2026-07-28 discovery; the hackathon compatibility target is 2025-11-25.

Client headers: `Content-Type: application/json`, `Accept: application/json, text/event-stream`, and `MCP-Protocol-Version: 2025-11-25` after initialization. Optional `X-StudyRelay-Timezone` is an IANA timezone, default `Asia/Kolkata`. Initialize with `protocolVersion`, `capabilities: {}` and `clientInfo`.

The hosted Sites version uses private platform authentication, scopes records by the server-provided user ID and persists them in D1. It does not share local data. Hosting is private by default; the locally runnable repository is the judging route described in the official FAQ.

## Architecture

```text
Web simulator / MCP-capable assistant
          │ initialize → tools/list → tools/call
          ▼
Streamable HTTP /mcp
          │ validation + same-origin checks + identity
          ▼
Pure planner + preview / confirm / undo
          │ revision-checked saves
          ├── local: atomic JSON file
          └── hosted: private per-user D1 records
```

`src/core.js` contains scheduling and state transitions. `src/handler.js` implements MCP and storage. `src/page.html` is the responsive web simulator. `scripts/build.mjs` produces the single-file Worker bundle. `server.mjs` serves the same bundle locally without dependencies. No third-party images, music, fonts or footage are bundled.

## Verification

```sh
npm run build
npm test
npm run validate
```

Tests cover lost-day recovery, stale proposals, explicit approval, undo, progress, input validation, 120 varied workload invariants, protocol lifecycle and errors, origin/identity checks, concurrent save rejection and HTTP persistence across a real process restart.

## Limits and next steps

- Effort estimates are supplied by the user; inaccurate estimates can produce an unrealistic plan.
- No calendar import, speech recognition, notifications, external model or real Alexa device integration is included. Optional read-aloud uses browser speech synthesis.
- Timetables, task dependencies, energy levels and spaced repetition are future work.
- Private hosted access requires identity. An external assistant should use the local endpoint unless appropriate hosted authentication is available.
- Development used AI coding assistance. The phrase router should not be presented as a language model.

## Primary references

- https://amazonappdev2026.devpost.com/
- https://amazonappdev2026.devpost.com/details/faqs
- https://modelcontextprotocol.io/specification/2025-11-25/basic/transports
- https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle
- https://modelcontextprotocol.io/specification/2025-11-25/server/tools

MIT License. See `LICENSE`.
