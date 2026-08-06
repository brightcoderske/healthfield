ALTER TABLE `prescriptions` ADD `sender_name` varchar(200);--> statement-breakpoint
UPDATE `prescriptions` INNER JOIN `users` ON `prescriptions`.`customer_id` = `users`.`id` SET `prescriptions`.`sender_name` = TRIM(CONCAT(`users`.`first_name`, ' ', `users`.`last_name`)) WHERE `prescriptions`.`sender_name` IS NULL;
