#!/usr/bin/env python3
"""Discover the PowMr/SRNE inverter CONFIG/SETPOINT registers (0xE0xx block).

Read-only sweep of the config register space to locate the writable setpoints
that drive grid<->battery switching and charging — e.g. the back-to-grid and
back-to-battery voltage points the inverter actually switches on. We do NOT
write anything (fn 0x03 only); discovery is purely observational.

Why this exists: those setpoints are config, not telemetry, so they're not in
our historian. Hardcoding them would drift the moment you retune the inverter.
The fix is to READ them from the device. This script finds the addresses; once
known, the daemon can poll them into a small append-on-change config table.

Coexists with the production daemon on the Pi (single-TCP-client stick): it
retries into the gaps between the daemon's ~10s polls, and a "nudge" read of a
known-valid register (0x0210) distinguishes an illegal address (nudge OK, target
fails) from link contention (nudge also fails -> back off and retry).

Scaling note: SRNE stores setpoint voltages normalized to a 12V base. On this
48V bank, ACTUAL = stored x 4. So a 54.8V actual point reads ~13.7 (x0.1) ->
raw 137; a 48.0V point -> raw 120. The script prints several candidate scalings
per register so you can match them against the inverter's config screen.

Usage:
    ./powmr_config_poll.py                 # sweep known blocks E0xx+E1xx+E2xx (default)
    ./powmr_config_poll.py --start E000 --end E0A0
    ./powmr_config_poll.py --ip 192.168.1.50
    ./powmr_config_poll.py --raw           # dump every register, no filtering
    ./powmr_config_poll.py --save          # upsert confirmed setpoints into app DB
    ./powmr_config_poll.py --save --db /path/to/dashboard/data.db

Then read the device's setpoint screen and match the highlighted candidates.
"""
import os
import sys

# Re-exec into the project venv if not already under it, so `./powmr_config_poll.py`
# works directly (pysolarmanv5 lives in .venv, not system python). Compare the INVOKED
# path, not realpath: a venv whose python symlinks to the system interpreter collapses
# to the same realpath, which would wrongly skip the re-exec and miss venv site-packages.
# Env sentinel guards against any exec loop.
_VENV_PY = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".venv", "bin", "python")
if (os.path.exists(_VENV_PY)
        and os.path.abspath(sys.executable) != _VENV_PY
        and os.environ.get("_POWMR_REEXEC") != "1"):
    os.environ["_POWMR_REEXEC"] = "1"
    os.execv(_VENV_PY, [_VENV_PY, os.path.abspath(__file__), *sys.argv[1:]])

import argparse
import sqlite3
import time

from pysolarmanv5 import PySolarmanV5

# Reuse the verified connection params from the telemetry poller.
from powmr_poll import IP as DEFAULT_IP, SERIAL, PORT

NUDGE_REG = 0x0210  # known-valid (machine_state); used to probe link liveness

# Register -> label. Names from the SRNE Modbus V2.07 protocol PDF (link in
# SOURCES.md, P05 battery / P06 inverter setting areas), cross-checked
# against the SP5K manual §5.2, the device LCD, and perturbation tests
# (2026-06-08..10); see srne_config_registers.md. Voltages in the E0xx battery
# block decode x0.4 (12V-normalized, x4 for 48V bank); E2xx voltages/currents
# are x0.1, frequency x0.01. [nn] = LCD menu number. CONFIRMED = perturbation-
# verified; the rest match protocol name + device value.
CONFIG_LABELS = {
    # --- P05 battery params (0xE0xx) ---
    0xE000: "BatParmReserved0",
    0xE001: "[36] PvChgCurrSet = Max PV Charge Current (x0.1 A) CONFIRMED",
    0xE002: "BatRateCap (Ah, x1)",
    0xE003: "BatRateVolt (V, x1)",
    0xE004: "[08] BatTypeSet enum (0=user,1=SLD,2=FLD,3=GEL,4+=Li)",
    0xE005: "BatOverVolt = charge OV protection (x0.4)",
    0xE006: "BatChgLimitVolt = over-charge protection (x0.4) -- NOT [09]",
    0xE007: "[17] BatConstChgVolt = Equalize V (x0.4) CONFIRMED",
    0xE008: "[09] BatImprovChgVolt = Boost V (x0.4) CONFIRMED -- USER-mode [09] "
            "write clamps E007/E009 down to it",
    0xE009: "[11] BatFloatChgVolt = Float V (x0.4)",
    0xE00A: "[37] BatImprovChgBackVolt = Battery Recharge V (x0.4) CONFIRMED",
    0xE00B: "[35] BatOverDischgBackVolt = Under-V Recovery (x0.4) CONFIRMED",
    0xE00C: "[14] BatUnderVolt = Under-V alarm (x0.4)",
    0xE00D: "[12] BatOverDischgVolt = Over-discharge V (x0.4)",
    0xE00E: "[15] BatDischgLimitVolt = Discharge Limit V (x0.4)",
    0xE00F: "BatStopSOC = discharge cut-off SOC (%)",
    0xE010: "[13] BatOverDischgDelayTime (s)",
    0xE011: "[18] BatConstChgTime = Equalize Time (min) CONFIRMED",
    0xE012: "[10] BatImprovChgTime = Max Boost Duration (min) CONFIRMED",
    0xE013: "[20] BatConstChgGapTime = Equalize Interval (days) CONFIRMED",
    0xE014: "CoeffTemperCompen (mV/C/2cell)",
    0xE015: "ChgMaxTemper (C)",
    0xE016: "ChgMinTemper (C, signed)",
    0xE017: "DisChgMaxTemper (C)",
    0xE018: "DisChgMinTemper (C, signed)",
    0xE019: "HeatBatStartTemper (C)",
    0xE01A: "HeatBatStopTemper (C)",
    0xE01B: "[04] BatSwitchDcVolt = Batt->Mains (x0.4) CONFIRMED",
    0xE01C: "[57] StopChgCurrSet = charge tail current (x0.1 A)",
    0xE01D: "StopChgSocSet (%) -- NOT [15] (old ha-solarman label was wrong)",
    0xE01E: "BatSocLowAlarm (%)",
    0xE01F: "BatSocSwToLine (%) (ha-solarman Discharge STOP)",
    0xE020: "BatSocSwToBatt (%) (ha-solarman Discharge START)",
    0xE021: "BatDischgMaxCurrSet (x0.1 A?)",
    0xE022: "[05] BattVoltSwToInv = Mains->Battery (x0.4) CONFIRMED",
    0xE023: "[19] BattEqualChgTimeout = Equalize Delay (min) CONFIRMED",
    0xE024: "LiBattActiveCurrSet (x0.1 A) -- NOT [28]",
    0xE025: "BMSChgLCMode",
    # 0xE026-0xE033: timed charge/discharge windows + enables ([40]-[53])
    # --- P06 inverter params (0xE2xx) ---
    0xE200: "[30] Rs485AddrSet",
    0xE201: "ParallMode",
    0xE202: "PassWordSet (W)",
    0xE203: "PassWordInput (W)",
    0xE204: "[01] OutputPriority enum (0=SOL/PV1ST, 1=UTI, 2=SBU)",
    0xE205: "[28] IbattLineChgLimit = Grid Charge Current (x0.1 A)",
    0xE206: "[16] BattEqualChgEnable (1=ENA)",
    0xE207: "[63] N_G_FuncEn",
    0xE208: "[38] OutputVoltSet (x0.1 V)",
    0xE209: "[02] OutputFreqSet (x0.01 Hz)",
    0xE20A: "[07] MaxChgCurr = total Max Charging Current (x0.1 A)",
    0xE20B: "[03] AcVoltRange (0=APL, 1=UPS)",
    0xE20C: "[22] PowerSavingMode = ECO",
    0xE20D: "[23] AutoRestartOvLoad",
    0xE20E: "[24] AutoRestartOvTemper",
    0xE20F: "[06] ChgSourcePriority (3=ONLY PV)",
    0xE210: "[25] AlarmEnable = buzzer",
    0xE211: "[26] AlarmEnWhenSourceLoss",
    0xE212: "[27] BypEnableWhenOvLoad",
    0xE213: "RecordFaultEnable",
    0xE214: "BmsErrStopEnable",
    0xE215: "BmsCommEnable",
    0xE21B: "[32]? Rs485BmsProtocol",
    0xE21E: "[31] OutputPhaseSet",
    # [21] Equalize Start-Stop = 0xDF0D BattEqualChgImmediate (WRITE-ONLY command)
}


def s16(v):
    """Interpret a 16-bit register as signed."""
    return v - 0x10000 if v >= 0x8000 else v


def connect(ip, tries=8):
    """Open a Solarman V5 session, retrying through daemon contention."""
    for attempt in range(tries):
        try:
            print(f"  connecting to {ip}:{PORT} (attempt {attempt + 1}/{tries})...",
                  file=sys.stderr, flush=True)
            return PySolarmanV5(ip, SERIAL, port=PORT, mb_slave_id=1, socket_timeout=6)
        except Exception as e:
            wait = 1.5 * (attempt + 1)
            print(f"  connect failed ({e}); retry in {wait:.0f}s", file=sys.stderr, flush=True)
            time.sleep(wait)
    return None


def read_reg(m, addr, tries=6):
    """Read one holding register. Returns (value, status).

    status: 'ok' | 'illegal' (addr rejected, link healthy) | 'busy' (link contended)
    """
    for _ in range(tries):
        try:
            return m.read_holding_registers(addr, 1)[0], "ok"
        except Exception:
            # Is the link alive? A cheap read of a known-valid reg tells us.
            try:
                m.read_holding_registers(NUDGE_REG, 1)
                return None, "illegal"   # nudge worked -> target addr is the problem
            except Exception:
                time.sleep(0.4)          # nudge failed too -> contention; back off, retry
    return None, "busy"


def read_block(m, start, count):
    """Try a fast block read; fall back to per-register so one illegal
    address doesn't sink the whole block. Returns {addr: (value, status)}."""
    try:
        regs = m.read_holding_registers(start, count)
        return {start + i: (v, "ok") for i, v in enumerate(regs)}
    except Exception:
        out = {}
        for addr in range(start, start + count):
            out[addr] = read_reg(m, addr)
        return out


def scalings(raw):
    """Candidate physical interpretations of a raw register value."""
    sv = s16(raw)
    return {
        "x0.1": raw * 0.1,            # direct 0.1V (no normalization)
        "x0.01": raw * 0.01,          # direct 0.01V
        "x0.4 (12V->48V)": raw * 0.4,  # 0.1V stored, x4 for 48V bank
        "x0.04": raw * 0.04,          # 0.01V stored, x4 for 48V bank
        "signed": sv,
    }


def is_voltage_candidate(raw):
    """Flag values that land in a plausible 48V-bank setpoint window (40-60V)
    under any common scaling."""
    hits = []
    if 90 <= raw <= 160:                 # x0.4 -> 36..64 V (12V-normalized, x0.1 store)
        hits.append(f"x0.4={raw*0.4:.1f}V")
    if 400 <= raw <= 600:                # x0.1 -> 40..60 V
        hits.append(f"x0.1={raw*0.1:.1f}V")
    if 4000 <= raw <= 6000:              # x0.01 -> 40..60 V
        hits.append(f"x0.01={raw*0.01:.1f}V")
    return hits


def matches_target(raw, target, tol=0.3):
    """True if any scaling of raw is within tol of target volts."""
    for v in (raw * 0.4, raw * 0.1, raw * 0.01, raw * 0.04):
        if abs(v - target) <= tol:
            return True
    return False


# Curated setpoints worth surfacing in the app. EACH maps to a UNIQUE register whose
# value we verified against the device LCD + manual §5.2, or by perturbation test
# (see srne_config_registers.md). Never snapshot a value we can't attribute to a
# single register. Voltages are x0.4 (12V-normalized); durations are raw minutes.
SNAPSHOT_REGS = [
    # key,                 param, name,                       unit, scale, reg
    ("output_priority",     1,  "Supply Priority (0=SOL)",     "", 1.0, 0xE204),
    ("battery_to_mains_v",  4,  "Battery -> Mains (bypass)",  "V", 0.4, 0xE01B),
    ("mains_to_battery_v",  5,  "Mains -> Battery (release)", "V", 0.4, 0xE022),
    ("charge_priority",     6,  "Charging Mode (3=ONLY PV)",   "", 1.0, 0xE20F),
    ("max_charge_a",        7,  "Max Charging Current",       "A", 0.1, 0xE20A),
    ("boost_v",             9,  "Boost Voltage",              "V", 0.4, 0xE008),
    ("boost_duration_min",  10, "Max Boost Duration",       "min", 1.0, 0xE012),
    ("float_v",             11, "Float Charge Voltage",       "V", 0.4, 0xE009),
    ("overdischarge_v",     12, "Over-discharge Voltage",     "V", 0.4, 0xE00D),
    ("undervolt_alarm_v",   14, "Under-voltage Alarm",        "V", 0.4, 0xE00C),
    ("discharge_limit_v",   15, "Discharge Limit Voltage",    "V", 0.4, 0xE00E),
    ("equalize_enable",     16, "Equalization Charge (1=ENA)", "", 1.0, 0xE206),
    ("equalize_v",          17, "Equalization Voltage",       "V", 0.4, 0xE007),
    ("equalize_time_min",   18, "Equalization Time",        "min", 1.0, 0xE011),
    ("equalize_delay_min",  19, "Equalize Charging Delay",  "min", 1.0, 0xE023),
    ("equalize_interval_d", 20, "Equalize Interval",        "day", 1.0, 0xE013),
    ("grid_charge_a",       28, "Grid Charge Current",        "A", 0.1, 0xE205),
    ("under_v_recovery_v",  35, "Under-V Recovery",           "V", 0.4, 0xE00B),
    ("max_pv_charge_a",     36, "Max PV Charger Current",     "A", 0.1, 0xE001),
    ("battery_recharge_v",  37, "Battery Recharge Voltage",   "V", 0.4, 0xE00A),
    ("tail_current_a",      57, "Charge Tail Current cutoff", "A", 0.1, 0xE01C),
]

DDL = """
CREATE TABLE IF NOT EXISTS config (
  key   TEXT PRIMARY KEY,
  param INTEGER,
  reg   INTEGER,
  name  TEXT,
  raw   INTEGER,
  value REAL,
  unit  TEXT,
  ts    INTEGER
);
CREATE TABLE IF NOT EXISTS config_history (
  ts     INTEGER,
  key    TEXT,
  old    REAL,
  new    REAL,
  source TEXT,
  PRIMARY KEY (ts, key)
);
"""


def snapshot(ip, db_path):
    """Read the curated confirmed setpoints from the inverter (fn 0x03, read-only)
    and upsert them into the app DB. The ONLY writes here are to our own SQLite —
    nothing is written back to the inverter."""
    m = connect(ip)
    if not m:
        print("Could not open a session (stick busy or offline). Try again.", file=sys.stderr)
        sys.exit(1)
    rows = []
    try:
        for key, param, name, unit, scale, reg in SNAPSHOT_REGS:
            raw, st = read_reg(m, reg)
            if st != "ok":
                print(f"  skip {key} (0x{reg:04X}): {st}", file=sys.stderr)
                continue
            rows.append((key, param, reg, name, raw, round(raw * scale, 1), unit))
    finally:
        try:
            m.disconnect()
        except Exception:
            pass

    if not rows:
        print("No setpoints read (stick contended?). Nothing written.", file=sys.stderr)
        sys.exit(1)

    ts_ms = int(time.time() * 1000)
    con = sqlite3.connect(db_path, timeout=5.0)
    try:
        con.execute("PRAGMA busy_timeout=5000")
        con.executescript(DDL)
        changes = []
        for key, param, reg, name, raw, value, unit in rows:
            prev = con.execute("SELECT value FROM config WHERE key=?", (key,)).fetchone()
            old = prev[0] if prev else None
            if old is None or old != value:
                con.execute(
                    "INSERT OR IGNORE INTO config_history(ts, key, old, new, source) "
                    "VALUES (?,?,?,?, 'snapshot')",
                    (ts_ms, key, old, value),
                )
                changes.append((key, old, value))
            con.execute(
                "INSERT INTO config(key, param, reg, name, raw, value, unit, ts) "
                "VALUES (?,?,?,?,?,?,?,?) "
                "ON CONFLICT(key) DO UPDATE SET "
                "param=excluded.param, reg=excluded.reg, name=excluded.name, "
                "raw=excluded.raw, value=excluded.value, unit=excluded.unit, ts=excluded.ts",
                (key, param, reg, name, raw, value, unit, ts_ms),
            )
        con.commit()
    finally:
        con.close()

    print(f"Saved {len(rows)} setpoints -> {db_path}")
    for key, param, reg, name, raw, value, unit in rows:
        print(f"  [{param:>2}] {name:28} = {value:>6} {unit:<3} (0x{reg:04X} raw {raw})")
    if changes:
        print("\nchanged since last snapshot:")
        for key, old, new in changes:
            print(f"  {key}: {old} -> {new}")
    else:
        print("\n(no changes since last snapshot)")
    print("\nNot snapshotted: [21] equalize trigger (0xDF0D, write-only command), "
          "timed charge/discharge windows (0xE026-0xE033).")


def main():
    ap = argparse.ArgumentParser(description="Discover SRNE/PowMr config setpoint registers (read-only).")
    ap.add_argument("--start", default=None, help="start address, hex (e.g. E000)")
    ap.add_argument("--end", default=None, help="end address exclusive, hex (e.g. E060)")
    ap.add_argument("--ip", default=DEFAULT_IP, help=f"datalogger IP (default {DEFAULT_IP})")
    ap.add_argument("--raw", action="store_true", help="print every readable register, no filtering")
    ap.add_argument("--block", type=int, default=8, help="block read size (default 8)")
    ap.add_argument("--save", action="store_true",
                    help="read curated confirmed setpoints and upsert into the app DB (read-only vs inverter)")
    ap.add_argument("--db", default=None,
                    help="app SQLite DB path (default: <repo>/dashboard/data.db)")
    args = ap.parse_args()

    if args.save:
        db = args.db or os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "dashboard", "data.db")
        snapshot(args.ip, db)
        return

    # Default: sweep the three known-live config blocks (battery E0xx, factory
    # calibration E1xx, inverter E2xx) and skip the dead gaps between them.
    if args.start or args.end:
        blocks = [(int(args.start or "E000", 16), int(args.end or "E060", 16))]
    else:
        blocks = [(0xE000, 0xE060), (0xE100, 0xE132), (0xE200, 0xE220)]
    span = ", ".join(f"0x{s:04X}..0x{e - 1:04X}" for s, e in blocks)
    print(f"Sweeping {span} on {args.ip} (read-only). "
          f"Daemon may stay running.", flush=True)

    m = connect(args.ip)
    if not m:
        print("Could not open a session (stick busy or offline). Try again.", file=sys.stderr)
        sys.exit(1)

    results = {}
    try:
        for start, end in blocks:
            addr = start
            while addr < end:
                count = min(args.block, end - addr)
                results.update(read_block(m, addr, count))
                addr += count
    finally:
        try:
            m.disconnect()
        except Exception:
            pass

    ok = {a: v for a, (v, st) in results.items() if st == "ok"}
    illegal = sorted(a for a, (v, st) in results.items() if st == "illegal")
    busy = sorted(a for a, (v, st) in results.items() if st == "busy")

    # Full readable table
    print(f"{'addr':>7}  {'raw':>6}  {'x0.1':>7}  {'x0.01':>7}  {'x0.4':>7}  {'signed':>7}  notes")
    print("-" * 78)
    candidates = []
    for a in sorted(ok):
        raw = ok[a]
        sc = scalings(raw)
        label = CONFIG_LABELS.get(a, "")        # known manual-param mapping wins
        volt_hits = is_voltage_candidate(raw)
        if volt_hits:
            candidates.append((a, raw, volt_hits))
        if label:
            note = label
        elif volt_hits:
            note = "?? VOLT " + " ".join(volt_hits)
        elif 0 < raw <= 100:
            note = "?? 0-100 (SoC% / count / Amps?)"
        else:
            note = ""
        # Surface the x0.4-volt vs x1-duration/current collisions even on unlabeled regs.
        if not label and raw in (120, 130, 230):
            note += f"  <COLLISION raw{raw}: {raw * 0.4:.1f}V or {raw}min/A>"
        if args.raw or note:
            print(f"0x{a:04X}  {raw:>6}  {sc['x0.1']:>7.1f}  {sc['x0.01']:>7.2f}  "
                  f"{sc['x0.4 (12V->48V)']:>7.1f}  {sc['signed']:>7}  {note}")

    # Focused guesses for the two points you named
    print("\n--- candidates for your named setpoints ---")
    for label, target in (("back-to-grid ~48.0V", 48.0), ("back-to-battery ~54.8V", 54.8)):
        hits = [f"0x{a:04X} (raw {ok[a]})" for a in sorted(ok) if matches_target(ok[a], target)]
        print(f"  {label:24}: {', '.join(hits) if hits else '(no match in swept range — widen --end)'}")

    print(f"\nreadable: {len(ok)}  illegal: {len(illegal)}  busy/unread: {len(busy)}")
    if illegal:
        print("illegal addrs:", ", ".join(f"0x{a:04X}" for a in illegal))
    if busy:
        print("busy (retry later):", ", ".join(f"0x{a:04X}" for a in busy))
    print("\nNext: open the inverter's setpoint screen, find the register whose "
          "scaling matches each value, and lock the address.")


if __name__ == "__main__":
    main()
