-- A product that is not on sale cannot appear on the homepage, so a featured one that is
-- switched off holds one of the ten places against a product that could have used it.
-- The API now refuses to star an inactive product and clears the star when a product is
-- taken off sale; this clears the ones that predate that rule.
UPDATE `products` SET `is_featured` = false, `featured_at` = NULL
WHERE `is_featured` = true AND `is_active` = false;
