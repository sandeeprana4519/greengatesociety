'use client';
import React from 'react';
import { AdminShell } from '../../components/AdminShell';

export default function ProductsPage() {
  return (
    <AdminShell>
      <h1 className="text-2xl font-bold text-slate-900">Buy Now Products</h1>
      <p className="text-sm text-slate-600 mt-1">Manage catalog products for individual society orders.</p>
    </AdminShell>
  );
}
