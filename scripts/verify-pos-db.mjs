import mysql from "mysql2/promise";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
const pool = mysql.createPool({ uri: process.env.DATABASE_URL, connectionLimit: 1, timezone: "+03:00" });
try {
  const [rows] = await pool.query(`
    select
      (select count(*) from pos_tills) as tills,
      (select count(*) from pos_sessions) as sessions,
      (select count(*) from information_schema.columns
        where table_schema = database() and table_name = 'orders'
          and column_name in ('pos_session_id','cashier_id','till_id','transacted_at')) as order_columns,
      (select count(*) from information_schema.tables
        where table_schema = database()
          and table_name in ('pos_sessions','pos_held_sales','pos_expenses','pos_suppliers','pos_stock_receipts','pos_stock_receipt_items','product_batches')) as pos_tables,
      (select count(*) from information_schema.columns
        where table_schema = database() and table_name = 'pos_stock_receipts' and column_name = 'supplier_id') as supplier_link_column,
      (select count(*) from information_schema.columns
        where table_schema = database() and table_name = 'pos_expenses' and column_name = 'payment_method') as expense_method_column
  `);
  const evidence = rows[0];
  if (Number(evidence.order_columns) !== 4 || Number(evidence.pos_tables) !== 7 || Number(evidence.supplier_link_column) !== 1 || Number(evidence.expense_method_column) !== 1 || Number(evidence.tills) < 1) {
    throw new Error(`POS schema verification failed: ${JSON.stringify(evidence)}`);
  }
  console.log(`POS database verified: ${evidence.pos_tables} tables, reusable suppliers linked, ${evidence.order_columns} order links, ${evidence.tills} till(s), ${evidence.sessions} existing session(s).`);
} finally {
  await pool.end();
}
