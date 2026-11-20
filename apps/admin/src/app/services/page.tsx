'use client';
import React from 'react';
import { AdminShell } from '../../components/AdminShell';

export default function ServicesPage() {
  return (
    <AdminShell>
      <h1 className="text-2xl font-bold text-slate-900">Home Services Catalog</h1>
      <p className="text-sm text-slate-600 mt-1">Manage hyperlocal home service categories and starting prices.</p>
    </AdminShell>
  );
}
