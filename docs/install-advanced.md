# Advanced install — bare-metal

Run the pieces directly on a host without Docker: a Python collector under
systemd, a system Mosquitto broker, and the dashboard as a Node service. Use
this when you want native systemd integration, an existing broker, or to run
PowMon on a box where Docker isn't welcome.

The three components are independent and joined only by MQTT — install only the
ones you need.

## 1. MQTT broker

Any MQTT broker works. To use the system Mosquitto:

```bash
sudo apt-get install -y mosquitto mosquitto-clients
```

For a trusted home LAN, anonymous access is fine (see
[`mosquitto/mosquitto.conf`](../mosquitto/mosquitto.conf)). To require auth:

```bash
sudo mosquitto_passwd -c /etc/mosquitto/passwd solar      # set a password
# in mosquitto.conf: allow_anonymous false + password_file /etc/mosquitto/passwd
sudo systemctl restart mosquitto
```

The collector honours `MQTT_USER` / `MQTT_PASS`; **the dashboard's MQTT client
is anonymous-only** — keep the broker open on the LAN or expose a second
anonymous listener for it.

## 2. Collector

```bash
cd collector
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt

cp powmr.env.example powmr.env
$EDITOR powmr.env          # INVERTER_IP, LOGGER_SERIAL, MQTT_HOST, ...
```

Run it by hand to confirm it works (`powmr.env` is auto-loaded):

```bash
.venv/bin/python powmr_daemon.py
```

You should see samples every ~10 s. `powmr_poll.py` does a single read (handy
for testing); `powmr_config_poll.py` reads the config registers. See
[`collector/README.md`](../collector/README.md).

### Run under systemd

Two unit templates are provided:

- [`systemd/powmr-telemetry.user.service`](../systemd/powmr-telemetry.user.service)
  — a **user** service, no editing needed (uses `%h`). Install with:
  ```bash
  mkdir -p ~/.config/systemd/user
  cp systemd/powmr-telemetry.user.service ~/.config/systemd/user/
  systemctl --user daemon-reload
  systemctl --user enable --now powmr-telemetry
  loginctl enable-linger "$USER"   # so it runs without an active login
  ```
- [`systemd/powmr-telemetry.service`](../systemd/powmr-telemetry.service)
  — a **system** service. Edit `User=` and the three paths, then:
  ```bash
  sudo cp systemd/powmr-telemetry.service /etc/systemd/system/
  sudo systemctl daemon-reload && sudo systemctl enable --now powmr-telemetry
  ```

Both expect the repo layout and a `powmr.env` next to the daemon. Adjust the
`WorkingDirectory` if you cloned elsewhere.

## 3. Dashboard

Needs Node 22+.

```bash
cd dashboard
npm ci
npm run build
npm start                  # serves API + built UI on :3001
```

Configuration via env (`API_PORT`, `MQTT_HOST`, `MQTT_PORT`, `BASE_TOPIC`,
`DB_PATH`, `RETENTION_DAYS`). The server binds `0.0.0.0` — LAN-reachable by
intent, **never internet-exposed** without a fronting tunnel (see
[exposure.md](exposure.md)).

### Run under systemd

[`systemd/powmon-web.user.service`](../systemd/powmon-web.user.service) runs it
as a user service:

```bash
cp systemd/powmon-web.user.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now powmon-web
```

Adjust `WorkingDirectory` / `DB_PATH` to your clone location.

## Deploying updates to a remote host

[`dashboard/deploy.sh`](../dashboard/deploy.sh) ships the committed tree to a
remote (e.g. a Pi), rebuilds, restarts the service, and health-checks. Put your
target in `dashboard/deploy.env` (gitignored):

```bash
# dashboard/deploy.env
PI_HOST=user@your-pi.lan
PI_DIR='$HOME/powmon/dashboard'
SERVICE=powmon-web
```

```bash
cd dashboard
./deploy.sh            # deploys git HEAD (not your working tree — commit first)
./deploy.sh --install  # also runs npm ci (after dependency changes)
```

## Home Assistant

The collector publishes MQTT discovery (`DISCOVERY_PREFIX`, default
`homeassistant`) regardless of how it's run. Point HA's MQTT integration at your
broker and the inverter entities appear automatically.
