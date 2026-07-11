# money-bot

A Discord paper-trading bot using discord.js, Drizzle ORM, and SQLite.

## Setup

The bot requires `DISCORD_BOT_TOKEN` at runtime. Deploying slash commands also
requires `DISCORD_CLIENT_ID`. `DATABASE_URL` defaults to `data/money-bot.db`.

```sh
pnpm install
pnpm deploy:commands
pnpm start
```

Slash commands are deployed explicitly and are never modified by bot startup.
Run `pnpm deploy:commands` after changing a command name, description, or option.

## Development

```sh
pnpm dev
pnpm test
pnpm typecheck
pnpm format:check
```

Docker Compose persists SQLite data in `./data` and receives the Discord token
and client ID through its environment.
