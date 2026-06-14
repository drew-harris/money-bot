CREATE TABLE `accounts` (
	`user_id` text PRIMARY KEY NOT NULL,
	`cash_cents` integer DEFAULT 1000000 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `holdings` (
	`user_id` text NOT NULL,
	`symbol` text NOT NULL,
	`quantity` integer NOT NULL,
	PRIMARY KEY(`user_id`, `symbol`)
);
--> statement-breakpoint
CREATE TABLE `trades` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`symbol` text NOT NULL,
	`side` text NOT NULL,
	`quantity` integer NOT NULL,
	`price_cents` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
