CREATE TABLE `activities` (
	`label_id` text PRIMARY KEY NOT NULL,
	`sport_type` integer NOT NULL,
	`sport_name` text NOT NULL,
	`date` text NOT NULL,
	`date_label` text NOT NULL,
	`start_ts` integer,
	`end_ts` integer,
	`location` text,
	`lat` real,
	`lon` real,
	`duration_sec` integer,
	`distance_km` real,
	`avg_pace_sec` real,
	`avg_hr` integer,
	`calories` integer,
	`raw` text,
	`synced_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_activities_date` ON `activities` (`date`);--> statement-breakpoint
CREATE INDEX `idx_activities_sport` ON `activities` (`sport_type`);--> statement-breakpoint
CREATE TABLE `activity_details` (
	`label_id` text PRIMARY KEY NOT NULL,
	`sport_name` text,
	`duration_sec` integer,
	`distance_km` real,
	`avg_pace_sec` real,
	`moving_pace_sec` real,
	`adjusted_pace_sec` real,
	`best_km_sec` integer,
	`avg_hr` integer,
	`avg_cadence` integer,
	`avg_stride_m` real,
	`avg_power` integer,
	`elev_gain` integer,
	`elev_loss` integer,
	`calories` integer,
	`training_load` integer,
	`aerobic_te` real,
	`anaerobic_te` real,
	`training_focus` text,
	`performance` text,
	`raw` text,
	FOREIGN KEY (`label_id`) REFERENCES `activities`(`label_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `ai_reports` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`label_id` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`focus` text,
	`report` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`label_id`) REFERENCES `activities`(`label_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_ai_reports_label` ON `ai_reports` (`label_id`);--> statement-breakpoint
CREATE TABLE `ai_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`provider` text DEFAULT 'openai' NOT NULL,
	`base_url` text NOT NULL,
	`api_key` text NOT NULL,
	`model` text NOT NULL,
	`temperature` real DEFAULT 0.7 NOT NULL,
	`max_tokens` integer DEFAULT 2000 NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `daily_health` (
	`date` text PRIMARY KEY NOT NULL,
	`date_label` text NOT NULL,
	`steps` integer,
	`calories` integer,
	`exercise_min` integer,
	`stress_avg` integer,
	`resting_hr` integer,
	`hrv_baseline` integer
);
--> statement-breakpoint
CREATE TABLE `fit_quota` (
	`day` text PRIMARY KEY NOT NULL,
	`used` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `fitness` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`captured_at` integer NOT NULL,
	`vo2max` real,
	`running_level` real,
	`threshold_pace_sec` integer,
	`pred5k_sec` integer,
	`pred10k_sec` integer,
	`pred_half_sec` integer,
	`pred_marathon_sec` integer
);
--> statement-breakpoint
CREATE TABLE `heart_rate` (
	`date` text PRIMARY KEY NOT NULL,
	`avg_hr` integer,
	`min_hr` integer,
	`max_hr` integer
);
--> statement-breakpoint
CREATE TABLE `laps` (
	`label_id` text NOT NULL,
	`lap_index` integer NOT NULL,
	`distance_m` real NOT NULL,
	`time_sec` real NOT NULL,
	`total_length_sec` real,
	`avg_pace_sec` real,
	`adjusted_pace_sec` real,
	`avg_speed_raw` real,
	`avg_power` integer,
	`avg_hr` integer,
	`max_hr` integer,
	`avg_cadence` integer,
	`max_cadence` integer,
	`avg_stride_m` real,
	`elev_gain` real,
	`total_descent` real,
	PRIMARY KEY(`label_id`, `lap_index`),
	FOREIGN KEY (`label_id`) REFERENCES `activities`(`label_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `recovery` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`captured_at` integer NOT NULL,
	`recovery_pct` integer,
	`level` text,
	`full_recovery_hours` real
);
--> statement-breakpoint
CREATE TABLE `scheduled_workouts` (
	`date` text NOT NULL,
	`id_in_plan` text NOT NULL,
	`name` text,
	`sport_type` integer,
	`raw` text,
	PRIMARY KEY(`date`, `id_in_plan`)
);
--> statement-breakpoint
CREATE TABLE `sleep` (
	`date` text PRIMARY KEY NOT NULL,
	`score` integer,
	`available` integer DEFAULT 0 NOT NULL,
	`raw` text
);
--> statement-breakpoint
CREATE TABLE `stress` (
	`date` text PRIMARY KEY NOT NULL,
	`avg_stress` integer,
	`level` text
);
--> statement-breakpoint
CREATE TABLE `sync_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`status` text NOT NULL,
	`detail` text
);
--> statement-breakpoint
CREATE TABLE `training_load` (
	`date` text PRIMARY KEY NOT NULL,
	`comment` text,
	`short_load` integer,
	`long_load` integer,
	`ratio` real
);
--> statement-breakpoint
CREATE TABLE `users` (
	`height_cm` real,
	`weight_kg` real,
	`birthday` text,
	`gender` text,
	`nickname` text,
	`raw` text
);
