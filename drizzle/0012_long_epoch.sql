ALTER TABLE `email_verification_tokens` ADD `expires_at_ms` bigint;--> statement-breakpoint
ALTER TABLE `two_factor_challenges` ADD `expires_at_ms` bigint;--> statement-breakpoint
ALTER TABLE `two_factor_challenges` ADD `last_sent_at_ms` bigint;