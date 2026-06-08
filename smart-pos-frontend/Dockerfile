# syntax=docker/dockerfile:1.6

FROM node:20-alpine AS builder
WORKDIR /app

COPY package*.json ./
# Use `npm ci` if a lockfile is present, otherwise fall back to `npm install`.
# The frontend lives in an npm workspace; the lockfile is generated at the
# repo root and isn't copied into the frontend build context.
RUN if [ -f package-lock.json ]; then npm ci; else npm install --no-audit --no-fund; fi

COPY . .

# Same-origin API: built bundle calls /api/* which nginx proxies to the backend container.
ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

FROM nginx:1.27-alpine AS runtime
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80
