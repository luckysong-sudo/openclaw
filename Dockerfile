FROM ghcr.io/openclaw/openclaw:latest

USER root

RUN if command -v apt-get >/dev/null 2>&1; then \
      apt-get update \
      && apt-get install -y --no-install-recommends curl ca-certificates \
      && rm -rf /var/lib/apt/lists/*; \
    elif command -v apk >/dev/null 2>&1; then \
      apk add --no-cache curl ca-certificates; \
    elif command -v microdnf >/dev/null 2>&1; then \
      microdnf install -y curl ca-certificates && microdnf clean all; \
    else \
      echo 'WARNING: no supported package manager found; continuing without installing curl'; \
    fi \
    && mkdir -p /data/openclaw /home/node/.openclaw /home/node/.config/openclaw \
    && chown -R node:node /data /home/node/.openclaw /home/node/.config/openclaw

COPY --chown=node:node start-openclaw.sh /app/start-openclaw.sh
RUN chmod 755 /app/start-openclaw.sh

USER node

ENV HOME=/home/node
ENV PORT=7860
ENV OPENCLAW_SPACE_PORT=7860
ENV OPENCLAW_GATEWAY_INTERNAL_PORT=18789
ENV OPENCLAW_GATEWAY_BIND=lan
ENV OPENCLAW_DISABLE_BONJOUR=1
ENV OPENCLAW_PROVIDER_ID=agnes
ENV OPENCLAW_MODEL_ID=agnes-2.0-flash
ENV AGNES_BASE_URL=https://apihub.agnes-ai.com/v1
ENV OPENCLAW_DISABLE_DEVICE_PAIRING=true
ENV TZ=Asia/Shanghai

EXPOSE 7860

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT:-7860}/__proxy_health" || exit 1

CMD ["/app/start-openclaw.sh"]
