ALTER TABLE `two_factor_challenges` MODIFY COLUMN `used_at` timestamp NULL DEFAULT NULL;--> statement-breakpoint
UPDATE `two_factor_challenges` SET `used_at` = NULL WHERE `used_at` IS NOT NULL AND CAST(`used_at` AS CHAR) LIKE '0000-00-00%';--> statement-breakpoint
ALTER TABLE `email_verification_tokens` MODIFY COLUMN `used_at` timestamp NULL DEFAULT NULL;--> statement-breakpoint
UPDATE `email_verification_tokens` SET `used_at` = NULL WHERE `used_at` IS NOT NULL AND CAST(`used_at` AS CHAR) LIKE '0000-00-00%';--> statement-breakpoint
ALTER TABLE `users` MODIFY COLUMN `email_verified_at` timestamp NULL DEFAULT NULL;--> statement-breakpoint
UPDATE `users` SET `email_verified_at` = NULL WHERE `email_verified_at` IS NOT NULL AND CAST(`email_verified_at` AS CHAR) LIKE '0000-00-00%';
