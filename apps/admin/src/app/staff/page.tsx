'use client';
import React from 'react';
import { AdminShell } from '../../components/AdminShell';

export default function StaffPage() {
  return (
    <AdminShell>
      <h1 className="text-2xl font-bold text-slate-900">Staff Management</h1>
      <p className="text-sm text-slate-600 mt-1">Manage staff accounts and server-verified role assignments.</p>
    </AdminShell>
  );
}
