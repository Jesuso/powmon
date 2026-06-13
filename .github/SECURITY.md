# Security Policy

## Scope

PowMon is **read-only by design** — no code path writes to the inverter. It runs
on your home LAN and stores telemetry locally. The most likely security-relevant
surfaces are:

- the dashboard web server (Fastify, SSE + REST on port `3001`),
- the MQTT broker (Mosquitto, port `1883`),
- optional public exposure via Cloudflare Tunnel (`infra/`, `docs/exposure.md`).

By default nothing is exposed to the internet. Public exposure is opt-in and
explicit.

## Reporting a vulnerability

Please report security issues **privately** — do not open a public issue.

- Email the maintainer at **jesuso.1410@gmail.com**, or
- Use GitHub's [private vulnerability reporting](https://github.com/Jesuso/powmon/security/advisories/new).

Include a description, affected component, and steps to reproduce. You'll get an
acknowledgement, and a fix or mitigation will be coordinated before any public
disclosure. Reports are handled confidentially.

## Supported versions

PowMon is pre-1.0; security fixes land on `main`. Run the latest commit.
