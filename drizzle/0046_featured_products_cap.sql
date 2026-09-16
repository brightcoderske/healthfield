-- Featured is now a fixed shelf of ten, not an open-ended flag. Ordering by
-- `created_at` could not answer "which was featured longest ago" — a product made in
-- 2024 and starred this morning would have looked like the oldest — so the moment a
-- product is featured is recorded in its own column.
--
-- Declared `NULL DEFAULT NULL` on purpose: production runs with
-- explicit_defaults_for_timestamp OFF, where a bare nullable timestamp silently
-- becomes NOT NULL with a zero date and starts reading back as an Invalid Date.
ALTER TABLE `products` ADD `featured_at` timestamp NULL DEFAULT NULL;--> statement-breakpoint
-- Everything already featured is treated as featured since it was created, which puts
-- the long-standing ones at the front of the eviction queue.
UPDATE `products` SET `featured_at` = `created_at` WHERE `is_featured` = true;--> statement-breakpoint
-- Bring an over-full shelf down to ten, keeping the ten most recently featured. The
-- flag is what is cleared; no product is otherwise touched.
UPDATE `products` SET `is_featured` = false, `featured_at` = NULL
WHERE `is_featured` = true AND `id` NOT IN (
  SELECT `id` FROM (
    SELECT `id` FROM `products` WHERE `is_featured` = true
    ORDER BY `featured_at` DESC, `id` DESC LIMIT 10
  ) AS `keep`
);--> statement-breakpoint
-- The homepage draws its random sample from active, non-prescription products; the
-- featured shelf is read by featured_at. Both are covered here.
CREATE INDEX `products_featured_idx` ON `products` (`is_active`,`is_featured`,`featured_at`);
