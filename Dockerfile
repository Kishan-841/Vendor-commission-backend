# ---- Build stage: install everything, generate Prisma client, compile TS ----
FROM node:20-bookworm-slim AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci

COPY prisma ./prisma
RUN npx prisma generate

COPY . .
RUN npm run build

# ---- Runtime stage ---------------------------------------------------------
# We keep ALL deps in the runtime image because the entrypoint needs the Prisma
# CLI (`prisma migrate deploy`) and tsx (idempotent seed) at container start.
FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci

COPY prisma ./prisma
RUN npx prisma generate

COPY --from=builder /app/dist ./dist
COPY tsconfig.json ./
COPY docker-entrypoint.sh ./

# Persistent data dirs (mounted as volumes in docker-compose).
RUN mkdir -p /data/uploads /data/generated && chmod +x docker-entrypoint.sh

EXPOSE 4000
ENTRYPOINT ["./docker-entrypoint.sh"]
