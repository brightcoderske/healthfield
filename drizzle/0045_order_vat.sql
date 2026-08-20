ALTER TABLE `orders` ADD `vat` decimal(12,2) NOT NULL DEFAULT '0.00';--> statement-breakpoint
ALTER TABLE `orders` ADD `vat_rate` decimal(5,2) NOT NULL DEFAULT '0.00';--> statement-breakpoint
CREATE TABLE `vat_remittances` (
	`id` int AUTO_INCREMENT NOT NULL,
	`amount` decimal(12,2) NOT NULL,
	`order_count` int NOT NULL DEFAULT 0,
	`period_from` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`period_to` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`note` varchar(300),
	`remitted_by` int NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `vat_remittances_id` PRIMARY KEY(`id`)
);--> statement-breakpoint
ALTER TABLE `vat_remittances` ADD CONSTRAINT `vat_remittances_remitted_by_users_id_fk` FOREIGN KEY (`remitted_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `orders_vat_idx` ON `orders` (`vat`,`created_at`);
