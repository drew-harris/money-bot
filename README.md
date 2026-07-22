# money-bot

A Discord paper-trading bot using discord.js, Drizzle ORM, and SQLite.

## Discord experience

- `/portfolio [user]` opens an interactive public portfolio with position,
  activity, order, refresh, and liquidation controls.
- `/stock <symbol>` opens a live quote with ticker autocomplete, generated
  charts, selectable time ranges, and Buy/Sell actions.
- `/trade buy|sell` is a quick path to a private order review. Orders require
  confirmation and completed fills receive a public receipt.
- `/leaderboard` opens the paginated global rankings.
- The user context-menu actions `View portfolio` and `Send cash` provide quick
  access without typing a user option.
- An exact, case-insensitive `man` message still immediately buys one share of
  MAN. This intentional shortcut is the reason the bot requires message-content
  access in addition to the Guilds intent.

New traders explicitly create a global `Main` profile from `/portfolio` and
start with $10,000 in simulated cash. Storage is profile-scoped so multiple
portfolios and strategy profiles can be added without rekeying trading data.

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
The deployment replaces the complete global slash and context-menu command set.

## Development

```sh
pnpm dev
pnpm test
pnpm typecheck
pnpm format:check
```

Docker Compose persists SQLite data in `./data` and receives the Discord token
and client ID through its environment.
