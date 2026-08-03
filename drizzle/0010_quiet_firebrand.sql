CREATE TABLE `two_factor_challenges` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`token_hash` varchar(64) NOT NULL,
	`code_hash` varchar(64) NOT NULL,
	`attempt_count` int NOT NULL DEFAULT 0,
	`resend_count` int NOT NULL DEFAULT 0,
	`expires_at` timestamp NOT NULL,
	`used_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `two_factor_challenges_id` PRIMARY KEY(`id`),
	CONSTRAINT `two_factor_challenges_token_unique` UNIQUE(`token_hash`)
);
--> statement-breakpoint
CREATE INDEX `two_factor_challenges_user_idx` ON `two_factor_challenges` (`user_id`);