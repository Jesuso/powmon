# Basic install — Docker

The fastest path: one MQTT broker, one collector, one dashboard, all in
containers. Good for ~90% of users. For bare-metal, an existing broker, or
systemd, see [install-advanced.md](install-advanced.md).

## Prerequisites

- A host on the same LAN as the inverter (a Raspberry Pi, a NAS, any always-on
  Linux box) with **Docker** + the **Docker Compose plugin**.
- Your inverter's **WiFi datalogger IP** and **serial number** — see
  [hardware.md](hardware.md#finding-your-ip--serial) if you don't have them.

## Steps

```bash
git clone https://github.com/<you>/powmon.git
cd powmon

cp .env.example .env
$EDITOR .env            # set INVERTER_IP and LOGGER_SERIAL (required)

docker compose up -d
```

That's it. Three services start:

- `mosquitto` — the MQTT broker (port `1883`, exposed for Home Assistant)
- `collector` — polls the inverter every 10 s and publishes to MQTT
- `dashboard` — stores history and serves the web UI (port `3001`)

## Verify

```bash
docker compose ps           # all three "running"
docker compose logs -f collector   # should show samples every ~10s, no auth/connect errors
curl -sf http://localhost:3001/api/health
```

Then open **http://<host>:3001** in a browser. A green dot = the dashboard is
receiving live samples.

## Configuration

All settings are environment variables in `.env`. Only the first two are
required; defaults are shown for the rest.

| Variable | Default | Meaning |
|----------|---------|---------|
| `INVERTER_IP` | — | LAN IP of the WiFi datalogger stick (**required**) |
| `LOGGER_SERIAL` | — | Datalogger serial / "Device SN" (**required**) |
| `INVERTER_PORT` | `8899` | Solarman V5 TCP port on the stick |
| `POLL_INTERVAL` | `10` | Seconds between polls |
| `BASE_TOPIC` | `solar/inverter` | MQTT topic prefix |
| `DISCOVERY_PREFIX` | `homeassistant` | Home Assistant discovery prefix |
| `DASHBOARD_PORT` | `3001` | Host port for the web UI |
| `MQTT_HOST` / `MQTT_PORT` | `mosquitto` / `1883` | Point at your own broker instead of the bundled one |
| `MQTT_USER` / `MQTT_PASS` | — | Only if your broker requires auth |

After editing `.env`: `docker compose up -d` again to apply.

## Home Assistant

The bundled broker exposes port `1883` on the LAN on purpose. In Home Assistant,
add the **MQTT** integration and point it at `<host>:1883`. The collector
publishes [device discovery](https://www.home-assistant.io/integrations/mqtt/#mqtt-discovery)
messages, so the inverter and all its entities appear automatically — no manual
sensor YAML.

Already have a broker (e.g. HA's add-on Mosquitto)? Delete the `mosquitto`
service from `compose.yml` and set `MQTT_HOST` / `MQTT_PORT` (and
`MQTT_USER` / `MQTT_PASS` if needed) in `.env`.

## Updating

```bash
git pull
docker compose up -d --build
```

History lives in a named Docker volume (`dashboard-data`) and survives rebuilds.

## Troubleshooting

- **No samples / connection refused in collector logs** — wrong `INVERTER_IP`
  or `LOGGER_SERIAL`, or the stick isn't reachable. Ping the IP; confirm the
  serial matches the sticker.
- **Dashboard loads but no green dot** — collector isn't publishing. Check
  `docker compose logs collector` and that `BASE_TOPIC` matches on both services.
- **HA sees nothing** — confirm HA's MQTT integration points at this broker and
  `DISCOVERY_PREFIX` matches HA's (default `homeassistant`).
