'use client';
import React from 'react';
import { AdminShell } from '../../components/AdminShell';

export default function RolesPage() {
  return (
    <AdminShell>
      <h1 className="text-2xl font-bold text-slate-900">Roles & Permissions</h1>
      <p className="text-sm text-slate-600 mt-1">Granular RBAC permission sets enforced by Firestore rules and Cloud Functions.</p>
    </AdminShell>
  );
}
