CREATE TABLE `blog_posts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`title` varchar(220) NOT NULL,
	`slug` varchar(240) NOT NULL,
	`excerpt` varchar(500) NOT NULL,
	`content` text NOT NULL,
	`image_url` varchar(500),
	`meta_title` varchar(220),
	`meta_description` varchar(500),
	`is_published` boolean NOT NULL DEFAULT false,
	`published_at` timestamp,
	`author_id` int,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `blog_posts_id` PRIMARY KEY(`id`),
	CONSTRAINT `blog_posts_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `email_verification_tokens` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`token_hash` varchar(64) NOT NULL,
	`expires_at` timestamp NOT NULL,
	`used_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `email_verification_tokens_id` PRIMARY KEY(`id`),
	CONSTRAINT `email_verification_token_unique` UNIQUE(`token_hash`)
);
--> statement-breakpoint
ALTER TABLE `site_settings` ADD `licence_title` varchar(190);--> statement-breakpoint
ALTER TABLE `site_settings` ADD `licence_number` varchar(120);--> statement-breakpoint
ALTER TABLE `site_settings` ADD `licence_image_url` varchar(500);--> statement-breakpoint
ALTER TABLE `users` ADD `email_verified_at` timestamp;--> statement-breakpoint
UPDATE `users` SET `email_verified_at` = CURRENT_TIMESTAMP WHERE `role` IN ('CUSTOMER','STAFF','ADMIN','SUPER_ADMIN');--> statement-breakpoint
ALTER TABLE `blog_posts` ADD CONSTRAINT `blog_posts_author_id_users_id_fk` FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `email_verification_tokens` ADD CONSTRAINT `email_verification_tokens_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `blog_posts_published_idx` ON `blog_posts` (`is_published`,`published_at`);--> statement-breakpoint
CREATE INDEX `email_verification_user_idx` ON `email_verification_tokens` (`user_id`);
