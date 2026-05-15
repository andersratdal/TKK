alter table public.loans
add column if not exists return_email_sent_at timestamptz null;
