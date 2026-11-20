'use client';
import React from 'react';
import { AdminShell } from '../../components/AdminShell';

export default function OrdersPage() {
  return (
    <AdminShell>
      <h1 className="text-2xl font-bold text-slate-900">Orders & Service Bookings</h1>
      <p className="text-sm text-slate-600 mt-1">Inspect society-scoped resident orders and service requests.</p>
    </AdminShell>
  );
}
