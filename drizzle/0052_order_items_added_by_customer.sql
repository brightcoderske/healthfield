-- Items a customer adds from their own cart to an approved prescription's order, so the
-- two can be paid in one go. Marked so they can be told apart from the pharmacist's lines.
ALTER TABLE `order_items` ADD `added_by_customer` boolean DEFAULT false NOT NULL;
