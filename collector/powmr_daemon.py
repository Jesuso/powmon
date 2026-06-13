#!/usr/bin/env python3
"""Poll the PowMr/SRNE inverter on a loop and publish to MQTT with Home Assistant
auto-discovery. Reuses the verified register decode from powmr_poll.py.

Discovery style: DEVICE-BASED (HA 2024.11+) — one retained config message at
homeassistant/device/<node>/config defines the whole device + all entities under
"cmps". Far fewer messages than per-entity discovery, single shared state topic.

State is published NON-retained; each entity carries expire_after so a dead poller
makes entities go "unavailable" instead of showing stale retained values forever.
On the HA birth message (homeassistant/status = "online") the discovery config is
re-announced so entities survive an HA restart. Legacy per-entity config topics
from the old discovery scheme are cleared (empty retained payload) on connect.

Config via env vars (or powmr.env next to the scripts):
    INVERTER_IP  LOGGER_SERIAL          required — see powmr.env.example
    MQTT_HOST (127.0.0.1)  MQTT_PORT (1883)  MQTT_USER  MQTT_PASS
    BASE_TOPIC (solar/inverter)  DISCOVERY_PREFIX (homeassistant)
    POLL_INTERVAL (10)  seconds

Run:
    ./powmr_daemon.py                 # loop forever, publish to MQTT
    ./powmr_daemon.py --dry-run       # print discovery + state payloads, no MQTT
    ./powmr_daemon.py --once          # one publish cycle then exit
"""
import argparse, fcntl, json, os, sys, time, signal

# Re-exec into the project venv if not already under it, so `./powmr_daemon.py`
# works directly (paho/pysolarmanv5 live in .venv, not system python). See
# powmr_config_poll.py for why this compares the invoked path, not realpath.
_VENV_PY = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".venv", "bin", "python")
if (os.path.exists(_VENV_PY)
        and os.path.abspath(sys.executable) != _VENV_PY
        and os.environ.get("_POWMR_REEXEC") != "1"):
    os.environ["_POWMR_REEXEC"] = "1"
    os.execv(_VENV_PY, [_VENV_PY, os.path.abspath(__file__), *sys.argv[1:]])

import paho.mqtt.client as mqtt
from powmr_poll import read_all, CHARGE_STATE, MACHINE_STATE, SERIAL

MQTT_HOST = os.getenv("MQTT_HOST", "127.0.0.1")
MQTT_PORT = int(os.getenv("MQTT_PORT", "1883"))
MQTT_USER = os.getenv("MQTT_USER")
MQTT_PASS = os.getenv("MQTT_PASS")
BASE = os.getenv("BASE_TOPIC", "solar/inverter")
DISC = os.getenv("DISCOVERY_PREFIX", "homeassistant")
INTERVAL = int(os.getenv("POLL_INTERVAL", "10"))
EXPIRE = INTERVAL * 3  # entity -> unavailable after this many seconds without a fresh state
LOCK_PATH = os.getenv("LOCK_PATH", "/tmp/powmr_daemon.lock")

# MQTT node id ties HA entities to this datalogger; derived from the serial so
# two inverters on one broker don't collide.
NODE = f"powmr_{SERIAL}"
STATE_TOPIC = f"{BASE}/state"
AVAIL_TOPIC = f"{BASE}/status"
DEVICE_TOPIC = f"{DISC}/device/{NODE}/config"
STATUS_TOPIC = f"{DISC}/status"  # HA birth/will topic

# device block (abbreviated keys per HA device-based discovery spec)
DEV = {
    "ids": [NODE],
    "name": "PowMr Inverter",
    "mf": "PowMr / SRNE",
    "mdl": "SR-240618 (48V hybrid)",
    "sw": "SR-240618-0143-301",
}
ORIGIN = {"name": "powmr_daemon", "sw": "2.0"}

# field -> (friendly name, unit, device_class, state_class)
M = "measurement"; TI = "total_increasing"
SENSORS = {
    "battery_soc":      ("Battery SOC", "%", "battery", M),
    "battery_voltage":  ("Battery Voltage", "V", "voltage", M),
    "battery_current":  ("Battery Current", "A", "current", M),
    "battery_power":    ("Battery Power (+ = charging)", "W", "power", M),
    "battery_temp":     ("Battery Temp", "°C", "temperature", M),
    "pv1_voltage":      ("PV1 Voltage", "V", "voltage", M),
    "pv1_current":      ("PV1 Current", "A", "current", M),
    "pv1_power":        ("PV1 Power", "W", "power", M),
    "pv_total_power":   ("PV Total Power", "W", "power", M),
    "pv_charge_current":("PV Charge Current", "A", "current", M),
    "pv2_voltage":      ("PV2 Voltage", "V", "voltage", M),
    "dc_bus_voltage":   ("DC Bus Voltage", "V", "voltage", M),
    "grid_voltage":     ("Grid Voltage", "V", "voltage", M),
    "grid_current":     ("Grid Current", "A", "current", M),
    "grid_freq":        ("Grid Frequency", "Hz", "frequency", M),
    "output_voltage":   ("Output Voltage", "V", "voltage", M),
    "output_current":   ("Output Current", "A", "current", M),
    "output_freq":      ("Output Frequency", "Hz", "frequency", M),
    "load_current":     ("Load Current", "A", "current", M),
    "load_power":       ("Load Power", "W", "power", M),
    "load_apparent":    ("Load Apparent Power", "VA", "apparent_power", M),
    "load_percent":     ("Load Percent", "%", None, M),
    "temp_dcdc":        ("Temp DC-DC", "°C", "temperature", M),
    "temp_dcac":        ("Temp DC-AC", "°C", "temperature", M),
    "temp_transformer": ("Temp Transformer", "°C", "temperature", M),
    "temp_ambient":     ("Temp Ambient", "°C", "temperature", M),
    "charge_state_txt": ("Charge State", None, None, None),
    "machine_state_txt":("Mode", None, None, None),
    "today_pv_kwh":     ("Today PV Energy", "kWh", "energy", TI),
    "today_load_kwh":   ("Today Load Energy", "kWh", "energy", TI),
    "today_grid_kwh":   ("Today Grid Energy", "kWh", "energy", TI),
    "today_charge_ah":  ("Today Charge", "Ah", None, TI),
    "today_discharge_ah":("Today Discharge", "Ah", None, TI),
    "total_pv_kwh":     ("Total PV Energy", "kWh", "energy", TI),
    "total_load_kwh":   ("Total Load Energy", "kWh", "energy", TI),
    "total_charge_ah":  ("Total Charge", "Ah", None, TI),
    "total_discharge_ah":("Total Discharge", "Ah", None, TI),
}

# enum text sensors: device_class enum + fixed option list (decoder dict values + "?" fallback)
ENUMS = {
    "charge_state_txt":  sorted(set(CHARGE_STATE.values())) + ["?"],
    "machine_state_txt": sorted(set(MACHINE_STATE.values())) + ["?"],
}
# internal device health, not primary cooling-loop data -> grouped/excluded from auto dashboards
DIAGNOSTIC = {
    "temp_dcdc", "temp_dcac", "temp_transformer", "temp_ambient",
    "charge_state_txt", "machine_state_txt", "load_percent",
    "grid_freq", "output_freq", "dc_bus_voltage",
}

def precision_for(unit):
    """suggested display decimals — display only, statistics keep full precision."""
    return {"V": 1, "A": 1, "°C": 1, "Hz": 2, "kWh": 1,
            "W": 0, "VA": 0, "%": 0, "Ah": 0}.get(unit)

def component(field):
    """One entry in the device-discovery 'cmps' map for a field."""
    name, unit, dclass, sclass = SENSORS[field]
    c = {
        "p": "sensor",
        "name": name,
        "unique_id": f"{NODE}_{field}",
        "value_template": f"{{{{ value_json.{field} }}}}",
        "expire_after": EXPIRE,
    }
    if field in ENUMS:
        c["device_class"] = "enum"
        c["options"] = ENUMS[field]          # enum sensors: no unit, no state_class
    else:
        if unit:   c["unit_of_measurement"] = unit
        if dclass: c["device_class"] = dclass
        if sclass: c["state_class"] = sclass
        p = precision_for(unit)
        if p is not None: c["suggested_display_precision"] = p
    if field in DIAGNOSTIC:
        c["entity_category"] = "diagnostic"
    return c

def device_payload():
    """Single device-based discovery config: device + origin + all components."""
    return {
        "dev": DEV,
        "o": ORIGIN,
        "state_topic": STATE_TOPIC,
        "availability_topic": AVAIL_TOPIC,
        "payload_available": "online",
        "payload_not_available": "offline",
        "cmps": {field: component(field) for field in SENSORS},
    }

def clear_legacy_discovery(client):
    """Remove old per-entity retained config topics (pre-device-discovery scheme)."""
    for field in SENSORS:
        client.publish(f"{DISC}/sensor/{NODE}/{field}/config", "", retain=True)

def announce(client):
    clear_legacy_discovery(client)
    client.publish(DEVICE_TOPIC, json.dumps(device_payload()), retain=True)
    client.publish(AVAIL_TOPIC, "online", retain=True)

def on_connect(client, userdata, flags, rc, props=None):
    if rc != 0:
        print(f"[mqtt] connect failed rc={rc}", file=sys.stderr); return
    print(f"[mqtt] connected {MQTT_HOST}:{MQTT_PORT}")
    client.subscribe(STATUS_TOPIC)  # HA birth message -> re-announce after HA restart
    announce(client)

def on_message(client, userdata, msg):
    if msg.topic == STATUS_TOPIC and msg.payload.decode(errors="ignore").lower() == "online":
        print("[mqtt] HA birth -> re-announcing discovery")
        announce(client)

def acquire_singleton_lock():
    """Refuse to start if another daemon instance is already running.
    The Solarman stick allows ONE TCP client; two daemons -> poll contention (recurring footgun)."""
    fd = open(LOCK_PATH, "w")
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        print(f"[lock] another daemon holds {LOCK_PATH}; exiting (stick allows one client)", file=sys.stderr)
        sys.exit(3)
    fd.write(str(os.getpid())); fd.flush()
    return fd  # caller keeps the fd open for the process lifetime

def make_client():
    c = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=NODE)
    if MQTT_USER:
        c.username_pw_set(MQTT_USER, MQTT_PASS)
    c.will_set(AVAIL_TOPIC, "offline", retain=True)
    c.on_connect = on_connect
    c.on_message = on_message
    # async connect + auto-reconnect: tolerate broker not up yet at boot, or a mid-run Mosquitto restart
    c.reconnect_delay_set(min_delay=1, max_delay=30)
    c.connect_async(MQTT_HOST, MQTT_PORT, keepalive=60)
    c.loop_start()
    return c

def run(dry_run=False, once=False):
    lock = None if dry_run else acquire_singleton_lock()  # noqa: F841 (held for process lifetime)
    client = None if dry_run else make_client()
    if dry_run:
        print("=== DISCOVERY ===", DEVICE_TOPIC)
        print(json.dumps(device_payload(), indent=2))
    stop = {"v": False}
    signal.signal(signal.SIGTERM, lambda *_: stop.update(v=True))
    signal.signal(signal.SIGINT, lambda *_: stop.update(v=True))
    while not stop["v"]:
        try:
            data = read_all()
        except Exception as e:
            print(f"[poll] error: {e}", file=sys.stderr); data = None
        if data:
            payload = json.dumps(data)
            if dry_run:
                print("=== STATE ===\n", payload)
            else:
                client.publish(STATE_TOPIC, payload, retain=False)  # expire_after handles staleness
                print(f"[pub] {STATE_TOPIC} soc={data.get('battery_soc')} "
                      f"pv={data.get('pv_total_power')}W load={data.get('load_power')}W")
        else:
            print("[poll] no data (stick busy?)", file=sys.stderr)
        if once or dry_run:
            break
        for _ in range(INTERVAL):  # interruptible sleep
            if stop["v"]: break
            time.sleep(1)
    if client:
        client.publish(AVAIL_TOPIC, "offline", retain=True)
        client.loop_stop(); client.disconnect()
    print("stopped")

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="print payloads, no MQTT")
    ap.add_argument("--once", action="store_true", help="one cycle then exit")
    a = ap.parse_args()
    if not SERIAL:
        sys.exit("LOGGER_SERIAL not set (env or powmr.env) — refusing to announce a bogus device id")
    run(dry_run=a.dry_run, once=a.once)
