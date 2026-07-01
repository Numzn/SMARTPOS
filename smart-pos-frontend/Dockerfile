# syntax=docker/dockerfile:1.6
# Build context: repository root (docker-compose.yml sets context: .)

FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/receipt-engine/package.json ./packages/receipt-engine/
COPY smart-pos-frontend/package.json ./smart-pos-frontend/

RUN npm ci

COPY packages/receipt-engine ./packages/receipt-engine
COPY smart-pos-frontend ./smart-pos-frontend

RUN npm run build -w @smartpos/receipt-engine

WORKDIR /app/smart-pos-frontend

ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

FROM nginx:1.27-alpine AS runtime
COPY smart-pos-frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/smart-pos-frontend/dist /usr/share/nginx/html

EXPOSE 80
