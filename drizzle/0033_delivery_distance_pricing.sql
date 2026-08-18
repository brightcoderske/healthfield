CREATE TABLE `delivery_bands` (
	`id` int AUTO_INCREMENT NOT NULL,
	`label` varchar(120) NOT NULL,
	`min_km` decimal(6,2) NOT NULL,
	`max_km` decimal(6,2) NOT NULL,
	`fee` decimal(12,2) NOT NULL,
	`free_above_subtotal` decimal(12,2),
	`free_delivery_eligible` boolean NOT NULL DEFAULT true,
	`courier` varchar(120),
	`display_order` int NOT NULL DEFAULT 0,
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `delivery_bands_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `site_settings` ADD `delivery_pricing_enabled` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `site_settings` ADD `delivery_max_radius_km` decimal(6,2);--> statement-breakpoint
ALTER TABLE `site_settings` ADD `delivery_outside_coverage` enum('BLOCK','CUSTOM_FEE') DEFAULT 'BLOCK' NOT NULL;--> statement-breakpoint
ALTER TABLE `site_settings` ADD `delivery_outside_fee` decimal(12,2);--> statement-breakpoint
ALTER TABLE `site_settings` ADD `delivery_detour_factor` decimal(4,2) DEFAULT '1.30' NOT NULL;--> statement-breakpoint
ALTER TABLE `site_settings` ADD `delivery_use_road_distance` boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `site_settings` ADD `delivery_fallback_fee` decimal(12,2) DEFAULT '250' NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `delivery_distance_km` decimal(6,2);--> statement-breakpoint
ALTER TABLE `orders` ADD `delivery_band_id` int;--> statement-breakpoint
ALTER TABLE `orders` ADD `delivery_courier` varchar(120);--> statement-breakpoint
ALTER TABLE `orders` ADD CONSTRAINT `orders_delivery_band_id_delivery_bands_id_fk` FOREIGN KEY (`delivery_band_id`) REFERENCES `delivery_bands`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `delivery_bands_order_idx` ON `delivery_bands` (`display_order`,`min_km`);--> statement-breakpoint
INSERT INTO `delivery_bands` (`label`, `min_km`, `max_km`, `fee`, `display_order`, `is_active`) VALUES
	('0-3 km', 0.00, 3.00, 200.00, 1, true),
	('3-6 km', 3.00, 6.00, 300.00, 2, true),
	('6-10 km', 6.00, 10.00, 450.00, 3, true),
	('10-15 km', 10.00, 15.00, 600.00, 4, true);
