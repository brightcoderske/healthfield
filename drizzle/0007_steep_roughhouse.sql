ALTER TABLE `users` ADD `terms_accepted_at` timestamp;--> statement-breakpoint
ALTER TABLE `users` ADD `marketing_consent` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `marketing_consent_at` timestamp;