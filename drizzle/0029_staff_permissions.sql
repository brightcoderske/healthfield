CREATE TABLE `staff_permissions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`permission` varchar(80) NOT NULL,
	`granted_by` int,
	`granted_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `staff_permissions_id` PRIMARY KEY(`id`),
	CONSTRAINT `staff_permission_unique` UNIQUE(`user_id`,`permission`)
);
--> statement-breakpoint
ALTER TABLE `staff_permissions` ADD CONSTRAINT `staff_permissions_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `staff_permissions` ADD CONSTRAINT `staff_permissions_granted_by_users_id_fk` FOREIGN KEY (`granted_by`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX `staff_permissions_user_idx` ON `staff_permissions` (`user_id`);
--> statement-breakpoint
INSERT INTO `staff_permissions` (`user_id`,`permission`,`granted_by`)
SELECT `users`.`id`, `permission_defaults`.`permission`, NULL
FROM `users`
CROSS JOIN (
	SELECT 'DASHBOARD_VIEW' AS `permission` UNION ALL
	SELECT 'PRODUCTS_VIEW' UNION ALL
	SELECT 'POS_USE' UNION ALL
	SELECT 'ORDERS_VIEW' UNION ALL
	SELECT 'ORDERS_PROCESS' UNION ALL
	SELECT 'PAST_ORDERS_VIEW' UNION ALL
	SELECT 'RECEIPTS_VIEW' UNION ALL
	SELECT 'PAYMENTS_REVIEW' UNION ALL
	SELECT 'PRESCRIPTIONS_VIEW' UNION ALL
	SELECT 'PRESCRIPTIONS_PROCESS' UNION ALL
	SELECT 'INVENTORY_VIEW' UNION ALL
	SELECT 'INVENTORY_UPDATE' UNION ALL
	SELECT 'OFFERS_MANAGE' UNION ALL
	SELECT 'BLOGS_MANAGE'
) AS `permission_defaults`
WHERE `users`.`role` = 'STAFF' AND `users`.`deleted_at` IS NULL;
