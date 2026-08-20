ALTER TABLE `products` ADD `cost_price` decimal(12,2);--> statement-breakpoint
ALTER TABLE `products` ADD `cost_price_estimated` boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `order_items` ADD `unit_cost` decimal(12,2);--> statement-breakpoint
UPDATE `products` SET `cost_price` = ROUND(`price` / 1.33, 2) WHERE `cost_price` IS NULL AND `price` > 0;
