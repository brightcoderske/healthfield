ALTER TABLE `pos_expenses` ADD `payment_method` enum('CASH','MPESA','OTHER') NOT NULL DEFAULT 'CASH';
