CREATE TABLE `consultations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`reference` varchar(40) NOT NULL,
	`customer_id` int NOT NULL,
	`status` enum('NEW','UNDER_REVIEW','MORE_INFORMATION_REQUIRED','CONSULTATION_IN_PROGRESS','CLOSED') NOT NULL DEFAULT 'NEW',
	`outcome` enum('PENDING','PRESCRIPTION_ISSUED','OTC_RECOMMENDED','REFERRAL_REQUIRED','NO_ACTION_REQUIRED') NOT NULL DEFAULT 'PENDING',
	`concern` text NOT NULL,
	`callback_requested` boolean NOT NULL DEFAULT false,
	`callback_phone` varchar(30),
	`prescription_id` int,
	`assigned_to` int,
	`prescriber_name` varchar(200),
	`prescriber_registration` varchar(60),
	`professional_notes` text,
	`review_version` int NOT NULL DEFAULT 0,
	`last_message_at` timestamp NOT NULL DEFAULT (now()),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `consultations_id` PRIMARY KEY(`id`),
	CONSTRAINT `consultations_reference_unique` UNIQUE(`reference`)
);
--> statement-breakpoint
CREATE TABLE `consultation_messages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`consultation_id` int NOT NULL,
	`sender_id` int NOT NULL,
	`sender_role` enum('CUSTOMER','PROFESSIONAL') NOT NULL,
	`message` text NOT NULL,
	`attachment_key` varchar(500),
	`attachment_name` varchar(255),
	`attachment_mime` varchar(100),
	`attachment_size` int,
	`read_by_customer` boolean NOT NULL DEFAULT false,
	`read_by_professional` boolean NOT NULL DEFAULT false,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `consultation_messages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `consultations` ADD CONSTRAINT `consultations_customer_id_users_id_fk` FOREIGN KEY (`customer_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `consultations` ADD CONSTRAINT `consultations_prescription_id_prescriptions_id_fk` FOREIGN KEY (`prescription_id`) REFERENCES `prescriptions`(`id`) ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `consultations` ADD CONSTRAINT `consultations_assigned_to_users_id_fk` FOREIGN KEY (`assigned_to`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `consultation_messages` ADD CONSTRAINT `consultation_messages_consultation_id_consultations_id_fk` FOREIGN KEY (`consultation_id`) REFERENCES `consultations`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `consultation_messages` ADD CONSTRAINT `consultation_messages_sender_id_users_id_fk` FOREIGN KEY (`sender_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX `consultations_review_queue_idx` ON `consultations` (`status`,`created_at`);
--> statement-breakpoint
CREATE INDEX `consultations_customer_idx` ON `consultations` (`customer_id`,`id`);
--> statement-breakpoint
CREATE INDEX `consultation_messages_thread_idx` ON `consultation_messages` (`consultation_id`,`created_at`);
