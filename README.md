# Asotech Business Advisory: website and staff workspace

A public website (Home, Services, Portfolio, Contact) plus a private staff workspace.
The administrator signs in, creates staff accounts, and each person lands on tools for their profession.

| Role | Tools |
| --- | --- |
| Administrator | Everything, staff accounts, website enquiries |
| Audit | Audit findings, stock count variances |
| Accountant | Accounts ledger, invoices |
| HR | Recruitment pipeline, structure inspection |
| Inventory | Stock list (low-stock flags), stock count variances |
| Sales | Sales pipeline, website enquiries |
| Marketing | Content and campaigns |

Login uses its own email and password (bcrypt hashed, 12-hour session cookie).
Every tool has search, add, edit, delete and CSV export.

## Run it on your computer

```bash
npm install
cp .env.example .env      # then set ADMIN_EMAIL and ADMIN_PASSWORD
npm start
```

Open http://localhost:3000. With `DATABASE_URL` empty, data is kept in `data/db.json`.

## Put it online (GitHub, Supabase, Render)

### 1. GitHub
Create a new empty repository on github.com, then in this folder:

```bash
git init
git add .
git commit -m "Asotech Business Advisory site"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPO.git
git push -u origin main
```

The `.gitignore` keeps passwords and local data out of GitHub.

### 2. Supabase (the database)
1. Create a project at supabase.com and set a database password. Keep it safe.
2. Open **Project Settings > Database > Connection string**, choose **URI** and copy it.
   Use the **Session pooler** string if the direct one does not connect from Render.
3. Replace `[YOUR-PASSWORD]` in it with your database password.
4. Tables are created automatically on first start. (Optional: paste `supabase/schema.sql` into the SQL Editor.)

### 3. Render (the web server)
1. On render.com choose **New > Web Service** and connect your GitHub repository.
   (Or **New > Blueprint**, which reads `render.yaml`.)
2. Build command `npm install`, start command `npm start`.
3. Add environment variables:
   - `NODE_ENV` = `production`
   - `JWT_SECRET` = a long random text (Render can generate it)
   - `DATABASE_URL` = the Supabase string from step 2
   - `ADMIN_EMAIL` and `ADMIN_PASSWORD` = your first administrator login
4. Deploy. Visit your Render address, go to **Staff login**, and sign in.
5. After signing in, you may remove `ADMIN_PASSWORD` from Render's settings.

Render's free plan sleeps after inactivity, so the first visit can take about 30 seconds.
Paid plans stay awake.

### Your own domain
In Render: **Settings > Custom Domains**, then add the DNS record your domain provider asks for.

## Where to edit things
- Wording and pages: `views/*.html`
- Colours and fonts: top of `public/css/site.css`
- Staff tools, fields and which role sees what: `config/modules.js`
- Contact details: environment variables, or the defaults in `server.js`

## Security notes
- Public registration does not exist; only the administrator can create accounts.
- Login attempts and the contact form are rate limited.
- Disabled or deleted staff lose access immediately.
- Database tables have row-level security on, so Supabase's public API cannot read them.
- Do not share the Supabase database password or `JWT_SECRET`.
