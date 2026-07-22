CREATE TABLE `profile_accounts` (
	`profile_id` text PRIMARY KEY NOT NULL REFERENCES `profiles`(`id`),
	`cash_cents` integer DEFAULT 1000000 NOT NULL,
	CONSTRAINT `profile_accounts_cash_valid` CHECK(typeof(`cash_cents`) = 'integer' AND `cash_cents` >= 0)
);
--> statement-breakpoint
CREATE TABLE `cash_movements` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`profile_id` text NOT NULL REFERENCES `profiles`(`id`),
	`kind` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`transfer_id` text,
	`counterparty_user_id` text,
	`note` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT `cash_movements_amount_valid` CHECK(`kind` IN ('starting_cash', 'migration_adjustment', 'transfer_sent', 'transfer_received') AND typeof(`amount_cents`) = 'integer')
);
--> statement-breakpoint
CREATE TABLE `profile_holdings` (
	`profile_id` text NOT NULL REFERENCES `profiles`(`id`),
	`symbol` text NOT NULL,
	`quantity` integer NOT NULL,
	CONSTRAINT `profile_holdings_quantity_valid` CHECK(typeof(`quantity`) = 'integer' AND `quantity` > 0),
	PRIMARY KEY(`profile_id`, `symbol`)
);
--> statement-breakpoint
CREATE TABLE `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL REFERENCES `profiles`(`id`),
	`side` text NOT NULL,
	`symbol` text NOT NULL,
	`quantity` integer NOT NULL,
	`quoted_price_cents` integer NOT NULL,
	`filled_price_cents` integer,
	`status` text DEFAULT 'pending' NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`strategy_revision_id` text,
	`expires_at` integer NOT NULL,
	`filled_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT `orders_values_valid` CHECK(`side` IN ('buy', 'sell') AND `status` IN ('pending', 'filled', 'cancelled', 'expired') AND typeof(`quantity`) = 'integer' AND `quantity` > 0 AND typeof(`quoted_price_cents`) = 'integer' AND `quoted_price_cents` > 0)
);
--> statement-breakpoint
CREATE INDEX `orders_profile_status_idx` ON `orders` (`profile_id`,`status`);
--> statement-breakpoint
CREATE TABLE `portfolio_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`profile_id` text NOT NULL REFERENCES `profiles`(`id`),
	`net_worth_cents` integer NOT NULL,
	`recorded_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT `portfolio_snapshots_value_valid` CHECK(typeof(`net_worth_cents`) = 'integer' AND `net_worth_cents` >= 0)
);
--> statement-breakpoint
CREATE TABLE `profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL REFERENCES `users`(`discord_user_id`),
	`name` text DEFAULT 'Main' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT `profiles_status_valid` CHECK(`status` IN ('active', 'archived'))
);
--> statement-breakpoint
CREATE INDEX `profiles_owner_user_id_idx` ON `profiles` (`owner_user_id`);
--> statement-breakpoint
CREATE TABLE `profile_trades` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`order_id` text,
	`profile_id` text NOT NULL REFERENCES `profiles`(`id`),
	`symbol` text NOT NULL,
	`side` text NOT NULL,
	`quantity` integer NOT NULL,
	`price_cents` integer NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`strategy_revision_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT `profile_trades_values_valid` CHECK(`side` IN ('buy', 'sell') AND typeof(`quantity`) = 'integer' AND `quantity` > 0 AND typeof(`price_cents`) = 'integer' AND `price_cents` > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `profile_trades_order_id_unique` ON `profile_trades` (`order_id`);
--> statement-breakpoint
CREATE INDEX `profile_trades_profile_created_idx` ON `profile_trades` (`profile_id`,`created_at`);
--> statement-breakpoint
CREATE TABLE `transfer_intents` (
	`id` text PRIMARY KEY NOT NULL,
	`from_profile_id` text NOT NULL REFERENCES `profiles`(`id`),
	`to_profile_id` text NOT NULL REFERENCES `profiles`(`id`),
	`cents` integer NOT NULL,
	`note` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`expires_at` integer NOT NULL,
	`completed_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT `transfer_intents_values_valid` CHECK(`status` IN ('pending', 'completed', 'cancelled', 'expired') AND typeof(`cents`) = 'integer' AND `cents` > 0)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`discord_user_id` text PRIMARY KEY NOT NULL,
	`active_profile_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
INSERT INTO `users` (`discord_user_id`, `active_profile_id`, `created_at`)
SELECT `user_id`, `user_id`, `created_at` FROM `accounts`;
--> statement-breakpoint
INSERT INTO `profiles` (`id`, `owner_user_id`, `name`, `status`, `created_at`)
SELECT `user_id`, `user_id`, 'Main', 'active', `created_at` FROM `accounts`;
--> statement-breakpoint
INSERT INTO `profile_accounts` (`profile_id`, `cash_cents`)
SELECT `user_id`, `cash_cents` FROM `accounts`;
--> statement-breakpoint
INSERT INTO `profile_holdings` (`profile_id`, `symbol`, `quantity`)
SELECT `user_id`, `symbol`, `quantity` FROM `holdings`;
--> statement-breakpoint
INSERT INTO `profile_trades` (`id`, `profile_id`, `symbol`, `side`, `quantity`, `price_cents`, `source`, `created_at`)
SELECT `id`, `user_id`, `symbol`, `side`, `quantity`, `price_cents`, 'manual', `created_at` FROM `trades`;
--> statement-breakpoint
INSERT INTO `cash_movements` (`profile_id`, `kind`, `amount_cents`, `created_at`)
SELECT `user_id`, 'starting_cash', 1000000, `created_at` FROM `accounts`;
--> statement-breakpoint
INSERT INTO `cash_movements` (`profile_id`, `kind`, `amount_cents`)
SELECT `accounts`.`user_id`, 'migration_adjustment',
	`accounts`.`cash_cents` - 1000000 - COALESCE((
		SELECT SUM(CASE WHEN `trades`.`side` = 'sell' THEN 1 ELSE -1 END * `trades`.`quantity` * `trades`.`price_cents`)
		FROM `trades` WHERE `trades`.`user_id` = `accounts`.`user_id`
	), 0)
FROM `accounts`
WHERE `accounts`.`cash_cents` - 1000000 - COALESCE((
	SELECT SUM(CASE WHEN `trades`.`side` = 'sell' THEN 1 ELSE -1 END * `trades`.`quantity` * `trades`.`price_cents`)
	FROM `trades` WHERE `trades`.`user_id` = `accounts`.`user_id`
), 0) != 0;
--> statement-breakpoint
DROP TABLE `holdings`;
--> statement-breakpoint
DROP TABLE `trades`;
--> statement-breakpoint
DROP TABLE `accounts`;
