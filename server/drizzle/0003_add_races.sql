CREATE TABLE `races` (
	`id` integer PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`name` text NOT NULL,
	`city` text,
	`distance_km` real NOT NULL,
	`goal_sec` integer,
	`route_source` text DEFAULT 'waypoints' NOT NULL,
	`route_data` text,
	`profile_json` text,
	`source_note` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_races_date` ON `races` (`date`);