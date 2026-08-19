-- Bulk SMS credentials moved to the API environment (Celcom), so the admin no longer
-- holds them and the storefront settings row no longer carries them.
ALTER TABLE `site_settings` DROP COLUMN `bulk_sms_api_url`;--> statement-breakpoint
ALTER TABLE `site_settings` DROP COLUMN `bulk_sms_api_key`;--> statement-breakpoint
ALTER TABLE `site_settings` DROP COLUMN `bulk_sms_sender_id`;
