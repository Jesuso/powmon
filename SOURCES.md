# Sources & Credits

Third-party documentation and register maps this project builds on. We link
instead of redistributing — download from the original authors.

## SRNE Modbus protocol

- **SRNE Modbus V2.07 protocol PDF** — names every config register (P03 control,
  P05 battery, P06 inverter areas). Mirrored by @danzelziggy in
  [danzelziggy/srne-solarman](https://github.com/danzelziggy/srne-solarman)
  (`srne-modbus-V2.07.pdf` at the repo root). This is the document that
  resolved our full `0xE0xx`/`0xE2xx`/`0xDF0x` map — see
  [`srne_config_registers.md`](docs/srne_config_registers.md).
- **SRNE protocol v1.96 PDF + CSV transcription** — telemetry register map
  (0x01xx/0x02xx/0xF0xx blocks). By @HotNoob in
  [HotNoob/PythonProtocolGateway](https://github.com/HotNoob/PythonProtocolGateway):
  [PDF](https://github.com/HotNoob/PythonProtocolGateway/blob/main/documentation/3rdparty/protocols/SRNE.Solar.Charge.Inverter.MODBUS.Protocol1.96.pdf) ·
  [CSV](https://raw.githubusercontent.com/HotNoob/PythonProtocolGateway/main/protocols/srne/srne_2021_v1.96.holding_registry_map.csv)

## Home Assistant integration

- **ha-solarman SRNE definitions** (`srne_asf.yaml`) by @davidrapan —
  corroborated several SoC-% setpoints (and mislabeled one: its `0xE01D`
  "discharge limit" is actually StopChgSocSet; see our register doc).
  [davidrapan/ha-solarman](https://github.com/davidrapan/ha-solarman)

## Libraries

- **pysolarmanv5** by @jmccrohan — Solarman V5 datalogger protocol client used
  by the poller/daemon. [jmccrohan/pysolarmanv5](https://github.com/jmccrohan/pysolarmanv5)

## Vendor documentation

- **PowMr POW-SunSmart SP5K user manual** v1.3 (`pow-sunsmart-sp5k-user-manual-v1-3-0518.pdf`)
  — setup menu §5.2 parameter list and battery preset tables. From
  [powmr.com](https://powmr.com) (bundled with the inverter).
