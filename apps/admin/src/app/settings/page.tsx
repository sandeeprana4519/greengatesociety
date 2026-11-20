'use client';
import React from 'react';
import { AdminShell } from '../../components/AdminShell';

export default function SettingsPage() {
  return (
    <AdminShell>
      <h1 className="text-2xl font-bold text-slate-900">Platform Settings & Notifications</h1>
      <p className="text-sm text-slate-600 mt-1">Phase 2 — Planned Module. FCM campaign broadcast settings activate in Phase 2.</p>
    </AdminShell>
  );
}
