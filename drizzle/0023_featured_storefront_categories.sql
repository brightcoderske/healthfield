ALTER TABLE `categories` ADD `featured_on_storefront` boolean NOT NULL DEFAULT false;--> statement-breakpoint
UPDATE `categories` SET `featured_on_storefront` = true WHERE `id` IN (
  SELECT `id` FROM (
    SELECT `id` FROM `categories` WHERE `is_active` = true ORDER BY `display_order` ASC, `id` ASC LIMIT 6
  ) AS `seed`
);
