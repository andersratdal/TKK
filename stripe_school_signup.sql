-- Legg til fødselsdato på påmeldinger
alter table public.skating_school_signups
add column if not exists birth_date date null;

-- Appen trenger å kunne lese og oppdatere påmeldinger
drop policy if exists "Allow read skating school signups" on public.skating_school_signups;
create policy "Allow read skating school signups"
on public.skating_school_signups
for select
to anon, authenticated
using (true);

drop policy if exists "Allow update skating school signups" on public.skating_school_signups;
create policy "Allow update skating school signups"
on public.skating_school_signups
for update
to anon, authenticated
using (true)
with check (true);


alter table public.skating_school_signups
add column if not exists has_own_skates boolean not null default false;

-- Stripe-felter for betaling av skøyteskolepåmelding
alter table public.skating_school_signups
add column if not exists payment_status text not null default 'Ubetalt';

alter table public.skating_school_signups
add column if not exists amount_nok integer null;

alter table public.skating_school_signups
add column if not exists stripe_checkout_session_id text null;

alter table public.skating_school_signups
add column if not exists stripe_payment_intent_id text null;

alter table public.skating_school_signups
add column if not exists paid_at timestamptz null;
