ALTER TABLE `auth_sessions` MODIFY COLUMN `revoked_at` timestamp NULL DEFAULT NULL;--> statement-breakpoint
DELETE FROM `auth_sessions` WHERE `revoked_at` = `created_at`;
