'use client';
import React from 'react';
import { AdminShell } from '../../components/AdminShell';

export default function ReportsPage() {
  return (
    <AdminShell>
      <h1 className="text-2xl font-bold text-slate-900">Payments, Settlements & Reports</h1>
      <p className="text-sm text-slate-600 mt-1">Phase 2 — Planned Module. Payment gateway reconciliation and vendor settlements activate in Phase 2.</p>
    </AdminShell>
  );
}
