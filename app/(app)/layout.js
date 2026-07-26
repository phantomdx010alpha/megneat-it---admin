'use client';

/**
 * app/(app)/layout.js
 *
 * Route guard: every page inside this group requires a live Supabase Auth
 * session against the registry project, or it redirects to /login.
 * Mirrors the decision-tree shape of the client-facing PWA's own
 * app/(app)/layout.js, minus the "no config yet -> /activate" branch (this
 * app has no per-device activation concept — it always has exactly one
 * registry project, known via env vars from Phase 1).
 *
 * ADMIN_PANEL_MASTERPLAN.md Phase 2 out-of-scope note: no roles/permissions
 * here — a valid session is a valid session, since this is explicitly a
 * single-operator tool.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSession, onAuthStateChange } from '@/lib/auth/session';

export default function AppLayout({ children }) {
  const router = useRouter();
  const [guardChecked, setGuardChecked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe = null;

    async function runGuard() {
      const session = await getSession();

      if (!session) {
        if (!cancelled) router.replace('/login');
        return;
      }

      if (!cancelled) setGuardChecked(true);

      // Keep listening after the initial check — a token expiring or a
      // sign-out triggered elsewhere in the app should bounce back to
      // /login immediately, not just on next navigation.
      unsubscribe = onAuthStateChange((_event, newSession) => {
        if (cancelled) return;
        if (!newSession) router.replace('/login');
      });
    }

    runGuard();

    return () => {
      cancelled = true;
      if (unsubscribe) unsubscribe();
    };
  }, [router]);

  // Avoid flashing protected content before the guard has confirmed a
  // session exists.
  if (!guardChecked) return null;

  return children;
}
