FROM node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HYPERFRAMES_BROWSER_PATH=/usr/bin/chromium \
    PRODUCER_LOW_MEMORY_MODE=1 \
    PUPPETEER_SKIP_DOWNLOAD=true \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    HOME=/home/worker \
    TMPDIR=/tmp

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 ffmpeg chromium ca-certificates tini \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 1002 worker \
    && useradd --uid 1002 --gid 1002 --home-dir /home/worker --create-home worker

WORKDIR /app
COPY marketing/content-library/vps/package.json marketing/content-library/vps/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY marketing/content-library/ /app/marketing/content-library/
ENV PATH=/app/node_modules/.bin:$PATH
RUN mkdir -p /spool /tmp /home/worker \
    && chown worker:worker /spool /tmp /home/worker \
    && chromium --version && hyperframes --version
USER 1002:1002
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["python3", "/app/marketing/content-library/renderer/run_renderer.py"]
