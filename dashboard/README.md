# powmon-web

Real-time local dashboard for a PowMr/SRNE hybrid inverter: live state,
30 days of history, and energy translated into money.

Why it exists, who it serves, and the principles that decide design debates:
**[PRODUCT.md](PRODUCT.md)**. This file covers the engineering side — how the
system thinks, and the rules that keep changes cheap.

## Architecture

```
inverter ──Modbus──▶ powmr_daemon.py ──MQTT──▶  this app  ──▶ browser
 (RS232/USB)          (poll @10s)     solar/inverter/#    (SSE live + REST history)
                                                                │
                                                                ▼
                                                          SQLite (data.db)
```

Fastify (TypeScript) subscribes to MQTT, persists every sample, streams live
updates over SSE, and serves the built React/visx client. The poller
([`../collector`](../collector)) and broker ([`../mosquitto`](../mosquitto))
are sibling components in this repo; this app only consumes the MQTT contract
they publish — see [`../docs/architecture.md`](../docs/architecture.md).

## Engineering principles

The decisions below shape every change; break them knowingly or not at all.

- **One declaration, everywhere.** Fields, chart panels, and stat groups are
  declared once in `src/shared/types.ts` and flow to persistence, API,
  charts, rows, and hints. Adding a metric is a types entry + i18n strings —
  if it takes more, something regressed.
- **Store facts, derive presentation.** SQLite keeps the raw inverter JSON
  per sample; history aggregates are computed at query time
  (`json_extract`), so new fields work retroactively and there are no
  migrations. Money, formatting, and grouping happen client-side from the
  server-stored tariff.
- **Honest data only.** The server never invents metrics. If a value must be
  derived, derive it transparently (sum, product with the tariff) and label
  it for what it is. Apparent-power-as-watts is the canonical mistake — see
  PRODUCT.md.
- **Every string through i18n.** No user-visible literals in components.
  Locales are one JSON each under `src/client/i18n/locales/`; English is the
  fallback. A new language = one JSON + one `SUPPORTED` entry.
- **Theme via CSS custom properties.** Components style against tokens, not
  colors. SVG charts read the matching `CHART_TOKENS` map. New theme = a new
  token block.
- **Read-only by design.** No code path writes to the inverter. Keep it that
  way.
- **The dashboard is a guest on every screen.** Layout collapses from side
  rail to stacked without forking the component tree.

## Run

```bash
npm install
npm run dev        # fastify :3001 + vite dev server
npm run build      # → dist/
npm start          # prod: fastify serves API + dist on :3001
```

Config via env: `API_PORT` (3001), `MQTT_HOST`/`MQTT_PORT` (localhost:1883),
`BASE_TOPIC` (`solar/inverter`), `DB_PATH` (`./data.db`), `RETENTION_DAYS`
(30), `SETTINGS_PASSWORD` (unset → settings writes are open; set → gated, see
[`docs/exposure.md`](../docs/exposure.md)). Server binds 0.0.0.0 —
LAN-reachable by intent, never internet-exposed.

API surface is small and self-describing: `/api/latest`, `/api/history`,
`/api/states`, `/api/config`, `/api/settings`, `/api/stream` (SSE),
`/api/health`. Parameters live next to their handlers in
`src/server/index.ts`.

## Deploy

Production runs on the Raspberry Pi (`solar-web` systemd user service).
`./deploy.sh` ships the committed tree, rebuilds there, restarts, and
verifies. Commit first — it deploys HEAD, not your working tree.

## Layout

```
src/shared/types.ts    field/panel/group declarations — the single source of truth
src/server/            fastify: MQTT→SQLite→SSE/REST (index.ts), Store (db.ts)
src/client/            React app: App (layout/routing), components/, i18n/, theme/
```
