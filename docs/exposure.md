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

## Security

Tunneling the dashboard trades "local and private" for "reachable from
anywhere." Nothing here can damage the inverter — the collector only **reads**
it over Modbus and publishes to MQTT, has no inbound surface, and the tunnel
never touches it. All exposure risk is **dashboard-side**: who can see your
energy data, who can change settings, and who can find your house.

### What each endpoint exposes

The dashboard serves these routes. Everything reachable over the tunnel unless
you put auth (e.g. [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/))
in front of the whole hostname.

| Endpoint | Method | Exposes | Gated? |
|---|---|---|---|
| `/api/latest`, `/api/history`, `/api/states`, `/api/daily` | GET | Live + historical energy telemetry | **No** — open to any reader |
| `/api/stream` | GET (SSE) | Same telemetry, live push | **No** |
| `/api/config`, `/api/health` | GET | Tariff/currency config, row count, online flag | **No** |
| `/api/settings` | GET | Tariff, billing period, location | Coords **coarsened** for unauthenticated reads |
| `/api/settings` | PUT | Changes tariff, billing, location | Yes, if `SETTINGS_PASSWORD` is set |
| `/api/auth` | GET/POST | Whether a gate is on / password check | n/a |

The telemetry GETs have **no built-in read gate** — there is no read-only
password mode. If the dashboard shouldn't be world-readable, the data GETs
must be fronted by external auth (Cloudflare Access or equivalent); a
`SETTINGS_PASSWORD` alone leaves all reads open.

### Before you tunnel — checklist

1. **Set `SETTINGS_PASSWORD`** — closes the one open write route
   (`PUT /api/settings`). See [Gating settings writes](#gating-settings-writes).
2. **Confirm coordinate coarsening** — default `LOCATION_PUBLIC_DECIMALS=2`
   (~1.1 km) hides the house from unauthenticated reads. Lower it to coarsen
   further. See [Coarsening location](#coarsening-location-on-public-reads).
3. **Decide who may read at all** — telemetry GETs stay open with no built-in
   gate. To keep the whole dashboard private, front it with Cloudflare Access
   (or equivalent). There is no `PUBLIC_READONLY`-style flag; read protection
   is an external-auth decision.
4. **Mind the transport** — see the TLS note below before reusing any sensitive
   password.

### Plain HTTP vs TLS

`SETTINGS_PASSWORD` and the session cookie travel **in the request**. Over a
Cloudflare Tunnel, TLS terminates at Cloudflare's edge, so the public hop is
encrypted. But if you reach the origin over **plain-HTTP LAN** (the default —
the dashboard does not serve TLS itself), the password is posted to
`POST /api/auth` **in clear** and anyone sniffing that LAN segment can read it.
Treat `SETTINGS_PASSWORD` as a low-value shared secret — never reuse a
password you care about — unless the origin itself is served over HTTPS.

### Gating settings writes

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

### Coarsening location on public reads

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

### In short

Exposing the dashboard publicly removes the "local and private" guarantee.
PowMon is read-only over the inverter, so there's no way to harm it — but the
tunnel publishes your energy data to whoever can reach the hostname, and (unless
you set `SETTINGS_PASSWORD`) anyone reaching it can change the tariff and
location. Put
[Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/)
(or equivalent auth) in front of it if it shouldn't be world-readable.
