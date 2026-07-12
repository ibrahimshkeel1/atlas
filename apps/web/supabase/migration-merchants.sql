-- Run in Supabase SQL Editor if merchants tables are missing (after schema.sql)

create table if not exists merchants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id),
  client_id uuid references clients(id),
  name varchar(255) not null,
  slug varchar(128) not null,
  category_id uuid references categories(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organization_id, slug)
);
create index if not exists ix_merchants_organization_id on merchants(organization_id);

create table if not exists merchant_aliases (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchants(id) on delete cascade,
  organization_id uuid references organizations(id),
  client_id uuid references clients(id),
  pattern varchar(512) not null,
  match_type varchar(32) not null default 'contains',
  priority int not null default 100,
  source varchar(32) not null default 'user',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organization_id, pattern, match_type)
);
create index if not exists ix_merchant_aliases_merchant_id on merchant_aliases(merchant_id);
