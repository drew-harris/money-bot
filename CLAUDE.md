# money-bot

This is a Node.js Discord bot built with discord.js, Drizzle ORM, and SQLite.

- Keep money values as integer cents.
- Keep external price requests outside synchronous SQLite transactions.
- Register slash commands explicitly with `pnpm deploy:commands`; bot startup must not modify them.
- Use only the Discord gateway intents required by current behavior.
