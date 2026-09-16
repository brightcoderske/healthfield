-- Variants: one product, several things to actually buy — Blue/Red/Green, 100/200/500 ml.
--
-- Deliberately NOT a separate variants table. A variant is the unit the shop counts,
-- scans and costs, and ten tables already key off `products.id` for exactly that:
-- branch_inventory, product_batches, pos_stock_receipt_items, order_items,
-- prescription_request_items, offer_items, product_reviews,
-- product_health_conditions, blog_post_products and promotional_banners. Making a
-- variant a product row leaves every one of them correct with no change at all.
--
-- The lead variant is an ordinary product with `variant_of` NULL; its siblings point at
-- it. Existing products have no siblings and no label, so they stay plain products and
-- nothing about them changes.
ALTER TABLE `products` ADD `variant_of` int;--> statement-breakpoint
ALTER TABLE `products` ADD `variant_label` varchar(80);--> statement-breakpoint
ALTER TABLE `products` ADD `variant_name` varchar(40);--> statement-breakpoint
ALTER TABLE `products` ADD `variant_order` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD CONSTRAINT `products_variant_of_fk`
  FOREIGN KEY (`variant_of`) REFERENCES `products`(`id`);--> statement-breakpoint
-- Walking a group: every variant of a lead, in the order the shop arranged them.
CREATE INDEX `products_variant_of_idx` ON `products` (`variant_of`,`variant_order`);
