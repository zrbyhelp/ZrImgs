FROM node:20-bookworm-slim AS base

ARG PNPM_VERSION=10.15.1

WORKDIR /app

RUN npm install -g pnpm@${PNPM_VERSION} \
  && npm cache clean --force

FROM base AS deps

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM deps AS build

COPY . .
RUN pnpm db:generate
RUN pnpm docs:build
RUN pnpm build

FROM base AS runner

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
ENV NITRO_HOST=0.0.0.0
ENV NITRO_PORT=3000

COPY package.json pnpm-lock.yaml ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/.output ./.output
COPY --from=build /app/prisma ./prisma

EXPOSE 3000

CMD ["sh", "-c", "pnpm db:push && node .output/server/index.mjs"]
