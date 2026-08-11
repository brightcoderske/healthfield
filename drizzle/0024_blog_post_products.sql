CREATE TABLE `blog_post_products` (
	`id` int AUTO_INCREMENT NOT NULL,
	`post_id` int NOT NULL,
	`product_id` int NOT NULL,
	`display_order` int NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `blog_post_products_id` PRIMARY KEY(`id`),
	CONSTRAINT `blog_post_product_unique` UNIQUE(`post_id`,`product_id`)
);
--> statement-breakpoint
ALTER TABLE `blog_post_products` ADD CONSTRAINT `blog_post_products_post_id_blog_posts_id_fk` FOREIGN KEY (`post_id`) REFERENCES `blog_posts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `blog_post_products` ADD CONSTRAINT `blog_post_products_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `blog_post_products_post_idx` ON `blog_post_products` (`post_id`);
