FROM python:3.13-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY powmr_poll.py powmr_daemon.py powmr_config_poll.py ./
CMD ["python", "powmr_daemon.py"]
