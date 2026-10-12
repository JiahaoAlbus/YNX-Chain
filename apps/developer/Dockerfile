# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS build
WORKDIR /workspace
COPY package.json package-lock.json ./
COPY packages/developer-client ./packages/developer-client
COPY assets/brand/ynx-logo.png ./assets/brand/ynx-logo.png
COPY apps/developer ./apps/developer
RUN npm ci --ignore-scripts && cd apps/developer && npm ci --ignore-scripts && npm run code:build

FROM node:22-bookworm-slim
ARG SOURCE_COMMIT
ARG RUNTIME_CHECKPOINT
LABEL org.opencontainers.image.title="YNX Code Server" \
      org.opencontainers.image.source="https://github.com/JiahaoAlbus/YNX-Chain" \
      org.opencontainers.image.revision=$SOURCE_COMMIT \
      io.ynx.runtime-checkpoint=$RUNTIME_CHECKPOINT \
      io.ynx.artifact-class="unsigned-testnet-preview"
RUN apt-get update && apt-get install -y --no-install-recommends \
      bubblewrap ca-certificates coreutils curl default-jdk-headless g++ git golang-go \
      make python3 rustc cargo tini util-linux && \
    rm -rf /var/lib/apt/lists/* && \
    groupadd --gid 10001 ynx && useradd --uid 10001 --gid 10001 --create-home --home-dir /var/lib/ynx-code --shell /usr/sbin/nologin ynx
WORKDIR /opt/ynx-code/app
COPY --from=build /workspace/apps/developer ./
# Install scripts stay disabled during dependency resolution. Rebuild the single
# reviewed native terminal dependency explicitly for the Linux runtime image.
RUN npm rebuild node-pty --build-from-source --foreground-scripts && \
    chown -R ynx:ynx /opt/ynx-code /var/lib/ynx-code
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4190 \
    YNX_CODE_STATIC_ROOT=/opt/ynx-code/app/frontend/dist \
    YNX_CODE_STATE_DIR=/var/lib/ynx-code
EXPOSE 4190
USER 10001:10001
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "services/gateway/src/server.mjs"]
