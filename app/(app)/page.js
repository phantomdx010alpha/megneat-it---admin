'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { SignOut, FolderSimple, UserPlus, Users, ClockCounterClockwise, Broadcast } from '@phosphor-icons/react';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import { getSession, signOut } from '@/lib/auth/session';

export default function Home() {
  const router = useRouter();
  const [email, setEmail] = useState(null);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getSession().then((session) => {
      if (!cancelled) setEmail(session?.user?.email ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await signOut();
      router.replace('/login');
    } catch (err) {
      setSigningOut(false);
      console.error('[app/(app)/page.js] sign out failed:', err.message);
    }
  }

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--surface)',
        fontFamily: 'var(--font-family)',
        padding: 'var(--space-6)',
      }}
    >
      <Card padding="lg" style={{ maxWidth: 480, width: '100%' }}>
        <h1
          style={{
            fontSize: 'var(--font-size-md)',
            color: 'var(--text-primary)',
            marginBottom: 'var(--space-2)',
          }}
        >
          Magneatit Admin
        </h1>
        <p style={{ color: 'var(--text-secondary)', marginBottom: 'var(--space-3)' }}>
          Registry, projects, and clients — no Supabase Studio required.
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-5)' }}>
          <Badge tone="accent">Signed in</Badge>
          {email && (
            <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)' }}>{email}</span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
          {/* Phase 5 connectivity fix (see docs/PHASE_5_SETUP.md §3), extended
              here in Phase 6, again in Phase 7, and now Phase 11 with the
              same reasoning: every phase's own primary screen needs an
              entry point from here, not just the newest one. */}
          <Button variant="raised" onClick={() => router.push('/projects')}>
            <FolderSimple size={16} weight="bold" aria-hidden="true" />
            Projects
          </Button>
          <Button variant="raised" onClick={() => router.push('/clients')}>
            <Users size={16} weight="bold" aria-hidden="true" />
            Clients
          </Button>
          <Button variant="primary" onClick={() => router.push('/clients/new')}>
            <UserPlus size={16} weight="bold" aria-hidden="true" />
            Add client
          </Button>
          <Button variant="raised" onClick={() => router.push('/activity')}>
            <ClockCounterClockwise size={16} weight="bold" aria-hidden="true" />
            Activity
          </Button>
          {/* ADMIN_PANEL_SCHEMA_BROADCAST_MASTERPLAN.md, Phase 2 — same
              "every phase's own primary screen needs an entry point from
              here" convention as the comment above this block already
              established for Phase 5/6/7/11. */}
          <Button variant="raised" onClick={() => router.push('/schema-push')}>
            <Broadcast size={16} weight="bold" aria-hidden="true" />
            Schema push
          </Button>
          <Button variant="ghost" onClick={handleSignOut} disabled={signingOut}>
            <SignOut size={16} weight="bold" aria-hidden="true" />
            {signingOut ? 'Signing out...' : 'Sign out'}
          </Button>
        </div>
      </Card>
    </main>
  );
}
