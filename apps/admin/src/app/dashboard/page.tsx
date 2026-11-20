'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  collection,
  collectionGroup,
  getCountFromServer,
  getDocs,
  limit,
  orderBy,
  query,
} from 'firebase/firestore';
import type { AuditLog, SocietyMembership } from '@society-marketplace/shared-types';
import { AdminShell } from '../../components/AdminShell';
import { db } from '../../lib/firebase';

export default function AdminDashboardPage() {
  const [counts, setCounts] = useState({
    societies: 0,
    users: 0,
    pending: 0,
    approved: 0,
    rejected: 0,
    suspended: 0,
  });
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!db) return;
    Promise.all([
      getCountFromServer(collection(db, 'societies')),
      getCountFromServer(collection(db, 'users')),
      getDocs(collectionGroup(db, 'members')),
      getDocs(query(collection(db, 'auditLogs'), orderBy('createdAt', 'desc'), limit(20))),
    ])
      .then(([socSnap, usrSnap, membersSnap, logSnap]) => {
        const members = membersSnap.docs.map((d) => d.data() as SocietyMembership);
        setCounts({
          societies: socSnap.data().count,
          users: usrSnap.data().count,
          pending: members.filter((m) => m.verificationStatus === 'pending').length,
          approved: members.filter((m) => m.verificationStatus === 'approved').length,
          rejected: members.filter((m) => m.verificationStatus === 'rejected').length,
          suspended: members.filter((m) => m.verificationStatus === 'suspended').length,
        });
        setLogs(logSnap.docs.map((d) => d.data() as AuditLog));
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <AdminShell>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Operations Overview</h1>
          <p className="text-sm text-slate-600 mt-1">
            Live society verification and resident metrics from Cloud Firestore.
          </p>
        </div>
        <Link
          href="/customers?status=pending"
          className="px-4 py-2 rounded-xl bg-[#0F3D2E] text-white text-xs font-semibold"
        >
          Review Pending Verifications ({loading ? '—' : counts.pending})
        </Link>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 mt-6">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs font-medium text-slate-500">Total Societies</div>
          <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-1">
            {loading ? '—' : counts.societies}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs font-medium text-slate-500">Registered Residents</div>
          <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-1">
            {loading ? '—' : counts.users}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs font-medium text-slate-500">Pending Verifications</div>
          <div className="text-2xl font-bold font-mono tabular-nums text-amber-700 mt-1">
            {loading ? '—' : counts.pending}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs font-medium text-slate-500">Approved Residents</div>
          <div className="text-2xl font-bold font-mono tabular-nums text-emerald-700 mt-1">
            {loading ? '—' : counts.approved}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs font-medium text-slate-500">Rejected Applications</div>
          <div className="text-2xl font-bold font-mono tabular-nums text-red-700 mt-1">
            {loading ? '—' : counts.rejected}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs font-medium text-slate-500">Suspended Accounts</div>
          <div className="text-2xl font-bold font-mono tabular-nums text-slate-700 mt-1">
            {loading ? '—' : counts.suspended}
          </div>
        </div>
      </div>

      <div className="mt-8 bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 font-semibold text-slate-900">
          Recent Security &amp; Admin Audit Logs
        </div>
        {logs.length === 0 ? (
          <div className="p-6 text-sm text-slate-500">No audit logs recorded yet.</div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500 border-b border-slate-200">
              <tr>
                <th className="px-5 py-3">Action</th>
                <th className="px-5 py-3">Actor</th>
                <th className="px-5 py-3">Target</th>
                <th className="px-5 py-3">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {logs.map((log) => (
                <tr key={log.logId}>
                  <td className="px-5 py-3 font-mono text-xs text-slate-900">{log.action}</td>
                  <td className="px-5 py-3 text-slate-600">{log.actorEmail || log.actorUid}</td>
                  <td className="px-5 py-3 text-slate-600">
                    {log.targetCollection}/{log.targetId}
                  </td>
                  <td className="px-5 py-3 text-slate-600">{log.details}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </AdminShell>
  );
}
