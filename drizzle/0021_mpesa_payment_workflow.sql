CREATE TABLE `payment_transactions` (
  `id` int AUTO_INCREMENT NOT NULL,
  `order_id` int NOT NULL,
  `method` enum('MPESA_EXPRESS','MANUAL_MPESA','CASH') NOT NULL,
  `channel` enum('ONLINE','POS') NOT NULL,
  `status` enum('INITIATED','PENDING','REQUIRES_REVIEW','PAID','FAILED','CANCELLED','REFUNDED') NOT NULL DEFAULT 'INITIATED',
  `amount` decimal(12,2) NOT NULL,
  `phone` varchar(30),
  `merchant_request_id` varchar(120),
  `checkout_request_id` varchar(120),
  `receipt_number` varchar(100),
  `manual_message` text,
  `result_code` varchar(40),
  `result_description` varchar(500),
  `provider_payload` json,
  `verified_at` timestamp,
  `reviewed_by` int,
  `reviewed_at` timestamp,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `payment_transactions_id` PRIMARY KEY(`id`),
  CONSTRAINT `payment_transactions_order_id_orders_id_fk` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE no action ON UPDATE no action,
  CONSTRAINT `payment_transactions_reviewed_by_users_id_fk` FOREIGN KEY (`reviewed_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action,
  CONSTRAINT `payment_checkout_request_unique` UNIQUE(`checkout_request_id`),
  CONSTRAINT `payment_receipt_unique` UNIQUE(`receipt_number`)
);--> statement-breakpoint
CREATE INDEX `payment_order_idx` ON `payment_transactions` (`order_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `payment_review_queue_idx` ON `payment_transactions` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `mpesa_incoming_payments` (
  `id` int AUTO_INCREMENT NOT NULL,
  `receipt_number` varchar(100) NOT NULL,
  `amount` decimal(12,2) NOT NULL,
  `phone` varchar(30),
  `account_reference` varchar(120),
  `transaction_time` varchar(30),
  `provider_payload` json,
  `matched_transaction_id` int,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `mpesa_incoming_payments_id` PRIMARY KEY(`id`),
  CONSTRAINT `mpesa_incoming_transaction_fk` FOREIGN KEY (`matched_transaction_id`) REFERENCES `payment_transactions`(`id`) ON DELETE no action ON UPDATE no action,
  CONSTRAINT `mpesa_incoming_receipt_unique` UNIQUE(`receipt_number`)
);--> statement-breakpoint
CREATE INDEX `mpesa_incoming_match_idx` ON `mpesa_incoming_payments` (`matched_transaction_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `mpesa_stk_callbacks` (
  `id` int AUTO_INCREMENT NOT NULL,
  `checkout_request_id` varchar(120) NOT NULL,
  `provider_payload` json NOT NULL,
  `processed_transaction_id` int,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `mpesa_stk_callbacks_id` PRIMARY KEY(`id`),
  CONSTRAINT `mpesa_stk_transaction_fk` FOREIGN KEY (`processed_transaction_id`) REFERENCES `payment_transactions`(`id`) ON DELETE no action ON UPDATE no action,
  CONSTRAINT `mpesa_stk_callback_checkout_unique` UNIQUE(`checkout_request_id`)
);--> statement-breakpoint
CREATE INDEX `mpesa_stk_callback_processed_idx` ON `mpesa_stk_callbacks` (`processed_transaction_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `site_settings` ADD `online_mpesa_enabled` boolean NOT NULL DEFAULT true;--> statement-breakpoint
ALTER TABLE `site_settings` ADD `online_manual_enabled` boolean NOT NULL DEFAULT true;--> statement-breakpoint
ALTER TABLE `site_settings` ADD `pos_cash_enabled` boolean NOT NULL DEFAULT true;--> statement-breakpoint
ALTER TABLE `site_settings` ADD `pos_mpesa_enabled` boolean NOT NULL DEFAULT true;--> statement-breakpoint
ALTER TABLE `site_settings` ADD `pos_manual_enabled` boolean NOT NULL DEFAULT true;--> statement-breakpoint
ALTER TABLE `site_settings` ADD `mpesa_till_number` varchar(30);--> statement-breakpoint
ALTER TABLE `site_settings` ADD `mpesa_account_name` varchar(150);--> statement-breakpoint
UPDATE `branch_inventory` SET `quantity_available` = `quantity_available` + `quantity_reserved` WHERE `quantity_reserved` > 0;
