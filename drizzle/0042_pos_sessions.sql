CREATE TABLE `pos_tills` (
  `id` int AUTO_INCREMENT NOT NULL,
  `branch_id` int NOT NULL,
  `code` varchar(50) NOT NULL,
  `name` varchar(120) NOT NULL,
  `mpesa_till_number` varchar(30),
  `is_active` boolean NOT NULL DEFAULT true,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `pos_tills_id` PRIMARY KEY(`id`),
  CONSTRAINT `pos_tills_code_unique` UNIQUE(`code`),
  CONSTRAINT `pos_tills_branch_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`)
);--> statement-breakpoint
CREATE INDEX `pos_tills_branch_idx` ON `pos_tills` (`branch_id`,`is_active`);--> statement-breakpoint
INSERT INTO `pos_tills` (`branch_id`,`code`,`name`,`mpesa_till_number`)
SELECT `branches`.`id`, CONCAT(`branches`.`code`, '-01'), CONCAT(`branches`.`name`, ' Till 1'), (SELECT `mpesa_till_number` FROM `site_settings` LIMIT 1)
FROM `branches` WHERE `branches`.`is_active` = true;--> statement-breakpoint
CREATE TABLE `pos_sessions` (
  `id` int AUTO_INCREMENT NOT NULL,
  `session_number` varchar(50) NOT NULL,
  `user_id` int NOT NULL,
  `branch_id` int NOT NULL,
  `till_id` int NOT NULL,
  `status` enum('OPEN','CLOSED') NOT NULL DEFAULT 'OPEN',
  `opening_float` decimal(12,2) NOT NULL DEFAULT '0',
  `opening_cash` decimal(12,2) NOT NULL DEFAULT '0',
  `actual_cash` decimal(12,2),
  `expected_cash` decimal(12,2),
  `cash_difference` decimal(12,2),
  `closing_notes` text,
  `opened_at` timestamp NOT NULL DEFAULT (now()),
  `closed_at` timestamp NULL,
  `report_sent_at` timestamp NULL,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `pos_sessions_id` PRIMARY KEY(`id`),
  CONSTRAINT `pos_sessions_number_unique` UNIQUE(`session_number`),
  CONSTRAINT `pos_sessions_user_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`),
  CONSTRAINT `pos_sessions_branch_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`),
  CONSTRAINT `pos_sessions_till_fk` FOREIGN KEY (`till_id`) REFERENCES `pos_tills`(`id`)
);--> statement-breakpoint
CREATE INDEX `pos_sessions_user_status_idx` ON `pos_sessions` (`user_id`,`status`,`opened_at`);--> statement-breakpoint
CREATE INDEX `pos_sessions_till_status_idx` ON `pos_sessions` (`till_id`,`status`,`opened_at`);--> statement-breakpoint
CREATE INDEX `pos_sessions_branch_date_idx` ON `pos_sessions` (`branch_id`,`opened_at`);--> statement-breakpoint
ALTER TABLE `orders` ADD `pos_session_id` int;--> statement-breakpoint
ALTER TABLE `orders` ADD `cashier_id` int;--> statement-breakpoint
ALTER TABLE `orders` ADD `till_id` int;--> statement-breakpoint
ALTER TABLE `orders` ADD `transacted_at` timestamp NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD CONSTRAINT `orders_pos_session_fk` FOREIGN KEY (`pos_session_id`) REFERENCES `pos_sessions`(`id`);--> statement-breakpoint
ALTER TABLE `orders` ADD CONSTRAINT `orders_cashier_fk` FOREIGN KEY (`cashier_id`) REFERENCES `users`(`id`);--> statement-breakpoint
ALTER TABLE `orders` ADD CONSTRAINT `orders_till_fk` FOREIGN KEY (`till_id`) REFERENCES `pos_tills`(`id`);--> statement-breakpoint
CREATE INDEX `orders_pos_session_idx` ON `orders` (`pos_session_id`,`transacted_at`);--> statement-breakpoint
ALTER TABLE `payment_transactions` ADD `tendered_amount` decimal(12,2);--> statement-breakpoint
ALTER TABLE `payment_transactions` ADD `change_given` decimal(12,2);--> statement-breakpoint
CREATE TABLE `pos_held_sales` (
  `id` int AUTO_INCREMENT NOT NULL,
  `session_id` int NOT NULL,
  `branch_id` int NOT NULL,
  `held_by` int NOT NULL,
  `label` varchar(160) NOT NULL,
  `customer_name` varchar(200),
  `phone` varchar(30),
  `email` varchar(190),
  `cart` json NOT NULL,
  `discount_amount` decimal(12,2) NOT NULL DEFAULT '0',
  `status` enum('HELD','RESUMED','COMPLETED','CANCELLED') NOT NULL DEFAULT 'HELD',
  `completed_order_id` int,
  `held_at` timestamp NOT NULL DEFAULT (now()),
  `resumed_at` timestamp NULL,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `pos_held_sales_id` PRIMARY KEY(`id`),
  CONSTRAINT `pos_held_sales_session_fk` FOREIGN KEY (`session_id`) REFERENCES `pos_sessions`(`id`),
  CONSTRAINT `pos_held_sales_branch_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`),
  CONSTRAINT `pos_held_sales_user_fk` FOREIGN KEY (`held_by`) REFERENCES `users`(`id`),
  CONSTRAINT `pos_held_sales_order_fk` FOREIGN KEY (`completed_order_id`) REFERENCES `orders`(`id`)
);--> statement-breakpoint
CREATE INDEX `pos_held_sales_session_idx` ON `pos_held_sales` (`session_id`,`status`,`held_at`);--> statement-breakpoint
CREATE TABLE `pos_expenses` (
  `id` int AUTO_INCREMENT NOT NULL,
  `session_id` int NOT NULL,
  `branch_id` int NOT NULL,
  `recorded_by` int NOT NULL,
  `category` varchar(100) NOT NULL,
  `description` varchar(500) NOT NULL,
  `amount` decimal(12,2) NOT NULL,
  `reference` varchar(120),
  `incurred_at` timestamp NOT NULL DEFAULT (now()),
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `pos_expenses_id` PRIMARY KEY(`id`),
  CONSTRAINT `pos_expenses_session_fk` FOREIGN KEY (`session_id`) REFERENCES `pos_sessions`(`id`),
  CONSTRAINT `pos_expenses_branch_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`),
  CONSTRAINT `pos_expenses_user_fk` FOREIGN KEY (`recorded_by`) REFERENCES `users`(`id`)
);--> statement-breakpoint
CREATE INDEX `pos_expenses_session_idx` ON `pos_expenses` (`session_id`,`incurred_at`);--> statement-breakpoint
CREATE TABLE `pos_stock_receipts` (
  `id` int AUTO_INCREMENT NOT NULL,
  `receipt_number` varchar(50) NOT NULL,
  `session_id` int NOT NULL,
  `branch_id` int NOT NULL,
  `received_by` int NOT NULL,
  `supplier_name` varchar(200) NOT NULL,
  `supplier_phone` varchar(30),
  `supplier_invoice` varchar(120),
  `receipt_image_path` varchar(500),
  `total_cost` decimal(12,2) NOT NULL DEFAULT '0',
  `received_at` timestamp NOT NULL DEFAULT (now()),
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `pos_stock_receipts_id` PRIMARY KEY(`id`),
  CONSTRAINT `pos_stock_receipts_number_unique` UNIQUE(`receipt_number`),
  CONSTRAINT `pos_stock_receipts_session_fk` FOREIGN KEY (`session_id`) REFERENCES `pos_sessions`(`id`),
  CONSTRAINT `pos_stock_receipts_branch_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`),
  CONSTRAINT `pos_stock_receipts_user_fk` FOREIGN KEY (`received_by`) REFERENCES `users`(`id`)
);--> statement-breakpoint
CREATE INDEX `pos_stock_receipts_session_idx` ON `pos_stock_receipts` (`session_id`,`received_at`);--> statement-breakpoint
CREATE INDEX `pos_stock_receipts_branch_idx` ON `pos_stock_receipts` (`branch_id`,`received_at`);--> statement-breakpoint
CREATE TABLE `pos_stock_receipt_items` (
  `id` int AUTO_INCREMENT NOT NULL,
  `receipt_id` int NOT NULL,
  `product_id` int NOT NULL,
  `quantity` int NOT NULL,
  `buying_price` decimal(12,2) NOT NULL,
  `line_total` decimal(12,2) NOT NULL,
  `batch_number` varchar(120),
  `expiry_date` varchar(10),
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `pos_stock_receipt_items_id` PRIMARY KEY(`id`),
  CONSTRAINT `pos_stock_receipt_items_receipt_fk` FOREIGN KEY (`receipt_id`) REFERENCES `pos_stock_receipts`(`id`) ON DELETE CASCADE,
  CONSTRAINT `pos_stock_receipt_items_product_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`)
);--> statement-breakpoint
CREATE INDEX `pos_stock_receipt_items_receipt_idx` ON `pos_stock_receipt_items` (`receipt_id`,`product_id`);--> statement-breakpoint
CREATE TABLE `product_batches` (
  `id` int AUTO_INCREMENT NOT NULL,
  `branch_id` int NOT NULL,
  `product_id` int NOT NULL,
  `stock_receipt_item_id` int NOT NULL,
  `batch_number` varchar(120),
  `expiry_date` varchar(10),
  `quantity_received` int NOT NULL,
  `quantity_remaining` int NOT NULL,
  `unit_cost` decimal(12,2) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `product_batches_id` PRIMARY KEY(`id`),
  CONSTRAINT `product_batches_branch_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`),
  CONSTRAINT `product_batches_product_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`),
  CONSTRAINT `product_batches_receipt_item_fk` FOREIGN KEY (`stock_receipt_item_id`) REFERENCES `pos_stock_receipt_items`(`id`)
);--> statement-breakpoint
CREATE INDEX `product_batches_expiry_idx` ON `product_batches` (`branch_id`,`expiry_date`,`quantity_remaining`);--> statement-breakpoint
CREATE INDEX `product_batches_product_idx` ON `product_batches` (`product_id`,`branch_id`);
