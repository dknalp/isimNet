FROM node:20-alpine AS builder
WORKDIR /app

# Build-time args for NextAuth (empty defaults so build doesn't fail without them)
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

RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 nextjs

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=6784
ENV DATA_DIR=/data

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# Create /data and give nextjs user ownership before the volume is mounted.
# This sets the directory's ownership in the image layer — Docker preserves it
# on first mount of a named volume, so the nextjs user can write to it.
RUN mkdir -p /data && chown nextjs:nodejs /data

USER nextjs

VOLUME ["/data"]
EXPOSE 6784

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:6784/api/health || exit 1

CMD ["node", "server.js"]
