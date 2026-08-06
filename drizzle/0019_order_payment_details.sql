ALTER TABLE `orders` ADD `payment_method` varchar(20) NOT NULL DEFAULT 'MPESA';--> statement-breakpoint
ALTER TABLE `orders` ADD `payment_reference` varchar(100);--> statement-breakpoint
ALTER TABLE `orders` ADD `amount_paid` decimal(12,2) NOT NULL DEFAULT '0.00';
