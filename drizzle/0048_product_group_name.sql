-- The product's label-free name.
--
-- A variant row's `name` is what that row actually is — "Tote bag — Red" — so every
-- existing reader of a product name stays correct without knowing variants exist: the
-- basket, the snapshotted order line, the till, the receipt, the dispensing list. That
-- leaves nowhere to keep the product's own name, which is what a group's card and page
-- are titled with, so it is kept once, on the lead. Only the storefront's grouping reads
-- it. The alternative was appending the label at nine separate read sites and trusting
-- that none was ever missed.
ALTER TABLE `products` ADD `group_name` varchar(220);
