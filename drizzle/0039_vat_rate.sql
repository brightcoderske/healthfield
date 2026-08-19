ALTER TABLE `site_settings` ADD `vat_enabled` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `site_settings` ADD `vat_rate` decimal(5,2) DEFAULT '0.00' NOT NULL;
