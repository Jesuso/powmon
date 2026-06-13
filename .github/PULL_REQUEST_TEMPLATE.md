<!-- Thanks for contributing to PowMon! Keep it small and focused. -->

## What & why

<!-- What does this change, and why? Link any issue: Closes #123 -->

## Component(s)

- [ ] collector
- [ ] dashboard
- [ ] mosquitto / compose
- [ ] infra
- [ ] docs / other

## Checklist

- [ ] Read-only preserved — no new path writes to the inverter
- [ ] No secrets / `data.db` / large binaries committed
- [ ] `dashboard` builds (`npm run build`) if touched
- [ ] `collector` compiles (`python -m py_compile collector/*.py`) if touched
- [ ] `docker compose config -q` parses if `compose.yml` touched
- [ ] New env vars added to the relevant `*.env.example` + README table
- [ ] Docs updated if behaviour or config changed
