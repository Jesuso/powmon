# Hardware

## Supported inverters

PowMon was built and tested against a **PowMr POW-SunSmart SP5K** (a 48 V
hybrid solar inverter). Under the hood it speaks the **SRNE Modbus** protocol —
PowMr rebadges SRNE hardware — over a **Solarman V5** (a.k.a. IGEN) WiFi
datalogger stick.

In practice this means PowMon should work with **any SRNE-based hybrid inverter
paired with a Solarman/IGEN WiFi stick**, including other PowMr models and
SRNE-OEM units sold under various brands. The telemetry and config register
maps are documented in:

- [`docs/srne_config_registers.md`](srne_config_registers.md) — config registers
- [`SOURCES.md`](../SOURCES.md) — upstream protocol PDFs and CSV register maps

If your inverter reports different registers, the field declarations live in one
place (`dashboard/src/shared/types.ts` for presentation; the collector's decode
map for ingest) — see [CONTRIBUTING.md](../CONTRIBUTING.md).

## The datalogger stick

PowMon does **not** talk to the inverter's RS232/RS485 port directly. It talks
to the **WiFi datalogger stick** over your LAN using the Solarman V5 protocol on
TCP (default port `8899`). The stick must be:

- joined to your WiFi (use the Solarman / PowMr phone app to set it up), and
- reachable from the host running the collector (same LAN / subnet).

This is the same stick the vendor cloud app uses; PowMon just reads it locally
instead of via the cloud.

## Finding your IP + serial

PowMon needs two values:

| Value | Where to find it |
|-------|------------------|
| `INVERTER_IP` | The stick's LAN IP. Check your router's DHCP client list, or the Solarman/PowMr app. A static DHCP lease is recommended so it doesn't change. |
| `LOGGER_SERIAL` | Printed on the **sticker on the stick**. Also shown in the Solarman/PowMr app as **"Device SN"**. A 10-digit number. |

Quick reachability check:

```bash
ping <INVERTER_IP>
# stick listening on the Solarman V5 port:
nc -vz <INVERTER_IP> 8899
```

## Going deeper

The [`dev-tools/`](../dev-tools/) directory has the utilities used to
reverse-engineer the stick's protocol — a raw TCP capture logger and a minimal
fake-cloud server that ACKs the stick so it keeps streaming. Useful if you're
adding support for a new register or a different stick. See
[`dev-tools/README.md`](../dev-tools/README.md).
