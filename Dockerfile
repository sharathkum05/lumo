# Lumo server image. Node runs the TypeScript sources directly, so there is no build stage.
FROM node:22-slim

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    LUMO_DB=/data/lumo.db

WORKDIR /app
RUN corepack enable

# Install only what the server needs. Copy manifests first so this layer is cached across code changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json packages/core/
COPY packages/server/package.json packages/server/
RUN pnpm install --frozen-lockfile --prod --filter "@lumo/server..."

COPY packages/core/src packages/core/src
COPY packages/server/src packages/server/src

RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/v1/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

CMD ["node", "--disable-warning=ExperimentalWarning", "packages/server/src/main.ts"]
