#!/usr/bin/env python3
"""Poll a PowMr/SRNE hybrid inverter via its Solarman V5 WiFi datalogger (LAN, TCP/8899).

Register map: SRNE "Energy Storage Inverter" MODBUS protocol v1.96, holding regs (fn 0x03).
Verified against firmware SR-240618-0143-301 (build May 2024) on a 48V split-phase unit.

Config (env vars, or powmr.env next to this script — see powmr.env.example):
    INVERTER_IP      LAN address of the WiFi datalogger stick
    LOGGER_SERIAL    datalogger serial number (sticker on the stick / Solarman app)
    INVERTER_PORT    TCP port (default 8899)

Usage:
    python powmr_poll.py            # pretty table
    python powmr_poll.py --json     # one JSON object (for piping into MQTT/DB)
"""
import argparse, json, os, sys

# Re-exec into the project venv if not already under it, so `./powmr_poll.py`
# works directly (pysolarmanv5 lives in .venv, not system python). See
# powmr_config_poll.py for why this compares the invoked path, not realpath.
_VENV_PY = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".venv", "bin", "python")
if (os.path.exists(_VENV_PY)
        and os.path.abspath(sys.executable) != _VENV_PY
        and os.environ.get("_POWMR_REEXEC") != "1"):
    os.environ["_POWMR_REEXEC"] = "1"
    os.execv(_VENV_PY, [_VENV_PY, os.path.abspath(__file__), *sys.argv[1:]])

from pysolarmanv5 import PySolarmanV5

def _load_env_file():
    """Fill os.environ from powmr.env next to this script (systemd's EnvironmentFile
    isn't read when running the CLI by hand). Existing env vars win."""
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "powmr.env")
    if not os.path.exists(path):
        return
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            os.environ.setdefault(k.strip(), v.strip())

_load_env_file()

IP = os.getenv("INVERTER_IP")
SERIAL = int(os.getenv("LOGGER_SERIAL", "0"))
PORT = int(os.getenv("INVERTER_PORT", "8899"))

def s16(v):  # signed 16-bit
    return v - 0x10000 if v >= 0x8000 else v

def u32_le(lo, hi):  # 32-bit, little-endian word order (low word first)
    return lo | (hi << 16)

# addr: (key, scale, unit, signed)
FIELDS = {
    0x0100: ("battery_soc",        1,    "%",   False),
    0x0101: ("battery_voltage",    0.1,  "V",   False),
    0x0102: ("battery_current",    0.1,  "A",   True),   # PDF: >0 = discharging
    0x0103: ("battery_temp",       0.1,  "C",   True),
    0x0107: ("pv1_voltage",        0.1,  "V",   False),
    0x0108: ("pv1_current",        0.1,  "A",   False),
    0x0109: ("pv1_power",          1,    "W",   False),
    0x010A: ("pv_total_power",     1,    "W",   False),
    0x010B: ("charge_state",       1,    "",    False),
    0x010F: ("pv2_voltage",        0.1,  "V",   False),  # 0 on single-MPPT units
    0x0210: ("machine_state",      1,    "",    False),
    0x0212: ("dc_bus_voltage",     0.1,  "V",   False),
    0x0213: ("grid_voltage",       0.1,  "V",   False),
    0x0214: ("grid_current",       0.1,  "A",   False),
    0x0215: ("grid_freq",          0.01, "Hz",  False),
    0x0216: ("output_voltage",     0.1,  "V",   False),
    0x0217: ("output_current",     0.1,  "A",   True),
    0x0218: ("output_freq",        0.01, "Hz",  False),
    0x0219: ("load_current",       0.1,  "A",   False),
    0x021B: ("load_power",         1,    "W",   False),
    0x021C: ("load_apparent",      1,    "VA",  False),
    0x021F: ("load_percent",       1,    "%",   False),
    0x0220: ("temp_dcdc",          0.1,  "C",   True),
    0x0221: ("temp_dcac",          0.1,  "C",   True),
    0x0222: ("temp_transformer",   0.1,  "C",   True),
    0x0223: ("temp_ambient",       0.1,  "C",   True),
    0x0224: ("pv_charge_current",  0.1,  "A",   False),
}

CHARGE_STATE = {0:"off",1:"quick",2:"const-V",4:"float",6:"Li-activate",8:"full"}
MACHINE_STATE = {1:"standby",2:"init",3:"soft-start",4:"AC-power",5:"inverter",
                 6:"inv->AC",7:"AC->inv",8:"batt-activate",9:"shutdown",10:"fault"}

# contiguous read blocks (start, count). 0x0100 stops at 16: 0x0110/0x0111 (PV2)
# are illegal on single-MPPT units and would fail the whole request.
BLOCKS = [(0x0100, 16), (0x0210, 0x16)]

def rd(m, addr, count, tries=6):
    for _ in range(tries):
        try:
            return m.read_holding_registers(addr, count)
        except Exception:
            # nudge: a tiny cheap read often clears a transient gateway-busy state
            try:
                m.read_holding_registers(0x0210, 1)
            except Exception:
                pass
    return None

def read_all():
    if not IP or not SERIAL:
        raise RuntimeError("INVERTER_IP and LOGGER_SERIAL must be set (env or powmr.env)")
    m = PySolarmanV5(IP, SERIAL, port=PORT, mb_slave_id=1, socket_timeout=10)
    raw = {}
    for start, count in BLOCKS:
        r = rd(m, start, count)
        if r:
            for i, v in enumerate(r):
                raw[start + i] = v
    # energy block (32-bit little-endian word pairs)
    energy = {}
    e = rd(m, 0xF02C, 0x12)
    if e:
        eb = {0xF02C + i: v for i, v in enumerate(e)}
        energy = {
            "today_pv_kwh":     round(eb.get(0xF02F, 0) * 0.1, 1),
            "today_load_kwh":   round(eb.get(0xF030, 0) * 0.1, 1),
            "today_grid_kwh":   round(eb.get(0xF03D, 0) * 0.1, 1),  # 0xF03D = Today Energy Import (grid buy). 0xF02C is EXPORT (always 0 on this load-only system)
            "today_charge_ah":  eb.get(0xF02D, 0),
            "today_discharge_ah": eb.get(0xF02E, 0),
            "total_charge_ah":  u32_le(eb.get(0xF034, 0), eb.get(0xF035, 0)),
            "total_discharge_ah": u32_le(eb.get(0xF036, 0), eb.get(0xF037, 0)),
            "total_pv_kwh":     round(u32_le(eb.get(0xF038, 0), eb.get(0xF039, 0)) * 0.1, 1),
            "total_load_kwh":   round(u32_le(eb.get(0xF03A, 0), eb.get(0xF03B, 0)) * 0.1, 1),
        }
    try:
        m.disconnect()
    except Exception:
        pass

    out = {}
    for addr, (key, scale, unit, signed) in FIELDS.items():
        if addr not in raw:
            continue
        v = s16(raw[addr]) if signed else raw[addr]
        out[key] = round(v * scale, 3) if scale != 1 else v
    if "charge_state" in out:
        out["charge_state_txt"] = CHARGE_STATE.get(out["charge_state"], "?")
    if "machine_state" in out:
        out["machine_state_txt"] = MACHINE_STATE.get(out["machine_state"], "?")
    # derived: PV total. This SRNE/PowMr firmware leaves 0x010A (pv_total_power)
    # at 0 on single-MPPT units; the real solar power lives in pv1_power (0x0109).
    # Backfill the total from the per-string powers when the reported total is 0.
    if not out.get("pv_total_power"):
        out["pv_total_power"] = out.get("pv1_power", 0) + out.get("pv2_power", 0)
    # derived: battery power, + = charging (flip PDF discharge-positive convention)
    if "battery_voltage" in out and "battery_current" in out:
        out["battery_power"] = round(-out["battery_voltage"] * out["battery_current"], 1)
    out.update(energy)
    return out

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()
    data = read_all()
    if not data:
        print("no data (logger unreachable or busy)", file=sys.stderr)
        sys.exit(1)
    if args.json:
        print(json.dumps(data))
        return
    label = {
        "battery_soc":"Battery SOC","battery_voltage":"Battery V","battery_current":"Battery A (disch+)",
        "battery_power":"Battery W (chg+)","pv1_voltage":"PV1 V","pv1_current":"PV1 A","pv1_power":"PV1 W",
        "pv_total_power":"PV total W","charge_state_txt":"Charge state","machine_state_txt":"Mode",
        "dc_bus_voltage":"DC bus V","grid_voltage":"Grid in V","grid_freq":"Grid Hz",
        "output_voltage":"Output V","output_current":"Output A","output_freq":"Output Hz",
        "load_power":"Load W","load_apparent":"Load VA","load_percent":"Load %",
        "temp_dcdc":"Temp DC-DC","temp_dcac":"Temp DC-AC","temp_transformer":"Temp xfmr","temp_ambient":"Temp amb",
        "today_pv_kwh":"Today PV kWh","today_load_kwh":"Today load kWh","today_grid_kwh":"Today grid kWh",
    }
    for k, lbl in label.items():
        if k in data:
            print(f"  {lbl:<20} {data[k]}")

if __name__ == "__main__":
    main()
