-- Run in Supabase SQL Editor if PDF highlights or clients are missing.
-- Safe to run multiple times.

alter table transactions add column if not exists page_number int;
alter table transactions add column if not exists extraction_source varchar(64);
alter table transactions add column if not exists source_meta_json jsonb;

create table if not exists clients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  name varchar(255) not null,
  slug varchar(128) not null,
  status varchar(32) not null default 'active',
  is_default boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organization_id, slug)
);

-- Backfill one default client per org that has none
insert into clients (organization_id, name, slug, is_default, status)
select o.id, 'Default client', 'default', true, 'active'
from organizations o
where not exists (
  select 1 from clients c where c.organization_id = o.id
);

-- Attach orphan documents to each org's default client
update documents d
set client_id = c.id
from clients c
where d.organization_id = c.organization_id
  and c.is_default = true
  and d.client_id is null;
