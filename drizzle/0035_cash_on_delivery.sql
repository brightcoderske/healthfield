ALTER TABLE `site_settings` ADD `online_cod_enabled` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `payment_transactions` MODIFY COLUMN `method` enum('MPESA_EXPRESS','MANUAL_MPESA','CASH','CASH_ON_DELIVERY') NOT NULL;
