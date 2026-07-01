# syntax=docker/dockerfile:1.6
# Build context: repository root (docker-compose.yml sets context: .)

FROM node:20-alpine AS deps
WORKDIR /app

RUN apk add --no-cache openssl libc6-compat

COPY package.json package-lock.json ./
COPY packages/receipt-engine/package.json ./packages/receipt-engine/
COPY smart-pos-backend/package.json ./smart-pos-backend/

RUN npm ci

COPY packages/receipt-engine ./packages/receipt-engine
COPY smart-pos-backend ./smart-pos-backend

RUN npm run build -w @smartpos/receipt-engine

WORKDIR /app/smart-pos-backend
RUN npx prisma generate

FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

RUN apk add --no-cache openssl libc6-compat tini bash wget \
 && addgroup -S nodejs && adduser -S nodejs -G nodejs

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/receipt-engine ./packages/receipt-engine
COPY --from=deps /app/smart-pos-backend ./smart-pos-backend

WORKDIR /app/smart-pos-backend

RUN chmod +x scripts/docker-entrypoint.sh \
 && chown -R nodejs:nodejs /app

USER nodejs
EXPOSE 4000

ENTRYPOINT ["/sbin/tini", "--", "/app/smart-pos-backend/scripts/docker-entrypoint.sh"]
CMD ["node", "index.js"]
