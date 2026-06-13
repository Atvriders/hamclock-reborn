FROM node:20.11-alpine AS builder
WORKDIR /app
COPY package*.json ./
# Harden npm registry fetches against transient ECONNRESETs during QEMU-
# emulated arm builds (the cross-build is slow enough that npmjs.org sometimes
# drops the connection partway through).
RUN npm config set fetch-retries 5 \
 && npm config set fetch-retry-mintimeout 20000 \
 && npm config set fetch-retry-maxtimeout 120000 \
 && npm ci --prefer-offline --no-audit
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/nginx.conf
EXPOSE 3012
HEALTHCHECK --interval=30s --timeout=10s --retries=3 --start-period=10s \
  CMD wget -q -O- http://localhost:3012/health || exit 1
