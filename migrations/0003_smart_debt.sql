-- Smart Debt: add columns to debts table
ALTER TABLE debts ADD COLUMN due_date TEXT;
ALTER TABLE debts ADD COLUMN interest_rate REAL DEFAULT 0;
ALTER TABLE debts ADD COLUMN interest_type TEXT DEFAULT 'none';
ALTER TABLE debts ADD COLUMN tenor_months INTEGER;
ALTER TABLE debts ADD COLUMN installment_amount INTEGER;
ALTER TABLE debts ADD COLUMN installment_freq TEXT DEFAULT 'monthly';
ALTER TABLE debts ADD COLUMN next_payment_date TEXT;
ALTER TABLE debts ADD COLUMN total_with_interest INTEGER;
