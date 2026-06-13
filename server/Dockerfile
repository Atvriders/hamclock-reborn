FROM node:20.11-alpine AS builder
WORKDIR /app
COPY package*.json ./
# Harden npm registry fetches against transient ECONNRESETs during QEMU-
# emulated arm builds.
RUN npm config set fetch-retries 5 \
 && npm config set fetch-retry-mintimeout 20000 \
 && npm config set fetch-retry-maxtimeout 120000 \
 && npm ci --prefer-offline --no-audit

FROM node:20.11-alpine
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY . .
ENV PORT=3013 NODE_ENV=production
EXPOSE 3013
HEALTHCHECK --interval=30s --timeout=10s --retries=3 --start-period=40s \
  CMD wget -q -O- http://localhost:3013/api/health || exit 1
CMD ["node", "src/server.js"]
