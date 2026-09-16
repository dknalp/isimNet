FROM node:20-alpine AS builder
WORKDIR /app

ARG AUTH_SECRET=""
ARG NEXTAUTH_URL=""
ENV AUTH_SECRET=$AUTH_SECRET
ENV NEXTAUTH_URL=$NEXTAUTH_URL

COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app

# su-exec is Alpine's lightweight sudo — lets the entrypoint fix /data ownership
# then drop to nextjs without keeping root
RUN apk add --no-cache su-exec \
 && addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 nextjs

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=6784
ENV DATA_DIR=/data

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh && mkdir -p /data && chown nextjs:nodejs /data

EXPOSE 6784

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:6784/api/health || exit 1

# Runs as root only to fix /data ownership, then drops to nextjs
ENTRYPOINT ["/entrypoint.sh"]
