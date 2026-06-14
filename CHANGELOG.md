# Changelog

All notable changes to PowMon are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Optional **`SETTINGS_PASSWORD`** gate on settings writes. Unset → no gate
  (unchanged). When set, `PUT /api/settings` requires a session minted by
  `POST /api/auth` (constant-time password check, httpOnly signed cookie). For
  public exposure; see `docs/exposure.md`.
- Container healthchecks for all three services so `docker compose ps` reports
  real status: dashboard probes `/api/health`, mosquitto does a test publish, and
  the collector checks a poll heartbeat. Dependents now wait for the broker to be
  healthy before starting (`depends_on: condition: service_healthy`).

### Fixed

- Collector logs are no longer invisible: `PYTHONUNBUFFERED=1` makes `print()`
  flush immediately, so `docker compose logs collector` shows samples live
  instead of looking dead while the daemon polls fine.

## [0.1.0] — 2026-06-13

First public release.

### Added

- **Collector** (`collector/`) — Python daemon polling a PowMr / SRNE hybrid
  inverter over Solarman V5 / Modbus (TCP 8899), publishing telemetry and Home
  Assistant MQTT auto-discovery under the `solar/inverter/#` topic contract.
- **Dashboard** (`dashboard/`) — TypeScript / Fastify + SQLite app: live state
  over SSE, 30 days of history over REST, spent-vs-saved money view, day-compare,
  battery SOC/voltage with real setpoints. Light / dark / OS themes, English /
  Spanish, phone-to-wall-tablet responsive.
- **Mosquitto** config for the bundled Docker stack.
- One-command Docker stack (`compose.yml`) plus bare-metal / systemd units.
- **Home Assistant** integration via MQTT discovery.
- Optional public exposure via Cloudflare Tunnel (`infra/`, OpenTofu).
- Documented SRNE config + telemetry register maps (`docs/`), with third-party
  attribution in `SOURCES.md`.
- Project kit: README, CONTRIBUTING, Code of Conduct, Security Policy, issue /
  PR templates, and CI (dashboard build, collector compile, compose validation,
  gitleaks secret scan).

### Security

- Read-only by design — no code path writes to the inverter.
- Local-first — no cloud account; nothing leaves the LAN unless public exposure
  is explicitly opted into.

[Unreleased]: https://github.com/Jesuso/powmon/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Jesuso/powmon/releases/tag/v0.1.0
