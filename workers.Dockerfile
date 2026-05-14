FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml README.md ./
COPY workers ./workers
COPY embed ./embed
COPY scripts ./scripts
COPY data ./data

RUN pip install --upgrade pip setuptools wheel && pip install -e .

# WORKER env decides which module to run (e.g. WORKER=sec_edgar).
# Pass --once via WORKER_ARGS for one-shot Cloud Run Jobs.
ENV WORKER=sec_edgar \
    WORKER_ARGS=""

CMD ["sh", "-c", "python -m workers.${WORKER} ${WORKER_ARGS}"]
