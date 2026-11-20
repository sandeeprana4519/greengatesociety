'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut } from 'firebase/auth';
import { ADMIN_SIDEBAR_MODULES } from '@society-marketplace/constants';
import { auth, testAdminFirestoreConnection } from '../lib/firebase';
import { useAdminAuth } from '../hooks/useAdminAuth';

const ROUTE_MAP: Record<string, string> = {
  overview: '/dashboard',
  societies: '/societies',
  customers: '/customers',
  bulk_offers: '/campaigns',
  group_buying: '/campaigns',
  products: '/products',
  services: '/services',
  vendors: '/vendors',
  orders: '/orders',
  group_participation: '/campaigns',
  payments: '/reports',
  settlements: '/reports',
  work_orders: '/vendors',
  staff: '/staff',
  roles: '/roles',
  reports: '/reports',
  complaints: '/reports',
  notifications: '/settings',
  settings: '/settings',
  audit_logs: '/dashboard',
};

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, role, authorized, loading, configMissing } = useAdminAuth();
  const [connOk, setConnOk] = useState<boolean | null>(null);

  useEffect(() => {
    testAdminFirestoreConnection().then((r) => setConnOk(r.ok));
  }, []);

  if (configMissing) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F8FAF9] p-6">
        <div className="max-w-lg w-full bg-white border border-slate-200 rounded-xl p-6">
          <h1 className="text-lg font-semibold text-red-700">Firebase Configuration Pending</h1>
          <p className="mt-2 text-sm text-slate-600">
            Configure NEXT_PUBLIC_FIREBASE_* variables in .env.local to connect the Admin Dashboard.
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F8FAF9] text-sm text-slate-600">
        Verifying administrator permissions...
      </div>
    );
  }

  if (!user || !authorized) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F8FAF9] p-6">
        <div className="max-w-md w-full bg-white border border-slate-200 rounded-xl p-6">
          <h1 className="text-lg font-semibold text-slate-900">Restricted Admin Route</h1>
          <p className="mt-2 text-sm text-slate-600">
            An authorized staff profile and server-assigned role are required to access this workspace.
          </p>
          <Link
            href="/login"
            className="mt-4 inline-flex items-center justify-center px-4 py-2 rounded-lg bg-[#0F3D2E] text-white text-sm font-medium"
          >
            Go to Admin Sign In
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex bg-[#F8FAF9]">
      <aside className="w-64 shrink-0 bg-[#0F3D2E] text-white flex flex-col">
        <div className="px-5 py-4 border-b border-white/10">
          <div className="text-base font-bold tracking-tight">GreenGate Admin</div>
          <div className="text-xs text-emerald-200/80 mt-0.5">
            {role?.name ?? 'Super Administrator'} · {connOk ? 'Connected' : 'Checking'}
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
          {ADMIN_SIDEBAR_MODULES.map((mod) => {
            const href = ROUTE_MAP[mod.id] ?? '/dashboard';
            const active = pathname === href;
            return (
              <Link
                key={mod.id}
                href={href}
                className={`flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors ${
                  active ? 'bg-white/15 text-white font-medium' : 'text-emerald-100/80 hover:bg-white/10'
                }`}
              >
                <span className="truncate">{mod.label}</span>
                {mod.phase === 2 ? (
                  <span className="text-[11px] text-emerald-200/70">Phase 3</span>
                ) : null}
              </Link>
            );
          })}
          <div className="mt-4 pt-3 border-t border-white/10 px-3 space-y-1">
            <div className="text-[10px] uppercase tracking-wider text-emerald-200/60 font-semibold">
              Verification Shortcuts
            </div>
            <Link href="/societies?tab=towers_flats" className="block py-1 text-xs text-emerald-100/80 hover:text-white">
              Towers &amp; Flats
            </Link>
            <Link href="/societies?tab=invitation_codes" className="block py-1 text-xs text-emerald-100/80 hover:text-white">
              Invitation Codes
            </Link>
            <Link href="/customers?status=pending" className="block py-1 text-xs text-emerald-100/80 hover:text-white">
              Pending Verifications
            </Link>
          </div>
        </nav>
        <div className="p-3 border-t border-white/10">
          <button
            onClick={() => auth && signOut(auth)}
            className="w-full px-3 py-2 text-xs font-medium rounded-lg bg-white/10 hover:bg-white/15 text-white"
          >
            Sign Out
          </button>
        </div>
      </aside>
      <main className="flex-1 min-w-0 p-6 lg:p-8">{children}</main>
    </div>
  );
}
