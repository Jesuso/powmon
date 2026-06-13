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

## Security note

Exposing the dashboard publicly removes the "local and private" guarantee.
PowMon is read-only, so there's no way to harm the inverter — but the tunnel
publishes your energy data to whoever can reach the hostname. Put
[Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/)
(or equivalent auth) in front of it if it shouldn't be world-readable.
