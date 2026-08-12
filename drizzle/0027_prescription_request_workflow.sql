ALTER TABLE `orders` MODIFY COLUMN `status` enum('NEW','AWAITING_PAYMENT','CONFIRMED','UNDER_REVIEW','BEING_FULFILLED','PARTIALLY_READY','READY_FOR_DISPATCH','OUT_FOR_DELIVERY','READY_FOR_PICKUP','COMPLETED','CANCELLED') NOT NULL DEFAULT 'NEW';
--> statement-breakpoint
ALTER TABLE `prescriptions` ADD `review_version` int NOT NULL DEFAULT 0;
--> statement-breakpoint
CREATE TABLE `prescription_request_items` (
	`id` int AUTO_INCREMENT NOT NULL,
	`prescription_id` int NOT NULL,
	`product_id` int,
	`product_name` varchar(220) NOT NULL,
	`requested_quantity` int NOT NULL DEFAULT 0,
	`approved_quantity` int,
	`unit_price` decimal(12,2),
	`availability` enum('PENDING','AVAILABLE','PARTIALLY_AVAILABLE','UNAVAILABLE') NOT NULL DEFAULT 'PENDING',
	`source` enum('CUSTOMER_CART','PHARMACIST') NOT NULL DEFAULT 'PHARMACIST',
	`pharmacist_note` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `prescription_request_items_id` PRIMARY KEY(`id`),
	CONSTRAINT `prescription_request_product_unique` UNIQUE(`prescription_id`,`product_id`)
);
--> statement-breakpoint
ALTER TABLE `prescription_request_items` ADD CONSTRAINT `prescription_request_items_prescription_id_prescriptions_id_fk` FOREIGN KEY (`prescription_id`) REFERENCES `prescriptions`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `prescription_request_items` ADD CONSTRAINT `prescription_request_items_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX `prescription_request_items_request_idx` ON `prescription_request_items` (`prescription_id`,`id`);
