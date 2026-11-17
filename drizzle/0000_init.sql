CREATE TABLE `game_saves` (
	`player_id` text PRIMARY KEY NOT NULL,
	`schema_version` integer NOT NULL,
	`revision` integer NOT NULL,
	`state` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `game_saves_updated_at_idx` ON `game_saves` (`updated_at`);--> statement-breakpoint
CREATE TABLE `players` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL
);
