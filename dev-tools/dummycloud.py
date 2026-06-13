#!/usr/bin/env python3
"""Minimal fake Solarman/IGEN V5 'cloud' server.

The LSW logger's *primary* (Server A) slot pushes V5 frames to its cloud. Point
Server A at this server (via the hidden hide_set_edit.html page) and it will:
  - accept the logger's connection,
  - log every pushed frame (type, length, hex, embedded Modbus payload),
  - reply to EVERY frame with the V5 'time response' ACK — without this the
    logger drops the connection and stops streaming.

Frame format reverse-engineered by Hypfer/deye-microinverter-cloud-free.
Request header (little-endian): A5 | len(2) | unknown1 | type | midResp | midReq | loggerSerial(4) | payload... | checksum | 15
Frame types: 0x41 handshake, 0x42 data, 0x43 wifi-info, 0x47 heartbeat.

Usage: python dummycloud.py [--port 10000] [--logfile push_capture.log]
"""
import argparse, datetime, socket, ssl, struct, threading, time

LOCK = threading.Lock()
TYPE_NAME = {0x41: "handshake", 0x42: "data", 0x43: "wifi-info", 0x47: "heartbeat",
             0x48: "0x48", 0x4810: "?"}

def now():
    return datetime.datetime.now().isoformat(timespec="milliseconds")

def hexdump(data, indent="    "):
    out = []
    for off in range(0, len(data), 16):
        chunk = data[off:off+16]
        hx = " ".join(f"{b:02x}" for b in chunk)
        asc = "".join(chr(b) if 32 <= b < 127 else "." for b in chunk)
        out.append(f"{indent}{off:04x}  {hx:<47}  {asc}")
    return "\n".join(out)

def log(logfile, text):
    with LOCK:
        print(text, flush=True)
        with open(logfile, "a") as f:
            f.write(text + "\n")

def checksum(frame_wo_cs_end):
    # sum of all bytes except start(0xA5), the checksum byte, and end(0x15)
    return sum(frame_wo_cs_end[1:]) & 0xFF

def build_time_response(req):
    """V5 ACK / time-sync reply for a pushed frame `req` (full bytes)."""
    rtype = req[4]
    body = bytearray()
    body += b"\xa5"                      # start
    body += struct.pack("<H", 10)        # payload length = 10
    body.append(req[3])                  # unknown1 echoed
    body.append((rtype - 0x30) & 0xFF)   # response type (0x41->0x11 ...)
    body.append((req[5] + 1) & 0xFF)     # midResp + 1
    body.append(req[6])                  # midReq echoed
    body += req[7:11]                    # logger serial echoed
    body.append(req[11] if len(req) > 13 else 0)  # payload[0] echoed
    body.append(0x01)
    body += struct.pack("<I", int(time.time()))   # current unix time
    body += b"\x00\x00\x00\x00"
    body.append(checksum(body))          # checksum over body[1:]
    body.append(0x15)                    # end
    return bytes(body)

def parse_frames(buf):
    """Yield complete V5 frames from buffer; return leftover bytes."""
    frames = []
    i = 0
    while True:
        # resync to start magic
        start = buf.find(0xA5, i)
        if start < 0:
            return frames, b""
        if len(buf) - start < 13:
            return frames, buf[start:]
        plen = struct.unpack("<H", buf[start+1:start+3])[0]
        total = 11 + plen + 2
        if len(buf) - start < total:
            return frames, buf[start:]
        frame = buf[start:start+total]
        if frame[-1] == 0x15:
            frames.append(frame)
            i = start + total
        else:
            i = start + 1  # bad frame, skip this magic

def describe(frame):
    plen = struct.unpack("<H", frame[1:3])[0]
    rtype = frame[4]
    serial = struct.unpack("<I", frame[7:11])[0]
    payload = frame[11:11+plen]
    name = TYPE_NAME.get(rtype, f"0x{rtype:02x}")
    extra = ""
    # data frames embed: frametype(1) status(1) 3x u32 timers, then Modbus RTU
    if rtype == 0x42 and len(payload) > 14:
        mb = payload[14:]
        extra = f"\n    embedded-modbus[{len(mb)}]: {mb.hex()}"
    return name, serial, plen, extra

def handle(conn, addr, args, tls_ctx):
    peer = f"{addr[0]}:{addr[1]}"
    log(args.logfile, f"\n[{now()}] ── CONNECT {peer} ──")
    if tls_ctx is not None:
        try:
            conn = tls_ctx.wrap_socket(conn, server_side=True)
            log(args.logfile, f"[{now()}] {peer} TLS up: {conn.version()} {conn.cipher()[0] if conn.cipher() else '?'}")
        except Exception as e:
            log(args.logfile, f"[{now()}] {peer} TLS handshake FAILED: {e!r}")
            conn.close()
            return
    buf = b""
    last = None
    try:
        conn.settimeout(args.idle_timeout)
        while True:
            try:
                data = conn.recv(65535)
            except socket.timeout:
                log(args.logfile, f"[{now()}] {peer} idle>{args.idle_timeout}s")
                continue
            if not data:
                break
            log(args.logfile, f"[{now()}] {peer} RAW {len(data)}B\n{hexdump(data)}")
            buf += data
            frames, buf = parse_frames(buf)
            for fr in frames:
                t = now()
                gap = ""
                nonlocal_last = last
                if last is not None:
                    gap = f"  (+{(datetime.datetime.fromisoformat(t)-last).total_seconds():.1f}s)"
                last = datetime.datetime.fromisoformat(t)
                name, serial, plen, extra = describe(fr)
                log(args.logfile,
                    f"[{t}] {peer} FRAME {name} sn={serial} payload={plen}B total={len(fr)}B{gap}\n"
                    f"{hexdump(fr)}{extra}")
                if args.ack:
                    ack = build_time_response(fr)
                    conn.sendall(ack)
                    log(args.logfile, f"[{now()}] {peer} ACK {len(ack)}B  {ack.hex()}")
            if buf and len(buf) > 4096:
                log(args.logfile, f"[{now()}] {peer} unparsed {len(buf)}B: {buf[:64].hex()}")
                buf = b""
    except Exception as e:
        log(args.logfile, f"[{now()}] {peer} error: {e!r}")
    finally:
        conn.close()
        log(args.logfile, f"[{now()}] ── DISCONNECT {peer} ──")

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="0.0.0.0")
    ap.add_argument("--port", type=int, default=10000)
    ap.add_argument("--logfile", default="push_capture.log")
    ap.add_argument("--idle-timeout", type=float, default=180.0)
    ap.add_argument("--no-ack", dest="ack", action="store_false")
    ap.add_argument("--tls", action="store_true", help="terminate TLS (logger cloud port is TLS)")
    ap.add_argument("--cert", default="cert.pem")
    ap.add_argument("--key", default="key.pem")
    args = ap.parse_args()
    tls_ctx = None
    if args.tls:
        tls_ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        tls_ctx.load_cert_chain(args.cert, args.key)
        # loggers offer old ciphers; widen acceptance, no client cert
        tls_ctx.minimum_version = ssl.TLSVersion.TLSv1
        try:
            tls_ctx.set_ciphers("ALL:@SECLEVEL=0")
        except ssl.SSLError:
            pass
    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind((args.host, args.port))
    srv.listen(8)
    log(args.logfile, f"[{now()}] V5 dummycloud listening on {args.host}:{args.port} (ack={'on' if args.ack else 'off'}, tls={'on' if args.tls else 'off'})")
    try:
        while True:
            conn, addr = srv.accept()
            threading.Thread(target=handle, args=(conn, addr, args, tls_ctx), daemon=True).start()
    except KeyboardInterrupt:
        pass
    finally:
        srv.close()

if __name__ == "__main__":
    main()
