CREATE TABLE `sms_messages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`recipient` varchar(20) NOT NULL,
	`purpose` varchar(40) NOT NULL,
	`sender_id` varchar(30) NOT NULL,
	`channel` enum('TRANSACTIONAL','PROMOTIONAL') NOT NULL,
	`message` text NOT NULL,
	`segments` int NOT NULL DEFAULT 1,
	`provider_message_id` varchar(64),
	`status` enum('SENT','FAILED','DELIVERED','UNDELIVERED','PENDING') NOT NULL DEFAULT 'PENDING',
	`response_code` varchar(10),
	`detail` varchar(255),
	`order_id` int,
	`campaign_id` int,
	`delivered_at_ms` bigint,
	`last_checked_at_ms` bigint,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `sms_messages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `sms_messages_recent_idx` ON `sms_messages` (`created_at`);--> statement-breakpoint
CREATE INDEX `sms_messages_status_idx` ON `sms_messages` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `sms_messages_provider_idx` ON `sms_messages` (`provider_message_id`);
