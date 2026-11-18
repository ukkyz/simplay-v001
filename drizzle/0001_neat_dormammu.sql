CREATE TABLE IF NOT EXISTS `world_players` (
	`player_id` text PRIMARY KEY NOT NULL,
	`company` text NOT NULL,
	`ceo_name` text NOT NULL,
	`lat_e2` integer NOT NULL,
	`lng_e2` integer NOT NULL,
	`side_km` integer NOT NULL,
	`building_count` integer NOT NULL,
	`color` text NOT NULL,
	`published_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `world_players_bbox_idx` ON `world_players` (`lat_e2`,`lng_e2`);