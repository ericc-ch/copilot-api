# Stage 1: Build frontend
FROM node:22-alpine AS web-builder
WORKDIR /app/web

COPY web/package.json ./
RUN npm install

COPY web/ ./
RUN npm run build

# Stage 2: Build backend
FROM oven/bun:1.2.19-alpine AS builder
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .

# Stage 3: Runtime
FROM oven/bun:1.2.19-alpine
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production --ignore-scripts --no-cache

COPY --from=builder /app/src ./src
COPY --from=builder /app/tsconfig.json ./
COPY --from=web-builder /app/web/dist ./web/dist

EXPOSE 3000 4141

VOLUME /root/.local/share/copilot-api

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --spider -q http://localhost:3000/api/config || exit 1

ENTRYPOINT ["bun", "run", "./src/main.ts", "console"]
CMD ["--web-port", "3000", "--proxy-port", "4141"]
