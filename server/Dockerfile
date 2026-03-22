FROM node:20.11-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM node:20.11-alpine
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY . .
ENV PORT=3013 NODE_ENV=production
EXPOSE 3013
HEALTHCHECK --interval=30s --timeout=10s --retries=3 --start-period=40s \
  CMD wget -q -O- http://localhost:3013/api/health || exit 1
CMD ["node", "src/server.js"]
