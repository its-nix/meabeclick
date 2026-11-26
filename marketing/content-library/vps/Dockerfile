FROM node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HYPERFRAMES_BROWSER_PATH=/usr/bin/chromium \
    PRODUCER_LOW_MEMORY_MODE=1 \
    PUPPETEER_SKIP_DOWNLOAD=true \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    HOME=/home/worker \
    XDG_CACHE_HOME=/state/cache \
    CODEX_HOME=/state/codex \
    CONTENT_MACHINE_STATE=/state

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 ffmpeg chromium ca-certificates tini \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 1002 worker \
    && useradd --uid 1002 --gid 1002 --home-dir /home/worker --create-home worker

WORKDIR /app
COPY marketing/content-library/vps/package.json marketing/content-library/vps/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund \
    && npm cache clean --force
COPY marketing/content-library/ /app/marketing/content-library/
COPY mea-beclick-kb/ /app/mea-beclick-kb/
ENV PATH=/app/node_modules/.bin:$PATH
RUN mkdir -p /state /run/config /run/secrets \
    && chown worker:worker /state \
    && python3 --version && ffmpeg -version >/dev/null \
    && chromium --version && hyperframes --version && codex --version
USER 1002:1002
ENTRYPOINT ["/usr/bin/tini", "--", "python3", "/app/marketing/content-library/vps/run-worker.py"]
CMD ["--config", "/run/config/machine.json"]
