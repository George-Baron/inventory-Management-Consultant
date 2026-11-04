-- Asotech Business Advisory: database schema for Supabase (PostgreSQL).
-- The app also creates these tables automatically on first start, so running
-- this file is optional. Run it in Supabase > SQL Editor if you prefer to
-- create them yourself.

create extension if not exists pgcrypto;

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null unique,
  password_hash text not null,
  role text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists records (
  id uuid primary key default gen_random_uuid(),
  module text not null,
  data jsonb not null default '{}'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists records_module_idx on records (module, created_at desc);

create table if not exists leads (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text,
  phone text,
  service text,
  message text,
  status text not null default 'New',
  created_at timestamptz not null default now()
);

-- Row level security ON with no public policies: Supabase's public API cannot
-- read these tables. Only this server (connecting with the database password) can.
alter table users enable row level security;
alter table records enable row level security;
alter table leads enable row level security;
