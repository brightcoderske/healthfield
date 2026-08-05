ALTER TABLE `users` MODIFY COLUMN `deleted_at` timestamp NULL DEFAULT NULL;--> statement-breakpoint
UPDATE `users` SET `deleted_at` = NULL WHERE `deleted_at` < '1971-01-01 00:00:00';
