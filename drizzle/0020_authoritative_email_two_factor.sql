ALTER TABLE `two_factor_challenges` ADD `challenge_ends_at_ms` bigint;--> statement-breakpoint
UPDATE `two_factor_challenges`
SET `challenge_ends_at_ms` = COALESCE(`last_sent_at_ms`, UNIX_TIMESTAMP(`created_at`) * 1000) + 2700000
WHERE `challenge_ends_at_ms` IS NULL;--> statement-breakpoint
ALTER TABLE `two_factor_challenges` MODIFY COLUMN `challenge_ends_at_ms` bigint NOT NULL;
