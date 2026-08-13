ALTER TABLE `payment_transactions` MODIFY COLUMN `status` enum('INITIATED','PENDING','CANCEL_REQUESTED','REQUIRES_REVIEW','PAID','FAILED','CANCELLED','REFUNDED') NOT NULL DEFAULT 'INITIATED';
--> statement-breakpoint
ALTER TABLE `mpesa_incoming_payments` ADD `payer_name` varchar(200);
