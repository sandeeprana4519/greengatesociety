/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { AppAuthProvider, useAppAuth } from './contexts/AppAuthContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import { CustomerPortal } from './components/CustomerPortal';
import { AdminPortal } from './components/AdminPortal';
import {
  configuredDatabaseId,
  configuredProjectId,
  isFirebaseConfigured,
} from './lib/firebase';

type PortalMode = 'customer' | 'admin' | 'architecture';

function ArchitectureView() {
  const { connectionStatus, connectionError } = useAppAuth();
  return (
    <div className="max-w-5xl mx-auto px-4 py-10 space-y-6">
      <div className="bg-white border border-slate-200 rounded-2xl p-6 lg:p-8">
        <h1 className="text-2xl font-bold text-slate-900">
          Phase 1 Architecture &amp; Firebase Connection
        </h1>
        <p className="mt-2 text-sm text-slate-600 leading-relaxed">
          Multi-tenant Society Marketplace monorepo connecting the Expo Router mobile app, Next.js Admin Dashboard, Cloud Functions, and Firestore Security Rules.
        </p>

        <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4 border-t border-slate-100 pt-6 text-sm">
          <div>
            <div className="text-xs text-slate-500">Firebase Project ID</div>
            <div className="mt-1 font-mono font-semibold text-slate-900">
              {configuredProjectId || 'Not Configured'}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Firestore Database ID</div>
            <div className="mt-1 font-mono font-semibold text-slate-900">
              {configuredDatabaseId}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Live Connection Probe</div>
            <div
              className={`mt-1 font-semibold ${
                connectionStatus === 'connected' ? 'text-emerald-700' : 'text-red-600'
              }`}
            >
              {connectionStatus === 'connected'
                ? 'Connected'
                : connectionError || 'Checking...'}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white border border-slate-200 rounded-2xl p-6">
          <h2 className="text-base font-bold text-slate-900">Monorepo Packages &amp; Apps</h2>
          <ul className="mt-3 space-y-2 text-sm text-slate-600">
            <li>
              <span className="font-mono text-xs text-[#0F3D2E]">apps/customer</span> · Expo Router React Native app with 3 primary tabs (Home, Buy, Services)
            </li>
            <li>
              <span className="font-mono text-xs text-[#0F3D2E]">apps/admin</span> · Next.js App Router enterprise dashboard with 20-module sidebar
            </li>
            <li>
              <span className="font-mono text-xs text-[#0F3D2E]">functions</span> · Firebase Cloud Functions with transactional membership, order &amp; audit endpoints
            </li>
            <li>
              <span className="font-mono text-xs text-[#0F3D2E]">packages/*</span> · Shared TypeScript types, validation, constants, and paise business logic
            </li>
          </ul>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-6">
          <h2 className="text-base font-bold text-slate-900">Society-Level Security Guarantees</h2>
          <ul className="mt-3 space-y-2 text-sm text-slate-600">
            <li>Deny-by-default Firestore rules isolating Society A from Society B</li>
            <li>Unverified &amp; pending users blocked from marketplace campaigns, orders, and bookings</li>
            <li>Customers blocked from modifying societyId, verificationStatus, paymentStatus, or counters</li>
            <li>Automated Emulator test suite in <span className="font-mono text-xs">firestore.rules.test.ts</span></li>
          </ul>
        </div>
      </div>
    </div>
  );
}

function MarketplaceShell() {
  const { firebaseUser, logout, connectionStatus, connectionError } = useAppAuth();
  const [mode, setMode] = useState<PortalMode>('customer');

  if (!isFirebaseConfigured) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F8FAF9] p-6">
        <div className="max-w-lg w-full bg-white border border-red-200 rounded-2xl p-8">
          <h1 className="text-xl font-bold text-red-700">Firebase Configuration Pending</h1>
          <p className="mt-2 text-sm text-slate-600 leading-relaxed">
            No live Firebase configuration was found in <span className="font-mono">firebase-applet-config.json</span>. Connect your Firebase project before running the marketplace.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-[#F8FAF9]">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="sticky top-0 z-30 bg-white border-b border-slate-200 px-4 lg:px-8 h-16 flex items-center justify-between gap-8">
        <button
          onClick={() => setMode('customer')}
          className="text-lg font-bold tracking-tight text-[#0F3D2E] whitespace-nowrap shrink-0"
        >
          GreenGate
        </button>

        <nav className="flex items-center gap-6 text-sm font-medium text-slate-600">
          <button
            onClick={() => setMode('customer')}
            className={`whitespace-nowrap shrink-0 transition-colors ${
              mode === 'customer'
                ? 'text-[#0F3D2E] font-semibold underline underline-offset-8'
                : 'hover:text-slate-900'
            }`}
          >
            Customer App
          </button>
          <button
            onClick={() => setMode('admin')}
            className={`whitespace-nowrap shrink-0 transition-colors ${
              mode === 'admin'
                ? 'text-[#0F3D2E] font-semibold underline underline-offset-8'
                : 'hover:text-slate-900'
            }`}
          >
            Admin Console
          </button>
          <button
            onClick={() => setMode('architecture')}
            className={`hidden sm:inline-block whitespace-nowrap shrink-0 transition-colors ${
              mode === 'architecture'
                ? 'text-[#0F3D2E] font-semibold underline underline-offset-8'
                : 'hover:text-slate-900'
            }`}
          >
            Architecture
          </button>
        </nav>

        <div className="flex items-center gap-3 shrink-0">
          {firebaseUser ? (
            <button
              onClick={logout}
              className="px-4 py-2 rounded-lg bg-[#0F3D2E] text-white text-xs font-semibold hover:bg-[#0B2E22] whitespace-nowrap shrink-0"
            >
              Sign Out
            </button>
          ) : (
            <button
              onClick={() => setMode(mode === 'admin' ? 'customer' : 'admin')}
              className="px-4 py-2 rounded-lg bg-[#0F3D2E] text-white text-xs font-semibold hover:bg-[#0B2E22] whitespace-nowrap shrink-0"
            >
              {mode === 'admin' ? 'Resident View' : 'Admin Sign In'}
            </button>
          )}
        </div>
      </header>

      {connectionStatus === 'error' && connectionError ? (
        <div className="bg-red-50 border-b border-red-200 px-6 py-2.5 text-xs text-red-700 text-center">
          Firebase Connection Issue: {connectionError}
        </div>
      ) : null}

      <main className="flex-1">
        {mode === 'customer' ? (
          <CustomerPortal onSwitchToAdmin={() => setMode('admin')} />
        ) : null}
        {mode === 'admin' ? <AdminPortal /> : null}
        {mode === 'architecture' ? <ArchitectureView /> : null}
      </main>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppAuthProvider>
        <MarketplaceShell />
      </AppAuthProvider>
    </ErrorBoundary>
  );
}
