# collector

Reads a PowMr / SRNE hybrid inverter over its Solarman V5 WiFi datalogger and
publishes the telemetry to MQTT — including Home Assistant discovery so entities
appear automatically. This is the ingest half of PowMon; the
[dashboard](../dashboard) and [Home Assistant] consume what it publishes.

Read-only: it never writes to the inverter.

## Scripts

| Script | Purpose |
|--------|---------|
| `powmr_daemon.py` | The long-running daemon. Polls every `POLL_INTERVAL` and publishes state + HA discovery. This is what the systemd unit / container runs. |
| `powmr_poll.py` | One-shot read of the live telemetry registers. Handy for testing connectivity and seeing decoded values. |
| `powmr_config_poll.py` | Reads the inverter's **config** registers (setpoints, battery presets). See [`../docs/srne_config_registers.md`](../docs/srne_config_registers.md). |

## Run standalone

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt

cp powmr.env.example powmr.env
$EDITOR powmr.env          # INVERTER_IP, LOGGER_SERIAL, MQTT_HOST, ...

.venv/bin/python powmr_poll.py     # quick test: single read
.venv/bin/python powmr_daemon.py   # the real daemon
```

`powmr.env` is auto-loaded when you run the scripts by hand, and read by the
systemd unit via `EnvironmentFile`. In Docker the same values come from the
compose environment instead.

## Configuration

| Variable | Default | Meaning |
|----------|---------|---------|
| `INVERTER_IP` | — | LAN IP of the datalogger stick (**required**) |
| `LOGGER_SERIAL` | — | Datalogger serial / "Device SN" (**required**) |
| `INVERTER_PORT` | `8899` | Solarman V5 TCP port |
| `MQTT_HOST` / `MQTT_PORT` | `127.0.0.1` / `1883` | Broker to publish to |
| `MQTT_USER` / `MQTT_PASS` | — | Only if the broker requires auth |
| `POLL_INTERVAL` | `10` | Seconds between polls |
| `BASE_TOPIC` | `solar/inverter` | Topic prefix for published state |
| `DISCOVERY_PREFIX` | `homeassistant` | Home Assistant discovery prefix |

Don't have the IP/serial? See [`../docs/hardware.md`](../docs/hardware.md#finding-your-ip--serial).

## How it talks to the inverter

Uses [`pysolarmanv5`](https://github.com/jmccrohan/pysolarmanv5) to speak the
Solarman V5 protocol to the WiFi stick over TCP, then decodes SRNE Modbus
registers. Protocol sources and register maps are credited in
[`../SOURCES.md`](../SOURCES.md).

[Home Assistant]: https://www.home-assistant.io/
