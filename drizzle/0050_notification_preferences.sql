-- Which internal alerts land in the admin inbox, and which customer-facing SMS the
-- prescription and consultation workflows send. Till payment notifications default
-- off: every Till receipt raised one, and on a busy till day they buried the "new
-- order" email that actually needed a look. The new SMS toggles default off too,
-- since SMS costs money per message and a shop should opt in rather than inherit a
-- new charge.
ALTER TABLE `site_settings` ADD `notify_new_order` boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `site_settings` ADD `notify_order_status_change` boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `site_settings` ADD `notify_customer_received_order` boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `site_settings` ADD `notify_new_prescription` boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `site_settings` ADD `notify_new_consultation` boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `site_settings` ADD `notify_new_customer` boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `site_settings` ADD `notify_till_payment` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `site_settings` ADD `sms_prescription_updates_enabled` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `site_settings` ADD `sms_consultation_updates_enabled` boolean DEFAULT false NOT NULL;
