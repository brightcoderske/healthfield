-- The storefront lists active products ordered by featured, then newest. That was a
-- full table scan plus a filesort on every catalogue load; this index turns it into a
-- backward index scan with no sort.
CREATE INDEX `products_storefront_idx` ON `products` (`is_active`,`is_featured`,`created_at`);
