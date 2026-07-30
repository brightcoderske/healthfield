CREATE TABLE `campaigns` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(180) NOT NULL,
	`channel` enum('EMAIL','SMS','EMAIL_AND_SMS') NOT NULL,
	`subject` varchar(220),
	`message` text NOT NULL,
	`status` enum('DRAFT','SENDING','SENT','FAILED') NOT NULL DEFAULT 'DRAFT',
	`recipient_count` int NOT NULL DEFAULT 0,
	`success_count` int NOT NULL DEFAULT 0,
	`failure_count` int NOT NULL DEFAULT 0,
	`created_by` int NOT NULL,
	`sent_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `campaigns_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `site_settings` ADD `bulk_sms_api_url` varchar(500);--> statement-breakpoint
ALTER TABLE `site_settings` ADD `bulk_sms_api_key` varchar(500);--> statement-breakpoint
ALTER TABLE `site_settings` ADD `bulk_sms_sender_id` varchar(50);--> statement-breakpoint
ALTER TABLE `site_settings` ADD `email_api_url` varchar(500);--> statement-breakpoint
ALTER TABLE `site_settings` ADD `email_api_key` varchar(500);--> statement-breakpoint
ALTER TABLE `site_settings` ADD `campaign_from_email` varchar(190);--> statement-breakpoint
ALTER TABLE `campaigns` ADD CONSTRAINT `campaigns_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `campaign_status_idx` ON `campaigns` (`status`,`created_at`);