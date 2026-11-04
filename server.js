require('dotenv').config();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const { ROLES, MODULES, modulesForRole } = require('./config/modules');
const { initDb } = require('./lib/db');

const PROD = process.env.NODE_ENV === 'production';
const PORT = process.env.PORT || 3000;
const COOKIE = 'asotech_session';

let JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  if (PROD) {
    console.error('JWT_SECRET must be set in production.');
    process.exit(1);
  }
  JWT_SECRET = crypto.randomBytes(32).toString('hex'); // dev only: sessions reset on restart
}

const SITE = {
  name: 'Asotech Business Advisory',
  email: process.env.CONTACT_EMAIL || 'Asotechservice@gmail.com',
  phone: process.env.CONTACT_PHONE || '0901 266 1712',
  whatsapp: process.env.CONTACT_WHATSAPP || '2349012661712',
};

(async () => {
  const db = await initDb();
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com'],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
          upgradeInsecureRequests: PROD ? [] : null,
        },
      },
    })
  );
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  // ---------- first admin ----------
  async function seedAdmin() {
    if ((await db.users.count()) > 0) return;
    const email = process.env.ADMIN_EMAIL;
    const password = process.env.ADMIN_PASSWORD;
    if (!email || !password || password.length < 8) {
      console.warn('No users yet. Set ADMIN_EMAIL and ADMIN_PASSWORD (8+ chars) and restart to create the first admin.');
      return;
    }
    await db.users.create({
      name: process.env.ADMIN_NAME || 'Administrator',
      email: email.trim().toLowerCase(),
      password_hash: await bcrypt.hash(password, 12),
      role: 'admin',
    });
    console.log('First admin created:', email);
  }
  await seedAdmin();

  // ---------- auth helpers ----------
  const sign = (u) => jwt.sign({ sub: u.id }, JWT_SECRET, { expiresIn: '12h' });
  const setCookie = (res, token) =>
    res.cookie(COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: PROD,
      maxAge: 12 * 60 * 60 * 1000,
      path: '/',
    });

  async function auth(req, res, next) {
    try {
      const token = req.cookies[COOKIE];
      if (!token) return res.status(401).json({ error: 'Please sign in.' });
      const { sub } = jwt.verify(token, JWT_SECRET);
      const user = await db.users.byId(sub);
      if (!user || !user.active) return res.status(401).json({ error: 'Account not available.' });
      req.user = { id: user.id, name: user.name, email: user.email, role: user.role };
      next();
    } catch (e) {
      res.status(401).json({ error: 'Session expired. Please sign in again.' });
    }
  }
  const adminOnly = (req, res, next) =>
    req.user.role === 'admin' ? next() : res.status(403).json({ error: 'Administrators only.' });

  const wrap = (fn) => (req, res) =>
    fn(req, res).catch((e) => {
      console.error(e);
      res.status(500).json({ error: 'Something went wrong. Please try again.' });
    });

  const str = (v, max = 500) => (v == null ? '' : String(v).trim().slice(0, max));

  // ---------- public: contact form ----------
  const leadLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false });
  app.post(
    '/api/leads',
    leadLimiter,
    wrap(async (req, res) => {
      const b = req.body || {};
      if (b.website) return res.json({ ok: true }); // honeypot: bots fill this
      const lead = {
        name: str(b.name, 120),
        email: str(b.email, 160),
        phone: str(b.phone, 40),
        service: str(b.service, 120),
        message: str(b.message, 2000),
      };
      if (!lead.name || (!lead.email && !lead.phone)) {
        return res.status(400).json({ error: 'Please give your name and an email or phone number.' });
      }
      if (lead.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.email)) {
        return res.status(400).json({ error: 'That email address does not look right.' });
      }
      await db.leads.create(lead);
      res.json({ ok: true });
    })
  );

  // ---------- auth ----------
  const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false });
  app.post(
    '/api/auth/login',
    loginLimiter,
    wrap(async (req, res) => {
      const email = str(req.body && req.body.email, 160).toLowerCase();
      const password = String((req.body && req.body.password) || '');
      const user = email ? await db.users.byEmail(email) : null;
      // compare even when the user is missing so timing does not reveal which emails exist
      const ok = await bcrypt.compare(password, user ? user.password_hash : '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinva');
      if (!user || !ok || !user.active) return res.status(401).json({ error: 'Wrong email or password.' });
      setCookie(res, sign(user));
      res.json({ ok: true });
    })
  );
  app.post('/api/auth/logout', (req, res) => {
    res.clearCookie(COOKIE, { path: '/' });
    res.json({ ok: true });
  });

  app.get('/api/me', auth, (req, res) => {
    const modules = modulesForRole(req.user.role).map((id) => ({ id, ...MODULES[id] }));
    res.json({ user: req.user, roleLabel: ROLES[req.user.role], modules, roles: ROLES });
  });

  app.post(
    '/api/me/password',
    auth,
    wrap(async (req, res) => {
      const { current, next } = req.body || {};
      const user = await db.users.byId(req.user.id);
      if (!(await bcrypt.compare(String(current || ''), user.password_hash))) {
        return res.status(400).json({ error: 'Current password is wrong.' });
      }
      if (String(next || '').length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters.' });
      await db.users.update(user.id, { password_hash: await bcrypt.hash(String(next), 12) });
      res.json({ ok: true });
    })
  );

  // ---------- records (role-gated) ----------
  function cleanRecord(mod, body) {
    const out = {};
    for (const f of mod.fields) {
      if (f.type === 'computed') continue;
      let v = body[f.key];
      if (f.type === 'number') {
        v = v === '' || v == null ? null : Number(v);
        if (v !== null && !Number.isFinite(v)) throw new Error(`${f.label} must be a number.`);
      } else {
        v = str(v, f.type === 'textarea' ? 2000 : 300);
        if (f.type === 'select' && v && !f.options.includes(v)) throw new Error(`${f.label} has an invalid choice.`);
      }
      if (f.required && (v === '' || v === null)) throw new Error(`${f.label} is required.`);
      out[f.key] = v;
    }
    return out;
  }
  function moduleGuard(req, res, next) {
    const mod = MODULES[req.params.module];
    if (!mod) return res.status(404).json({ error: 'Unknown module.' });
    if (req.user.role !== 'admin' && !mod.roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'You do not have access to this area.' });
    }
    req.mod = mod;
    next();
  }

  app.get('/api/records/:module', auth, moduleGuard, wrap(async (req, res) => {
    res.json({ records: await db.records.list(req.params.module) });
  }));
  app.post('/api/records/:module', auth, moduleGuard, wrap(async (req, res) => {
    let data;
    try { data = cleanRecord(req.mod, req.body || {}); } catch (e) { return res.status(400).json({ error: e.message }); }
    res.json({ record: await db.records.create(req.params.module, data, req.user.id) });
  }));
  app.put('/api/records/:module/:id', auth, moduleGuard, wrap(async (req, res) => {
    let data;
    try { data = cleanRecord(req.mod, req.body || {}); } catch (e) { return res.status(400).json({ error: e.message }); }
    const row = await db.records.update(req.params.module, req.params.id, data);
    if (!row) return res.status(404).json({ error: 'Record not found.' });
    res.json({ record: row });
  }));
  app.delete('/api/records/:module/:id', auth, moduleGuard, wrap(async (req, res) => {
    await db.records.remove(req.params.module, req.params.id);
    res.json({ ok: true });
  }));

  // ---------- admin: staff accounts ----------
  app.get('/api/users', auth, adminOnly, wrap(async (req, res) => res.json({ users: await db.users.list() })));

  app.post('/api/users', auth, adminOnly, wrap(async (req, res) => {
    const b = req.body || {};
    const name = str(b.name, 120);
    const email = str(b.email, 160).toLowerCase();
    const role = str(b.role, 30);
    const password = String(b.password || '');
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Enter a name and a valid email.' });
    if (!ROLES[role]) return res.status(400).json({ error: 'Choose a role.' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    if (await db.users.byEmail(email)) return res.status(409).json({ error: 'That email already has an account.' });
    const user = await db.users.create({ name, email, role, password_hash: await bcrypt.hash(password, 12) });
    res.json({ user });
  }));

  app.patch('/api/users/:id', auth, adminOnly, wrap(async (req, res) => {
    const b = req.body || {};
    const patch = {};
    if (b.name !== undefined) patch.name = str(b.name, 120);
    if (b.role !== undefined) {
      if (!ROLES[b.role]) return res.status(400).json({ error: 'Invalid role.' });
      patch.role = b.role;
    }
    if (b.active !== undefined) patch.active = !!b.active;
    if (b.password) {
      if (String(b.password).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
      patch.password_hash = await bcrypt.hash(String(b.password), 12);
    }
    if (req.params.id === req.user.id && (patch.role !== undefined || patch.active === false)) {
      return res.status(400).json({ error: 'You cannot change your own role or deactivate yourself.' });
    }
    const user = await db.users.update(req.params.id, patch);
    if (!user) return res.status(404).json({ error: 'User not found.' });
    res.json({ user });
  }));

  app.delete('/api/users/:id', auth, adminOnly, wrap(async (req, res) => {
    if (req.params.id === req.user.id) return res.status(400).json({ error: 'You cannot delete your own account.' });
    await db.users.remove(req.params.id);
    res.json({ ok: true });
  }));

  // ---------- leads inbox (admin + sales) ----------
  const leadsAccess = (req, res, next) =>
    ['admin', 'sales'].includes(req.user.role) ? next() : res.status(403).json({ error: 'No access.' });
  app.get('/api/leads', auth, leadsAccess, wrap(async (req, res) => res.json({ leads: await db.leads.list() })));
  app.patch('/api/leads/:id', auth, leadsAccess, wrap(async (req, res) => {
    const status = str(req.body && req.body.status, 30);
    if (!['New', 'Contacted', 'Won', 'Closed'].includes(status)) return res.status(400).json({ error: 'Invalid status.' });
    const lead = await db.leads.setStatus(req.params.id, status);
    if (!lead) return res.status(404).json({ error: 'Not found.' });
    res.json({ lead });
  }));
  app.delete('/api/leads/:id', auth, adminOnly, wrap(async (req, res) => {
    await db.leads.remove(req.params.id);
    res.json({ ok: true });
  }));

  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

  // ---------- public pages (shared header/footer) ----------
  const views = path.join(__dirname, 'views');
  const partial = (n) => fs.readFileSync(path.join(views, 'partials', n), 'utf8');
  const fill = (s) =>
    s
      .replace(/{{SITE_NAME}}/g, SITE.name)
      .replace(/{{EMAIL}}/g, SITE.email)
      .replace(/{{PHONE}}/g, SITE.phone)
      .replace(/{{WHATSAPP}}/g, SITE.whatsapp)
      .replace(/{{YEAR}}/g, String(new Date().getFullYear()));
  const pages = {
    '/': 'home',
    '/services': 'services',
    '/portfolio': 'portfolio',
    '/contact': 'contact',
    '/login': 'login',
  };
  const header = fill(partial('header.html'));
  const footer = fill(partial('footer.html'));
  for (const [route, name] of Object.entries(pages)) {
    const body = fill(fs.readFileSync(path.join(views, `${name}.html`), 'utf8'));
    app.get(route, (req, res) => {
      const html = body
        .replace('{{HEADER}}', header.replace(`data-nav="${name}"`, `data-nav="${name}" aria-current="page"`))
        .replace('{{FOOTER}}', footer);
      res.type('html').send(html);
    });
  }
  app.get('/app', (req, res) => res.sendFile(path.join(__dirname, 'public', 'app.html')));

  app.use(express.static(path.join(__dirname, 'public'), { maxAge: PROD ? '1h' : 0, index: false }));
  app.use((req, res) => res.status(404).type('html').send(fill(fs.readFileSync(path.join(views, '404.html'), 'utf8')).replace('{{HEADER}}', header).replace('{{FOOTER}}', footer)));

  app.listen(PORT, () => console.log(`${SITE.name} running on port ${PORT} (${db.kind} storage)`));
})().catch((e) => {
  console.error('Startup failed:', e);
  process.exit(1);
});
