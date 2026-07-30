CREATE TABLE `health_conditions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(150) NOT NULL,
	`slug` varchar(170) NOT NULL,
	`description` varchar(500),
	`is_active` boolean NOT NULL DEFAULT true,
	`display_order` int NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `health_conditions_id` PRIMARY KEY(`id`),
	CONSTRAINT `health_conditions_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `product_health_conditions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`product_id` int NOT NULL,
	`condition_id` int NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `product_health_conditions_id` PRIMARY KEY(`id`),
	CONSTRAINT `product_condition_unique` UNIQUE(`product_id`,`condition_id`)
);
--> statement-breakpoint
CREATE TABLE `product_reviews` (
	`id` int AUTO_INCREMENT NOT NULL,
	`product_id` int NOT NULL,
	`customer_id` int NOT NULL,
	`rating` int NOT NULL,
	`comment` text,
	`is_approved` boolean NOT NULL DEFAULT false,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `product_reviews_id` PRIMARY KEY(`id`),
	CONSTRAINT `product_customer_review_unique` UNIQUE(`product_id`,`customer_id`)
);
--> statement-breakpoint
ALTER TABLE `product_health_conditions` ADD CONSTRAINT `product_health_conditions_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `product_health_conditions` ADD CONSTRAINT `product_health_conditions_condition_id_health_conditions_id_fk` FOREIGN KEY (`condition_id`) REFERENCES `health_conditions`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `product_reviews` ADD CONSTRAINT `product_reviews_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `product_reviews` ADD CONSTRAINT `product_reviews_customer_id_users_id_fk` FOREIGN KEY (`customer_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `product_reviews_approved_idx` ON `product_reviews` (`product_id`,`is_approved`);