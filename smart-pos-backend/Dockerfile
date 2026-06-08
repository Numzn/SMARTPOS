# syntax=docker/dockerfile:1.6

FROM node:20-alpine AS deps
WORKDIR /app

RUN apk add --no-cache openssl libc6-compat

COPY package*.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev \
 && npx prisma generate \
 && cp -R node_modules /tmp/node_modules.runtime \
 && npm ci

FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

RUN apk add --no-cache openssl libc6-compat tini bash \
 && addgroup -S nodejs && adduser -S nodejs -G nodejs

COPY --from=deps /tmp/node_modules.runtime ./node_modules
COPY --from=deps /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=deps /app/node_modules/@prisma ./node_modules/@prisma

COPY . .

RUN chmod +x scripts/docker-entrypoint.sh \
 && chown -R nodejs:nodejs /app

USER nodejs
EXPOSE 4000

ENTRYPOINT ["/sbin/tini", "--", "/app/scripts/docker-entrypoint.sh"]
CMD ["node", "index.js"]
