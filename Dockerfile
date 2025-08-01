FROM oven/bun:1.2.19-alpine AS builder
WORKDIR /app

COPY ./package.json ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build

FROM oven/bun:1.2.19-alpine AS runner
WORKDIR /app

COPY ./package.json ./
RUN bun install --frozen-lockfile --production --ignore-scripts --no-cache

COPY --from=builder /app/dist ./dist

EXPOSE 4141

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --spider -q http://localhost:4141/ || exit 1

ARG GH_TOKEN
ENV GH_TOKEN=$GH_TOKEN

ENTRYPOINT ["bun", "run", "dist/main.js"]
CMD ["start", "-g", "$GH_TOKEN"]
