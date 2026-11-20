'use client';
import React from 'react';
import { AdminShell } from '../../components/AdminShell';

export default function CampaignsPage() {
  return (
    <AdminShell>
      <h1 className="text-2xl font-bold text-slate-900">Campaigns (Bulk Offers & Group Buying)</h1>
      <p className="text-sm text-slate-600 mt-1">
        Manage society-isolated bulk vendor offers and group buying campaigns.
      </p>
    </AdminShell>
  );
}
