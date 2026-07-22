ALTER TABLE `orders` ADD `cash_after_cents` integer;
--> statement-breakpoint
ALTER TABLE `transfer_intents` ADD `sender_cash_after_cents` integer;
