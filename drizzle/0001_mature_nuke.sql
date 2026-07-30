ALTER TABLE `products` ADD `image_url` varchar(500);--> statement-breakpoint
ALTER TABLE `users` ADD `force_password_change` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `home_branch_id` int;