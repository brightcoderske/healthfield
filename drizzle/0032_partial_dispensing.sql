ALTER TABLE `prescription_request_items` ADD `dispense_rule` enum('COURSE_BOUND','DIVISIBLE') DEFAULT 'COURSE_BOUND' NOT NULL;
--> statement-breakpoint
ALTER TABLE `prescription_request_items` ADD `minimum_quantity` int;
--> statement-breakpoint
ALTER TABLE `prescription_request_items` ADD `selected_quantity` int;
--> statement-breakpoint
ALTER TABLE `prescription_request_items` ADD `deferred` boolean DEFAULT false NOT NULL;
