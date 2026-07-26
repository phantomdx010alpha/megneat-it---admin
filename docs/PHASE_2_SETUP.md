# Phase 2 setup — manual step + verify

Phase 2 adds the login gate and route guard. The code is done; one manual
step in your registry Supabase project is still yours to do (same
no-self-signup pattern the shell's own business-owner login already uses —
there is deliberately no signup UI anywhere in this app).

## 1. Create the one admin account

1. In your registry project's Supabase dashboard, go to
   **Authentication → Users**.
2. Click **Add user** → **Create new user**.
3. Enter your own email + a password you'll remember. Leave "Auto Confirm
   User" checked (there's no email-confirmation flow built here — this
   isn't a public signup path, it's you creating your own single account).
4. That's it — no metadata, no roles to assign (Phase 2 explicitly has no
   multi-admin/roles support; flagged as a candidate future phase only if
   it's ever actually needed).

## 2. Run it

```bash
npm install
npm run dev
```

Visit http://localhost:3000 — you should be redirected straight to
`/login` (no session yet).

## 3. Verify

- **Sign in works:** enter the email/password from step 1 → redirects to
  `/` and shows "Signed in" with your email.
- **Route guard works:** open a private/incognito window (no session) and
  visit `/` directly → redirects to `/login` rather than showing the
  authenticated page.
- **Sign out works:** click "Sign out" on `/` → redirects back to
  `/login`, and a subsequent visit to `/` redirects to `/login` again
  (confirms the session was actually cleared, not just the UI state).
- **Session persists across reloads:** after signing in, hard-refresh the
  page — you should stay on `/` rather than bouncing to `/login` (this is
  the Supabase client's default localStorage-backed session persistence,
  which Phase 2 explicitly says is fine here since there's no Dexie
  offline layer to keep consistent with).

## What changed structurally

- `/login` is a public route (`app/login/page.js`).
- Everything else now lives under the `app/(app)/` route group, whose
  `layout.js` is the guard: no session → redirect to `/login`, checked on
  mount and kept live via `onAuthStateChange` so an expired/cleared session
  bounces immediately rather than only on next navigation.
- `lib/auth/session.js` is a simplified version of the client-facing PWA's
  own file — no mock mode, no device-registration step, since neither
  concept applies to a single-operator admin tool.
