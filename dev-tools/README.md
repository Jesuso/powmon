# dev-tools

Utilities used to **reverse-engineer** the PowMr/Solarman datalogger protocol.
You don't need these to run PowMon — they're here for contributors adding
support for new registers, models, or sticks.

| Tool | What it does |
|------|--------------|
| `log_server.py` | Raw TCP catch-all logger. Point the stick's report target at this host and watch exactly what bytes it sends and how often. Passive by default; `--ack` sends a generic Solarman V5 ACK to keep the stick streaming. |
| `dummycloud.py` | Minimal fake Solarman/IGEN "cloud" server. Point the stick's **Server A** (primary cloud) slot at it; it logs every pushed V5 frame (type, length, hex, embedded Modbus) and replies with the V5 time-response ACK so the stick keeps connecting. |

Both speak the **Solarman V5 binary protocol over raw TCP** (not HTTP). Frame
format and ACK behaviour were derived from
[Hypfer/deye-microinverter-cloud-free](https://github.com/Hypfer/deye-microinverter-cloud-free)
and the protocol PDFs credited in [`../SOURCES.md`](../SOURCES.md).

## Usage

```bash
python log_server.py                 # listen 0.0.0.0:10000, log to tcp_capture.log
python log_server.py --port 10000 --ack

python dummycloud.py --port 10000 --logfile push_capture.log
```

## Notes

- Redirecting the stick's cloud targets is done via the logger's hidden config
  pages (`hide_set_edit.html` / `remote.html`) on the stick's own web UI.
- **Captures and certs are gitignored** (`captures/`, `*.pem`) — they contain
  your device's real serial and live frames. Generate self-signed certs locally
  if `dummycloud.py` needs TLS; don't commit them.
