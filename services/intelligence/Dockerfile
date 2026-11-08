# syntax=docker/dockerfile:1
# Build context: repository folder `wasl/`
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 WASL_MODELS_DIR=/app/models
WORKDIR /app
# Optional build-time CA certificates (see infrastructure/certs/README.md)
COPY infrastructure/certs/ /usr/local/share/ca-certificates/extra/
RUN update-ca-certificates >/dev/null 2>&1 || true
ENV PIP_CERT=/etc/ssl/certs/ca-certificates.crt
COPY services/intelligence/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY services/intelligence/wasl_intel ./wasl_intel
# Train the experimental models on synthetic data at build time (deterministic seed).
RUN python -m wasl_intel.train --version 2026.11.08-1
RUN useradd -r -u 10001 wasl && chown -R wasl /app
USER wasl
EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:' + __import__('os').environ.get('PORT','8000') + '/health')" || exit 1
ENV PORT=8000 WEB_CONCURRENCY=2
CMD ["sh", "-c", "exec uvicorn wasl_intel.app:app --host 0.0.0.0 --port ${PORT} --workers ${WEB_CONCURRENCY}"]
