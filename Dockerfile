FROM node:24-bookworm-slim AS build
WORKDIR /app
ARG APP_VERSION=0.15.0
ENV APP_VERSION=${APP_VERSION}
RUN corepack enable && corepack prepare pnpm@11.19.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm run build

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ARG APP_VERSION=0.15.0
LABEL org.opencontainers.image.version=${APP_VERSION}
RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends python3 ca-certificates tzdata \
    && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
ENV APP_VERSION=${APP_VERSION}
ENV APP_TIMEZONE=America/Los_Angeles
ENV APP_ORIGIN=http://localhost:3000
ENV API_HOST=0.0.0.0
COPY --from=build /app /app
RUN mkdir -p /app/data/uploads/services /app/data/uploads/texts /app/data/uploads/vorraden /app/data/backups \
    && chmod +x /app/docker-entrypoint.sh
EXPOSE 3000 3001
VOLUME ["/app/data"]
ENTRYPOINT ["/app/docker-entrypoint.sh"]
