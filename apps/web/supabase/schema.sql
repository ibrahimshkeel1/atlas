-- Atlas schema for Supabase (run once in SQL Editor)
-- Project: thnnlxhzayzermmitmgm

create extension if not exists "pgcrypto";

create table if not exists organizations (
  id uuid primary key default gen_random_uuid(),
  name varchar(255) not null,
  slug varchar(255) not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email varchar(320) not null unique,
  password_hash varchar(255) not null,
  full_name varchar(255) not null,
  organization_id uuid not null references organizations(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ix_users_organization_id on users(organization_id);

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

create table if not exists categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id),
  name varchar(128) not null,
  slug varchar(128) not null,
  type varchar(32) not null,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ix_categories_organization_id on categories(organization_id);

create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  client_id uuid references clients(id),
  filename varchar(512) not null,
  s3_key varchar(1024) not null,
  status varchar(32) not null default 'uploaded',
  page_count int,
  error_message text,
  bank_name varchar(255),
  content_hash varchar(64),
  extraction_meta_json jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ix_documents_organization_id on documents(organization_id);
create index if not exists ix_documents_content_hash on documents(content_hash);

create table if not exists transactions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  client_id uuid references clients(id),
  document_id uuid not null references documents(id) on delete cascade,
  category_id uuid references categories(id),
  transaction_date date not null,
  description text not null,
  debit numeric(18,2),
  credit numeric(18,2),
  balance numeric(18,2),
  reference varchar(255),
  confidence_score numeric(5,4),
  needs_review boolean not null default true,
  raw_json jsonb,
  page_number int,
  extraction_source varchar(64),
  source_meta_json jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ix_transactions_org_date on transactions(organization_id, transaction_date);
create index if not exists ix_transactions_document_id on transactions(document_id);

create table if not exists category_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  client_id uuid references clients(id),
  match_type varchar(32) not null default 'contains',
  pattern varchar(512) not null,
  category_id uuid not null references categories(id),
  priority int not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists period_closes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  client_id uuid references clients(id),
  period_key varchar(7) not null,
  period_start date not null,
  period_end date not null,
  locked_at timestamptz not null default now(),
  locked_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organization_id, period_key)
);

create table if not exists audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  client_id uuid references clients(id),
  user_id uuid references users(id),
  action varchar(128) not null,
  entity_type varchar(128) not null,
  entity_id varchar(64),
  before_json jsonb,
  after_json jsonb,
  meta_json jsonb,
  ip_address varchar(64),
  user_agent varchar(512),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Storage bucket (also create in Dashboard if this fails)
-- insert into storage.buckets (id, name, public) values ('atlas-documents', 'atlas-documents', false)
-- on conflict do nothing;
