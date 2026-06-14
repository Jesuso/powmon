# Public exposure (optional)

PowMon is **local-first**: the dashboard binds the LAN and is never meant to be
internet-exposed directly. But if you want to reach it from outside the house —
and especially if your ISP puts you behind **CGNAT** (carrier-grade NAT, where
port forwarding is impossible because you have no public IP) — the
[`infra/`](../infra/) directory has an opt-in **Cloudflare Tunnel** setup,
managed with OpenTofu.

## Why a tunnel

A Cloudflare Tunnel is **outbound-only**: a small connector on your host dials
out to Cloudflare and traffic is pulled back through that connection. This means:

- No inbound ports, no port forwarding, no public IP required.
- Works behind CGNAT and double-NAT.
- TLS terminated at Cloudflare's edge; the origin stays on your LAN.

## What it sets up

The OpenTofu config provisions the Cloudflare zone, the tunnel (and its secret),
the ingress config (public hostname → local origin), and a proxied DNS record.
State is stored locally and **encrypted at rest**.

Full instructions, prerequisites (Cloudflare API token + account ID), and the
connector install for the host are in **[`infra/README.md`](../infra/README.md)**.

## Gating settings writes

The dashboard is read-only over the inverter, but it does have **one write
route** — `PUT /api/settings` (tariff, billing period, location). On the LAN
that's fine; exposed publicly it's an open write route reachable with `curl`,
regardless of whether the Settings tab is visible in the UI.

Set **`SETTINGS_PASSWORD`** in `.env` to gate it server-side:

```sh
SETTINGS_PASSWORD=some-long-passphrase
```

- **Unset/empty → no gate** (default; unchanged behavior for LAN use).
- When set, the Settings page prompts for the password. `POST /api/auth`
  checks it (constant-time compare) and issues an **httpOnly, signed session
  cookie**; `PUT /api/settings` returns `401` without a valid session. The
  signing secret is per-process, so restarting the server invalidates sessions.

This protects the write route, not the data — the read endpoints (live state,
history, charts) stay open to anyone who can reach the dashboard.

## Coarsening location on public reads

The location used for sunrise/sunset night-shading is stored at full precision,
but `GET /api/settings` **rounds it for unauthenticated reads** so a public read
can't reveal your house. The authenticated owner (a valid `SETTINGS_PASSWORD`
session) still gets full precision for editing. With no gate set, everyone is
treated as the owner — unchanged LAN behavior.

Precision is configurable via **`LOCATION_PUBLIC_DECIMALS`** (default `2`):

| Decimals | Degrees | Magnitude | Reveals |
|---|---|---|---|
| 1 | 0.1° | ~11 km | broad region / city district |
| 2 (default) | 0.01° | ~1.1 km | neighborhood / small town |
| 3 | 0.001° | ~111 m | a block / large building |
| 4 | 0.0001° | ~11 m | individual house / parcel |

2 dp keeps sunrise/sunset accurate to well under a minute while hiding the
house. Set it lower to coarsen further, higher to disclose more.

## Security note

Exposing the dashboard publicly removes the "local and private" guarantee.
PowMon is read-only over the inverter, so there's no way to harm it — but the
tunnel publishes your energy data to whoever can reach the hostname, and (unless
you set `SETTINGS_PASSWORD`, above) anyone reaching it can change the tariff and
location. Put
[Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/)
(or equivalent auth) in front of it if it shouldn't be world-readable.
