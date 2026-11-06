FROM python:3.12-alpine

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
# The service runs as the host user (AMC_UID), so its files must be
# readable by everyone whatever permissions they had in the build folder.
RUN chmod -R a+rX /app

# HOME: gunicorn writes its control socket there.
ENV AUTH_DATA_DIR=/data \
    HOME=/tmp \
    FLASK_APP=app \
    PYTHONUNBUFFERED=1
EXPOSE 8000

# One process: the failed-login limiter keeps its counters in memory.
CMD ["gunicorn", "-w", "1", "--threads", "8", "-b", "0.0.0.0:8000", "--access-logfile", "-", "app:app"]
