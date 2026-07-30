CREATE TABLE `activity_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`actor_id` int,
	`action` varchar(120) NOT NULL,
	`entity_type` varchar(80) NOT NULL,
	`entity_id` varchar(80),
	`metadata` json,
	`ip_address` varchar(64),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `activity_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `branch_inventory` (
	`id` int AUTO_INCREMENT NOT NULL,
	`branch_id` int NOT NULL,
	`product_id` int NOT NULL,
	`quantity_available` int NOT NULL DEFAULT 0,
	`quantity_reserved` int NOT NULL DEFAULT 0,
	`reorder_level` int NOT NULL DEFAULT 5,
	`updated_by` int,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `branch_inventory_id` PRIMARY KEY(`id`),
	CONSTRAINT `branch_product_unique` UNIQUE(`branch_id`,`product_id`)
);
--> statement-breakpoint
CREATE TABLE `branches` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(150) NOT NULL,
	`code` varchar(30) NOT NULL,
	`phone` varchar(30) NOT NULL,
	`email` varchar(190),
	`address` text NOT NULL,
	`latitude` decimal(10,7),
	`longitude` decimal(10,7),
	`opening_hours` json,
	`delivery_areas` json,
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `branches_id` PRIMARY KEY(`id`),
	CONSTRAINT `branches_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `categories` (
	`id` int AUTO_INCREMENT NOT NULL,
	`parent_id` int,
	`name` varchar(150) NOT NULL,
	`slug` varchar(170) NOT NULL,
	`image_url` varchar(500),
	`display_order` int NOT NULL DEFAULT 0,
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `categories_id` PRIMARY KEY(`id`),
	CONSTRAINT `categories_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `order_item_fulfilments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`order_item_id` int NOT NULL,
	`branch_id` int NOT NULL,
	`handled_by` int,
	`quantity_reserved` int NOT NULL DEFAULT 0,
	`quantity_packed` int NOT NULL DEFAULT 0,
	`status` enum('UNASSIGNED','RESERVED','PARTIALLY_RESERVED','PACKED','READY','UNAVAILABLE','REPLACED') NOT NULL DEFAULT 'UNASSIGNED',
	`notes` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `order_item_fulfilments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `order_items` (
	`id` int AUTO_INCREMENT NOT NULL,
	`order_id` int NOT NULL,
	`product_id` int NOT NULL,
	`product_name` varchar(220) NOT NULL,
	`quantity` int NOT NULL,
	`unit_price` decimal(12,2) NOT NULL,
	`line_total` decimal(12,2) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `order_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `orders` (
	`id` int AUTO_INCREMENT NOT NULL,
	`order_number` varchar(40) NOT NULL,
	`customer_id` int,
	`customer_name` varchar(200) NOT NULL,
	`phone` varchar(30) NOT NULL,
	`email` varchar(190),
	`fulfilment_method` enum('DELIVERY','PICKUP') NOT NULL,
	`delivery_address` text,
	`delivery_area` varchar(160),
	`status` enum('NEW','CONFIRMED','UNDER_REVIEW','BEING_FULFILLED','PARTIALLY_READY','READY_FOR_DISPATCH','OUT_FOR_DELIVERY','READY_FOR_PICKUP','COMPLETED','CANCELLED') NOT NULL DEFAULT 'NEW',
	`payment_status` enum('PENDING','PAID','FAILED','REFUNDED') NOT NULL DEFAULT 'PENDING',
	`prescription_status` enum('NOT_REQUIRED','RECEIVED','UNDER_REVIEW','APPROVED','MORE_INFORMATION_REQUIRED','DECLINED') NOT NULL DEFAULT 'NOT_REQUIRED',
	`subtotal` decimal(12,2) NOT NULL,
	`delivery_fee` decimal(12,2) NOT NULL DEFAULT '0',
	`discount` decimal(12,2) NOT NULL DEFAULT '0',
	`total` decimal(12,2) NOT NULL,
	`suggested_branch_id` int,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `orders_id` PRIMARY KEY(`id`),
	CONSTRAINT `orders_number_unique` UNIQUE(`order_number`)
);
--> statement-breakpoint
CREATE TABLE `prescriptions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`customer_id` int,
	`order_id` int,
	`storage_key` varchar(500) NOT NULL,
	`original_filename` varchar(255) NOT NULL,
	`mime_type` varchar(100) NOT NULL,
	`size_bytes` int NOT NULL,
	`status` enum('RECEIVED','UNDER_REVIEW','APPROVED','MORE_INFORMATION_REQUIRED','DECLINED') NOT NULL DEFAULT 'RECEIVED',
	`pharmacist_notes` text,
	`reviewed_by` int,
	`reviewed_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `prescriptions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `products` (
	`id` int AUTO_INCREMENT NOT NULL,
	`category_id` int NOT NULL,
	`name` varchar(220) NOT NULL,
	`slug` varchar(240) NOT NULL,
	`sku` varchar(80) NOT NULL,
	`barcode` varchar(100),
	`brand` varchar(150),
	`short_description` varchar(500),
	`description` text,
	`price` decimal(12,2) NOT NULL,
	`discount_price` decimal(12,2),
	`pack_size` varchar(100),
	`product_form` varchar(80),
	`strength` varchar(80),
	`active_ingredient` varchar(190),
	`prescription_required` boolean NOT NULL DEFAULT false,
	`is_featured` boolean NOT NULL DEFAULT false,
	`is_active` boolean NOT NULL DEFAULT true,
	`usage_information` text,
	`warnings` text,
	`storage_information` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `products_id` PRIMARY KEY(`id`),
	CONSTRAINT `products_slug_unique` UNIQUE(`slug`),
	CONSTRAINT `products_sku_unique` UNIQUE(`sku`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` int AUTO_INCREMENT NOT NULL,
	`email` varchar(190) NOT NULL,
	`phone` varchar(30),
	`password_hash` varchar(255) NOT NULL,
	`role` enum('CUSTOMER','STAFF','ADMIN','SUPER_ADMIN') NOT NULL,
	`first_name` varchar(100) NOT NULL,
	`last_name` varchar(100) NOT NULL,
	`is_active` boolean NOT NULL DEFAULT true,
	`two_factor_enabled` boolean NOT NULL DEFAULT false,
	`last_login_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_email_unique` UNIQUE(`email`),
	CONSTRAINT `users_phone_unique` UNIQUE(`phone`)
);
--> statement-breakpoint
ALTER TABLE `activity_logs` ADD CONSTRAINT `activity_logs_actor_id_users_id_fk` FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `branch_inventory` ADD CONSTRAINT `branch_inventory_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `branch_inventory` ADD CONSTRAINT `branch_inventory_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `branch_inventory` ADD CONSTRAINT `branch_inventory_updated_by_users_id_fk` FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `order_item_fulfilments` ADD CONSTRAINT `order_item_fulfilments_order_item_id_order_items_id_fk` FOREIGN KEY (`order_item_id`) REFERENCES `order_items`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `order_item_fulfilments` ADD CONSTRAINT `order_item_fulfilments_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `order_item_fulfilments` ADD CONSTRAINT `order_item_fulfilments_handled_by_users_id_fk` FOREIGN KEY (`handled_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `order_items` ADD CONSTRAINT `order_items_order_id_orders_id_fk` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `order_items` ADD CONSTRAINT `order_items_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `orders` ADD CONSTRAINT `orders_customer_id_users_id_fk` FOREIGN KEY (`customer_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `orders` ADD CONSTRAINT `orders_suggested_branch_id_branches_id_fk` FOREIGN KEY (`suggested_branch_id`) REFERENCES `branches`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `prescriptions` ADD CONSTRAINT `prescriptions_customer_id_users_id_fk` FOREIGN KEY (`customer_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `prescriptions` ADD CONSTRAINT `prescriptions_order_id_orders_id_fk` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `prescriptions` ADD CONSTRAINT `prescriptions_reviewed_by_users_id_fk` FOREIGN KEY (`reviewed_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `products` ADD CONSTRAINT `products_category_id_categories_id_fk` FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `activity_entity_idx` ON `activity_logs` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `inventory_availability_idx` ON `branch_inventory` (`product_id`,`quantity_available`);--> statement-breakpoint
CREATE INDEX `fulfilment_item_idx` ON `order_item_fulfilments` (`order_item_id`);--> statement-breakpoint
CREATE INDEX `order_items_order_idx` ON `order_items` (`order_id`);--> statement-breakpoint
CREATE INDEX `orders_work_queue_idx` ON `orders` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `prescriptions_review_queue_idx` ON `prescriptions` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `products_search_idx` ON `products` (`name`,`brand`);