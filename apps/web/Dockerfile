# apps/web/Dockerfile
FROM node:20-alpine AS base
RUN apk add --no-cache python3 make g++
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

FROM base AS deps
WORKDIR /workspace
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/design-system/package.json packages/design-system/package.json
RUN pnpm install --frozen-lockfile

FROM base AS builder
WORKDIR /workspace
COPY --from=deps /workspace ./
COPY . .
RUN mkdir -p apps/web/public
ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_PUBLIC_API_URL=https://api.tinocerto.com.br
RUN pnpm --filter @tinocerto/web build

FROM base AS runner
WORKDIR /workspace
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=builder --chown=nextjs:nodejs /workspace/apps/web/.next ./apps/web/.next
COPY --from=builder --chown=nextjs:nodejs /workspace/apps/web/public ./apps/web/public
COPY --from=builder --chown=nextjs:nodejs /workspace/apps/web/package.json ./apps/web/package.json
COPY --from=builder --chown=nextjs:nodejs /workspace/package.json ./package.json
COPY --from=builder --chown=nextjs:nodejs /workspace/apps/web/next.config.* ./apps/web/
COPY --from=builder --chown=nextjs:nodejs /workspace/apps/web/node_modules ./apps/web/node_modules
COPY --from=builder --chown=nextjs:nodejs /workspace/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /workspace/packages/design-system ./packages/design-system
USER nextjs
WORKDIR /workspace/apps/web
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
CMD ["pnpm", "start"]
