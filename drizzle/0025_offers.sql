CREATE TABLE `offers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`title` varchar(180) NOT NULL,
	`slug` varchar(200) NOT NULL,
	`description` varchar(500),
	`image_url` varchar(500),
	`bundle_price` decimal(12,2),
	`starts_at` timestamp NULL DEFAULT NULL,
	`ends_at` timestamp NULL DEFAULT NULL,
	`is_active` boolean NOT NULL DEFAULT true,
	`display_order` int NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `offers_id` PRIMARY KEY(`id`),
	CONSTRAINT `offers_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `offer_items` (
	`id` int AUTO_INCREMENT NOT NULL,
	`offer_id` int NOT NULL,
	`product_id` int NOT NULL,
	`offer_price` decimal(12,2),
	`quantity` int NOT NULL DEFAULT 1,
	`display_order` int NOT NULL DEFAULT 0,
	CONSTRAINT `offer_items_id` PRIMARY KEY(`id`),
	CONSTRAINT `offer_item_unique` UNIQUE(`offer_id`,`product_id`)
);
--> statement-breakpoint
ALTER TABLE `offer_items` ADD CONSTRAINT `offer_items_offer_id_offers_id_fk` FOREIGN KEY (`offer_id`) REFERENCES `offers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `offer_items` ADD CONSTRAINT `offer_items_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `offers_active_idx` ON `offers` (`is_active`,`ends_at`);--> statement-breakpoint
CREATE INDEX `offer_items_offer_idx` ON `offer_items` (`offer_id`);--> statement-breakpoint
ALTER TABLE `order_items` ADD `offer_id` int;--> statement-breakpoint
ALTER TABLE `order_items` ADD `offer_title` varchar(180);
