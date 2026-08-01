ALTER TABLE `order_items` DROP FOREIGN KEY `order_items_product_id_products_id_fk`;
--> statement-breakpoint
ALTER TABLE `order_items` MODIFY COLUMN `product_id` int;--> statement-breakpoint
ALTER TABLE `orders` ADD `checkout_token` varchar(64);--> statement-breakpoint
ALTER TABLE `orders` ADD CONSTRAINT `orders_checkout_token_unique` UNIQUE(`checkout_token`);--> statement-breakpoint
ALTER TABLE `order_items` ADD CONSTRAINT `order_items_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE set null ON UPDATE no action;