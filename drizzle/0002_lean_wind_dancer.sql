CREATE TABLE `site_settings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`pharmacy_name` varchar(150) NOT NULL DEFAULT 'Healthfield Pharmacy',
	`phone` varchar(30),
	`whatsapp` varchar(30),
	`support_email` varchar(190),
	`address` text,
	`opening_hours` varchar(255),
	`delivery_message` varchar(255) NOT NULL DEFAULT 'Fast Delivery Across Kenya',
	`free_delivery_threshold` decimal(12,2),
	`updated_by` int,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `site_settings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `site_settings` ADD CONSTRAINT `site_settings_updated_by_users_id_fk` FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;