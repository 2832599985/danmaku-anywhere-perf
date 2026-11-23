CREATE TABLE `community_comment` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL REFERENCES `user`(`id`),
  `anime_title` text NOT NULL,
  `episode_key` text NOT NULL,
  `time` real NOT NULL,
  `mode` integer NOT NULL DEFAULT 1,
  `color` integer NOT NULL DEFAULT 16777215,
  `content` text NOT NULL,
  `created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_community_dedup` ON `community_comment` (`user_id`, `anime_title`, `episode_key`, `time`, `content`);
--> statement-breakpoint
CREATE INDEX `idx_community_lookup` ON `community_comment` (`anime_title`, `episode_key`);
