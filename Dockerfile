FROM node:22-bookworm-slim

WORKDIR /app

# better-sqlite3 includes a native module and needs a compiler when a prebuilt
# binary is unavailable for the target architecture.
RUN apt-get update \
  && apt-get install --no-install-recommends -y python3 make g++ \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .

ENV DATABASE_URL=/app/data/money-bot.db

VOLUME ["/app/data"]

CMD ["pnpm", "run", "start:container"]
