// Data layer. Uses Supabase Postgres when DATABASE_URL is set,
// otherwise a local JSON file (data/db.json) so you can run and test with no setup.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SCHEMA = `
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
alter table users enable row level security;
alter table records enable row level security;
alter table leads enable row level security;
`;

// ---------- Postgres (Supabase) ----------
async function pgStore(url) {
  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
    max: 5,
  });
  await pool.query(SCHEMA);
  const q = (text, params) => pool.query(text, params).then((r) => r.rows);
  const one = (text, params) => q(text, params).then((r) => r[0] || null);

  return {
    kind: 'postgres',
    users: {
      count: () => one('select count(*)::int as n from users').then((r) => r.n),
      byEmail: (email) => one('select * from users where lower(email)=lower($1)', [email]),
      byId: (id) => one('select * from users where id=$1', [id]),
      list: () => q('select id,name,email,role,active,created_at from users order by created_at'),
      create: (u) =>
        one(
          'insert into users (name,email,password_hash,role) values ($1,$2,$3,$4) returning id,name,email,role,active,created_at',
          [u.name, u.email, u.password_hash, u.role]
        ),
      update: async (id, patch) => {
        const cols = [];
        const vals = [];
        for (const k of ['name', 'role', 'active', 'password_hash']) {
          if (patch[k] !== undefined) {
            vals.push(patch[k]);
            cols.push(`${k}=$${vals.length}`);
          }
        }
        if (!cols.length) return one('select id,name,email,role,active,created_at from users where id=$1', [id]);
        vals.push(id);
        return one(
          `update users set ${cols.join(',')} where id=$${vals.length} returning id,name,email,role,active,created_at`,
          vals
        );
      },
      remove: (id) => q('delete from users where id=$1', [id]),
    },
    records: {
      list: (module) => q('select * from records where module=$1 order by created_at desc', [module]),
      create: (module, data, userId) =>
        one('insert into records (module,data,created_by) values ($1,$2,$3) returning *', [module, data, userId]),
      update: (module, id, data) =>
        one('update records set data=$3, updated_at=now() where id=$2 and module=$1 returning *', [module, id, data]),
      remove: (module, id) => q('delete from records where id=$2 and module=$1', [module, id]),
    },
    leads: {
      create: (l) =>
        one('insert into leads (name,email,phone,service,message) values ($1,$2,$3,$4,$5) returning *', [
          l.name,
          l.email,
          l.phone,
          l.service,
          l.message,
        ]),
      list: () => q('select * from leads order by created_at desc limit 500'),
      setStatus: (id, status) => one('update leads set status=$2 where id=$1 returning *', [id, status]),
      remove: (id) => q('delete from leads where id=$1', [id]),
    },
  };
}

// ---------- Local JSON file ----------
function fileStore(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let db = { users: [], records: [], leads: [] };
  if (fs.existsSync(file)) {
    try {
      db = { ...db, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
    } catch (e) {
      console.error('Could not read', file, '- starting empty');
    }
  }
  let timer = null;
  const save = () => {
    clearTimeout(timer);
    timer = setTimeout(() => fs.writeFileSync(file, JSON.stringify(db, null, 2)), 50);
  };
  const now = () => new Date().toISOString();
  const pub = ({ password_hash, ...rest }) => rest;

  return {
    kind: 'file',
    users: {
      count: async () => db.users.length,
      byEmail: async (email) => db.users.find((u) => u.email.toLowerCase() === String(email).toLowerCase()) || null,
      byId: async (id) => db.users.find((u) => u.id === id) || null,
      list: async () => db.users.map(pub),
      create: async (u) => {
        const row = { id: crypto.randomUUID(), active: true, created_at: now(), ...u };
        db.users.push(row);
        save();
        return pub(row);
      },
      update: async (id, patch) => {
        const row = db.users.find((u) => u.id === id);
        if (!row) return null;
        for (const k of ['name', 'role', 'active', 'password_hash']) if (patch[k] !== undefined) row[k] = patch[k];
        save();
        return pub(row);
      },
      remove: async (id) => {
        db.users = db.users.filter((u) => u.id !== id);
        save();
      },
    },
    records: {
      list: async (module) =>
        db.records.filter((r) => r.module === module).sort((a, b) => (a.created_at < b.created_at ? 1 : -1)),
      create: async (module, data, userId) => {
        const row = { id: crypto.randomUUID(), module, data, created_by: userId, created_at: now(), updated_at: now() };
        db.records.push(row);
        save();
        return row;
      },
      update: async (module, id, data) => {
        const row = db.records.find((r) => r.id === id && r.module === module);
        if (!row) return null;
        row.data = data;
        row.updated_at = now();
        save();
        return row;
      },
      remove: async (module, id) => {
        db.records = db.records.filter((r) => !(r.id === id && r.module === module));
        save();
      },
    },
    leads: {
      create: async (l) => {
        const row = { id: crypto.randomUUID(), status: 'New', created_at: now(), ...l };
        db.leads.push(row);
        save();
        return row;
      },
      list: async () => [...db.leads].sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).slice(0, 500),
      setStatus: async (id, status) => {
        const row = db.leads.find((l) => l.id === id);
        if (!row) return null;
        row.status = status;
        save();
        return row;
      },
      remove: async (id) => {
        db.leads = db.leads.filter((l) => l.id !== id);
        save();
      },
    },
  };
}

async function initDb() {
  if (process.env.DATABASE_URL) return pgStore(process.env.DATABASE_URL);
  return fileStore(path.join(__dirname, '..', 'data', 'db.json'));
}

module.exports = { initDb };
