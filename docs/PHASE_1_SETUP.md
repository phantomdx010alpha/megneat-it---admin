# Phase 1 setup — manual steps

The scaffold and migration are done for you (see repo root). These are the
parts of Phase 1 that only you can do, since they touch your own Supabase
account. Follow them in order.

## 1. Create the registry Supabase project

1. Go to https://supabase.com/dashboard and create a new project.
2. Name it something you'll recognize as "the registry" — e.g.
   `magneatit-admin-registry` — distinct from any client/target project.
3. Pick any region; this project holds admin metadata only, not client data,
   so region choice isn't performance-sensitive.
4. Wait for provisioning to finish (a couple of minutes).

## 2. Run the Phase 1 migration

1. In the new project, open **SQL Editor**.
2. Paste in the contents of `supabase/migrations/0001_projects_stub.sql`
   from this repo and run it.
3. Confirm no errors, then check **Table Editor** → you should see an empty
   `projects` table.

## 3. Grab the URL + anon key

1. **Settings → API** in the Supabase dashboard.
2. Copy the **Project URL** and the **anon / public key** (not the
   `service_role` key — that one is never used by this app until Phase 4,
   and only ever server-side).

## 4. Wire up local env vars

```bash
cp .env.local.example .env.local
```

Edit `.env.local` and fill in the two values from step 3.

## 5. Run it

```bash
npm install
npm run dev
```

Visit http://localhost:3000 — you should see a "Magneatit Admin / Phase 1
scaffold" card render with the neumorphic styling from the existing PWA's
design tokens.

## 6. Verify RLS is actually scoped (the important check)

Open the browser console on any page (or a scratch HTML file) and run:

```js
const url = 'https://YOUR-PROJECT.supabase.co';
const anonKey = 'YOUR-ANON-KEY';

// (a) Unfiltered listing — should FAIL (403 / permission denied).
// There is no direct SELECT grant on `projects` at all.
fetch(`${url}/rest/v1/projects?select=*`, {
  headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
}).then(r => r.json()).then(console.log);

// First, insert one test row manually via Table Editor and copy its id.
// (b) Exact-match lookup via the RPC — should SUCCEED, returning that one row.
fetch(`${url}/rest/v1/rpc/get_project_by_id`, {
  method: 'POST',
  headers: {
    apikey: anonKey,
    Authorization: `Bearer ${anonKey}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ p_id: 'PASTE-THE-TEST-ROW-ID-HERE' }),
}).then(r => r.json()).then(console.log);
```

Expected: (a) returns an error object (permission denied for table
`projects`), (b) returns a one-item array with that row's `id`, `label`,
`created_at`.

**Why this shape, not a simple `using (true)` policy:** see the comment
block at the bottom of `0001_projects_stub.sql` — this registry will hold
service-role keys from Phase 3 onward, so it can't rely on "trust the
client's query filter" the way the simpler shell/PWA license lookup does.
