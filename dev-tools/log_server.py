#!/usr/bin/env python3
"""Raw TCP catch-all logger.

Listens on a port and logs every byte any client sends — timestamp, peer,
length, hex dump, printable ASCII. Never parses, never assumes a protocol.

Purpose: point the PowMr/Solarman datalogger's report target (remote.html
server_b) at this host and see WHAT it sends and HOW OFTEN. The stick speaks
the Solarman V5 binary protocol over raw TCP — NOT HTTP — so this logs raw
bytes rather than HTTP requests.

Usage:
    python log_server.py                 # listen 0.0.0.0:10000, log to tcp_capture.log
    python log_server.py --port 10000 --logfile tcp_capture.log
    python log_server.py --ack           # send a generic Solarman V5 ACK after each frame

Notes:
- Passive by default: it reads and never replies. The stick may then retry /
  reconnect every so often (which itself is useful cadence data). Use --ack to
  keep the stick happy with a best-effort V5 acknowledgement.
- Connection open/close and idle gaps are logged too, so you can measure the
  reporting interval.
"""
import argparse
import datetime
import socket
import struct
import threading

LOCK = threading.Lock()

def now():
    return datetime.datetime.now().isoformat(timespec="milliseconds")

def hexdump(data: bytes) -> str:
    lines = []
    for off in range(0, len(data), 16):
        chunk = data[off:off + 16]
        hexpart = " ".join(f"{b:02x}" for b in chunk)
        asciipart = "".join(chr(b) if 32 <= b < 127 else "." for b in chunk)
        lines.append(f"    {off:04x}  {hexpart:<47}  {asciipart}")
    return "\n".join(lines)

def write(logfile, text):
    line = text + "\n"
    with LOCK:
        print(text, flush=True)
        with open(logfile, "a") as f:
            f.write(line)
            f.flush()

def v5_ack(frame: bytes) -> bytes | None:
    """Best-effort Solarman V5 response so the stick treats the report as accepted.
    Mirrors the request's sequence + logger serial, control 0x1510, status 0x01.
    Not guaranteed correct for every firmware, but usually enough to avoid retries."""
    if len(frame) < 13 or frame[0] != 0xA5:
        return None
    seq = frame[5:7]              # 2-byte sequence
    logger_sn = frame[7:11]       # 4-byte logger serial
    # payload: frame_type(0x02) status(0x01) + 3 timestamps (we echo zeros)
    payload = bytes([0x02, 0x01]) + b"\x00" * 12
    body = struct.pack("<H", 0x1510) + seq + logger_sn + payload
    length = struct.pack("<H", len(payload))
    inner = b"\xa5" + length + body
    checksum = sum(inner[1:]) & 0xFF
    return inner + bytes([checksum, 0x15])

def handle(conn, addr, args):
    peer = f"{addr[0]}:{addr[1]}"
    write(args.logfile, f"\n[{now()}] ── CONNECT {peer} ──")
    last = None
    try:
        conn.settimeout(args.idle_timeout)
        while True:
            try:
                data = conn.recv(65535)
            except socket.timeout:
                write(args.logfile, f"[{now()}] {peer} idle > {args.idle_timeout}s (still open)")
                continue
            if not data:
                break
            t = now()
            gap = ""
            if last is not None:
                gap = f"  (+{(datetime.datetime.fromisoformat(t) - last).total_seconds():.1f}s since prev)"
            last = datetime.datetime.fromisoformat(t)
            write(args.logfile, f"[{t}] {peer}  RECV {len(data)} bytes{gap}\n{hexdump(data)}")
            if args.ack:
                ack = v5_ack(data)
                if ack:
                    conn.sendall(ack)
                    write(args.logfile, f"[{now()}] {peer}  SENT ack {len(ack)} bytes  {ack.hex()}")
    except Exception as e:
        write(args.logfile, f"[{now()}] {peer} error: {e!r}")
    finally:
        conn.close()
        write(args.logfile, f"[{now()}] ── DISCONNECT {peer} ──")

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="0.0.0.0")
    ap.add_argument("--port", type=int, default=10000)
    ap.add_argument("--logfile", default="tcp_capture.log")
    ap.add_argument("--idle-timeout", type=float, default=120.0,
                    help="log a heartbeat if no data for this many seconds")
    ap.add_argument("--ack", action="store_true",
                    help="send a generic Solarman V5 acknowledgement after each frame")
    args = ap.parse_args()

    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind((args.host, args.port))
    srv.listen(8)
    write(args.logfile, f"[{now()}] listening on {args.host}:{args.port}  (ack={'on' if args.ack else 'off'})")
    try:
        while True:
            conn, addr = srv.accept()
            threading.Thread(target=handle, args=(conn, addr, args), daemon=True).start()
    except KeyboardInterrupt:
        write(args.logfile, f"[{now()}] shutting down")
    finally:
        srv.close()

if __name__ == "__main__":
    main()
