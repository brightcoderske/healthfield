CREATE TABLE `promotional_banners` (
	`id` int AUTO_INCREMENT NOT NULL,
	`title` varchar(180) NOT NULL,
	`image_url` varchar(500) NOT NULL,
	`product_id` int NOT NULL,
	`is_active` boolean NOT NULL DEFAULT true,
	`display_order` int NOT NULL DEFAULT 0,
	`created_by` int,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `promotional_banners_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `promotional_banners` ADD CONSTRAINT `promotional_banners_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `promotional_banners` ADD CONSTRAINT `promotional_banners_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX `promotional_banners_active_idx` ON `promotional_banners` (`is_active`,`display_order`);
--> statement-breakpoint
CREATE INDEX `promotional_banners_product_idx` ON `promotional_banners` (`product_id`);
