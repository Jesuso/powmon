# Screenshots & images

README images, captured from a running dashboard.

| File | Used in | Shows |
|------|---------|-------|
| `dashboard-light.png` | README hero | full glance — live state, tiles, timeline, charts |
| `money.png` | README gallery | daily + billing-period spent vs saved |
| `compare.png` | README gallery | today-vs-yesterday overlay across all charts |
| `battery.png` | README gallery | SOC + voltage with live charge setpoint lines |
| `mobile-dark-es.png` | README gallery | phone layout, dark theme, Spanish |

## Regenerate

Captured with [`../../dev-tools/shots.mjs`](../../dev-tools/shots.mjs)
(playwright-core + system Chrome) against a live instance:

```bash
cd dev-tools
npm install            # one-time: pulls playwright-core
node shots.mjs https://your-powmon-host        # or a LAN URL; defaults to the public demo
```

Re-run after UI changes so the README stays honest.
