-- Search-only products: sold normally, but kept out of every listing and recommendation
-- and found only by searching. Prescription medicines are already treated that way by
-- the storefront; this flag is for the non-prescription medicines that must not be
-- advertised either.
ALTER TABLE `products` ADD `search_only` boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Per-event email and SMS switches for everything sent to a customer. Stored as JSON
-- keyed by event id so a new message needs no migration; an event with no entry uses
-- the default in lib/notification-events.ts.
ALTER TABLE `site_settings` ADD `customer_notifications` json NULL;--> statement-breakpoint
-- The two blanket SMS switches from the previous release are replaced by per-event
-- ones. Their events now default to SMS on, so a shop that had turned them on loses
-- nothing, and one that had left them off gets the confirmations it asked for.
ALTER TABLE `site_settings` DROP COLUMN `sms_prescription_updates_enabled`;--> statement-breakpoint
ALTER TABLE `site_settings` DROP COLUMN `sms_consultation_updates_enabled`;
