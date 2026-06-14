FROM python:3.13-slim
WORKDIR /app
# Unbuffered stdout/stderr: print() flushes immediately so `docker compose logs
# collector` shows samples live. Without this, CPython block-buffers stdout when
# it isn't a TTY and the logs look dead even while the daemon polls fine.
ENV PYTHONUNBUFFERED=1
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY powmr_poll.py powmr_daemon.py powmr_config_poll.py ./
# Liveness = a fresh poll. The daemon touches a heartbeat file after each
# successful publish; mark unhealthy if it's older than 3 poll intervals.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD ["python", "-c", "import os,time,sys; p=os.environ.get('HEARTBEAT_PATH','/tmp/powmr_daemon.heartbeat'); thr=max(30,int(os.environ.get('POLL_INTERVAL','10'))*3); sys.exit(0 if os.path.exists(p) and time.time()-os.path.getmtime(p)<thr else 1)"]
CMD ["python", "powmr_daemon.py"]
