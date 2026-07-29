-- Run this in Supabase's SQL editor (Project -> SQL Editor -> New query)
-- before deploying the functions. This is the one source of truth for
-- who's on which plan.

create table if not exists accounts (
  email text primary key,
  plan text not null default 'free' check (plan in ('free', 'pro', 'team')),
  status text not null default 'none',
  stripe_customer_id text,
  stripe_subscription_id text,
  updated_at timestamptz not null default now()
);

-- Row Level Security: locked down by default. The serverless functions
-- use the service_role key, which bypasses RLS entirely (that's why
-- SUPABASE_SERVICE_ROLE_KEY must only ever live in server-side env
-- vars, never in frontend code). This just makes sure that if someone
-- ever queries this table with the public anon key, they get nothing.
alter table accounts enable row level security;
