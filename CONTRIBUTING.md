# Contributing to PowMon

Thanks for helping. PowMon is small and opinionated on purpose — these notes
keep changes cheap and the project coherent.

## Ways to contribute

You don't have to write code to help:

- **Report a bug** — [open a bug report](https://github.com/Jesuso/powmon/issues/new/choose).
- **Suggest a feature / share an idea** — [Discussions › Ideas](https://github.com/Jesuso/powmon/discussions/categories/ideas).
- **Ask or answer questions** — [Discussions › Q&A](https://github.com/Jesuso/powmon/discussions/categories/q-a).
- **Improve docs** — typos, clearer wording, a missing step; PRs to `docs/` are very welcome.
- **Test on your hardware** — tell us which inverter + datalogger you ran it on, working or not. Coverage is the slowest thing to grow alone.
- **Send a PR** — see the workflow below.
- **Sponsor** — [support the project ❤](https://github.com/sponsors/Jesuso) if it's useful to you.

Everyone interacting in the project agrees to the
[Code of Conduct](.github/CODE_OF_CONDUCT.md).

## Ground rules

- **Read-only, always.** No code path may write to the inverter. This is a
  safety and trust guarantee — PRs that add write paths will be declined.
- **Local-first.** No feature should require a cloud account or send data off
  the LAN by default. Public exposure stays opt-in ([docs/exposure.md](docs/exposure.md)).
- **Honest data only.** Show what the inverter reports or transparent arithmetic
  on it. Never a derived pseudo-metric that can mislead. See
  [dashboard/PRODUCT.md](dashboard/PRODUCT.md).
- **Never commit secrets.** Real `.env` / `powmr.env` / `*.tfvars` / `*.tfstate`
  / captures / certs are gitignored — keep it that way. CI runs `gitleaks`.

## Project shape

Three independent components joined only by the MQTT topic contract
(`solar/inverter/#`). Start with [docs/architecture.md](docs/architecture.md).

| Area | Where | Dev setup |
|------|-------|-----------|
| Inverter ingest | [`collector/`](collector/) | Python venv — see its [README](collector/README.md) |
| Web dashboard | [`dashboard/`](dashboard/) | Node 22, `npm ci` — see its [README](dashboard/README.md) |
| Broker config | [`mosquitto/`](mosquitto/) | edit conf |
| Public exposure | [`infra/`](infra/) | OpenTofu |
| Protocol RE | [`dev-tools/`](dev-tools/) | capture utilities |

## Adding a metric

The dashboard's rule is **one declaration, everywhere**: a field is declared
once in `dashboard/src/shared/types.ts` and flows to persistence, API, charts,
rows, and hints. Adding a metric should be a types entry + i18n strings. If it
takes more, something regressed. New inverter fields also need a decode entry in
the collector. Register references live in
[docs/srne_config_registers.md](docs/srne_config_registers.md) and
[SOURCES.md](SOURCES.md).

## Adding a language

One JSON under `dashboard/src/client/i18n/locales/` + one `SUPPORTED` entry.
English is the fallback and fills any gaps.

## Before opening a PR

- `cd dashboard && npm run build` passes.
- `python -m py_compile collector/*.py` passes (or your linter of choice).
- `docker compose config -q` still parses if you touched `compose.yml`.
- No secrets, no committed `data.db`, no large binaries.
- New env vars documented in the relevant `*.env.example` and README table.

## Naming

The MQTT prefix is `solar/inverter` and the Python files are `powmr_*.py` for
historical reasons (PowMr = the inverter vendor; PowMon = this tool). They're
stable on purpose — don't rename them in a PR without a discussion, since it
churns every deployed config.
