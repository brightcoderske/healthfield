CREATE TABLE `pos_suppliers` (
  `id` int AUTO_INCREMENT NOT NULL,
  `name` varchar(200) NOT NULL,
  `name_key` varchar(200) NOT NULL,
  `phone` varchar(30),
  `created_by` int,
  `last_received_at` timestamp NULL,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `pos_suppliers_id` PRIMARY KEY(`id`),
  CONSTRAINT `pos_suppliers_name_key_unique` UNIQUE(`name_key`),
  CONSTRAINT `pos_suppliers_created_by_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`)
);--> statement-breakpoint
CREATE INDEX `pos_suppliers_name_idx` ON `pos_suppliers` (`name`);--> statement-breakpoint
INSERT INTO `pos_suppliers` (`name`, `name_key`, `phone`, `created_by`, `last_received_at`)
SELECT MIN(TRIM(`supplier_name`)), LOWER(TRIM(`supplier_name`)), MAX(NULLIF(TRIM(`supplier_phone`), '')), MIN(`received_by`), MAX(`received_at`)
FROM `pos_stock_receipts`
WHERE TRIM(`supplier_name`) <> ''
GROUP BY LOWER(TRIM(`supplier_name`));--> statement-breakpoint
ALTER TABLE `pos_stock_receipts` ADD `supplier_id` int NULL AFTER `received_by`;--> statement-breakpoint
UPDATE `pos_stock_receipts` receipt
INNER JOIN `pos_suppliers` supplier ON supplier.`name_key` = LOWER(TRIM(receipt.`supplier_name`))
SET receipt.`supplier_id` = supplier.`id`;--> statement-breakpoint
ALTER TABLE `pos_stock_receipts` ADD CONSTRAINT `pos_stock_receipts_supplier_fk` FOREIGN KEY (`supplier_id`) REFERENCES `pos_suppliers`(`id`);--> statement-breakpoint
CREATE INDEX `pos_stock_receipts_supplier_idx` ON `pos_stock_receipts` (`supplier_id`,`received_at`);
