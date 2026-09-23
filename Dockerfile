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
# 127.0.0.1, not localhost: Docker's /etc/hosts maps localhost to ::1 as well,
# musl sorts ::1 first, and Alpine builds BusyBox without PREFER_IPV4_ADDRESS,
# so wget connects to [::1] alone and never falls back -- while nginx.conf
# listens on IPv4 only. Every check since deploy failed (FailingStreak 10605 on
# the live container) while the site itself was up. Probing v4 tests exactly the
# socket compose publishes; an IPv6 listen would widen what is served to
# satisfy a probe.
HEALTHCHECK --interval=30s --timeout=10s --retries=3 --start-period=10s \
  CMD wget -q -O- http://127.0.0.1:3012/health || exit 1
