'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from 'firebase/firestore';
import type {
  MembershipVerificationHistory,
  Society,
  SocietyMembership,
} from '@society-marketplace/shared-types';
import { normalizeFlatDocId } from '@society-marketplace/business-logic';
import { validateAdminReason } from '@society-marketplace/validation';
import { AdminShell } from '../../components/AdminShell';
import { useAdminAuth } from '../../hooks/useAdminAuth';
import { db } from '../../lib/firebase';

export default function AdminCustomersPage() {
  const { user, role } = useAdminAuth();
  const [members, setMembers] = useState<SocietyMembership[]>([]);
  const [societies, setSocieties] = useState<Society[]>([]);
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'approved' | 'rejected' | 'suspended'>('all');
  const [search, setSearch] = useState('');
  const [inspectMember, setInspectMember] = useState<SocietyMembership | null>(null);
  const [history, setHistory] = useState<MembershipVerificationHistory[]>([]);
  const [decisionModal, setDecisionModal] = useState<{
    type: 'approve' | 'reject' | 'info' | 'suspend' | 'reactivate';
    member: SocietyMembership;
  } | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!db) return;
    const u1 = onSnapshot(collectionGroup(db, 'members'), (snap) => {
      setMembers(snap.docs.map((d) => d.data() as SocietyMembership));
    });
    const u2 = onSnapshot(collection(db, 'societies'), (snap) => {
      setSocieties(snap.docs.map((d) => d.data() as Society));
    });
    return () => {
      u1();
      u2();
    };
  }, []);

  useEffect(() => {
    if (!db || !inspectMember) {
      setHistory([]);
      return;
    }
    return onSnapshot(
      query(
        collection(db, 'societies', inspectMember.societyId, 'verificationHistory'),
        where('uid', '==', inspectMember.uid),
        orderBy('createdAt', 'desc')
      ),
      (snap) => setHistory(snap.docs.map((d) => d.data() as MembershipVerificationHistory))
    );
  }, [inspectMember]);

  const societyMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const s of societies) map[s.societyId] = s.societyName;
    return map;
  }, [societies]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return members.filter((m) => {
      if (statusFilter !== 'all' && m.verificationStatus !== statusFilter) return false;
      if (!term) return true;
      return (
        m.residentName.toLowerCase().includes(term) ||
        (m.phoneNumber ?? '').includes(term) ||
        m.flatId.toLowerCase().includes(term) ||
        m.tower.toLowerCase().includes(term)
      );
    });
  }, [members, statusFilter, search]);

  const executeDecision = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!db || !user || !decisionModal) return;
    setError(null);
    const { type, member } = decisionModal;
    if (type === 'reject' || type === 'info' || type === 'suspend') {
      const check = validateAdminReason(reason, type);
      if (!check.valid) {
        setError(check.error ?? 'Reason is required.');
        return;
      }
    }

    const flatDocId = normalizeFlatDocId(member.tower, member.flatNumber || member.flatId);
    const memberRef = doc(db, 'societies', member.societyId, 'members', member.uid);
    const userRef = doc(db, 'users', member.uid);
    const flatRef = doc(db, 'societies', member.societyId, 'flats', flatDocId);
    const historyId = `hist_${Date.now()}_${member.uid.slice(0, 6)}`;
    const historyRef = doc(db, 'societies', member.societyId, 'verificationHistory', historyId);
    const notifId = `notif_${type}_${member.uid}_${Date.now().toString(36)}`;
    const notifRef = doc(db, 'notifications', notifId);
    const flatSnap = await getDoc(flatRef);
    const batch = writeBatch(db);
    const text = reason.trim();

    if (type === 'approve') {
      batch.update(memberRef, {
        verificationStatus: 'approved',
        rejectionReason: '',
        suspensionReason: '',
        infoRequestNote: '',
        verifiedBy: user.uid,
        verifiedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      batch.update(userRef, {
        membershipStatus: 'approved',
        accountStatus: 'active',
        societyId: member.societyId,
        flatId: member.flatId,
        flatNumber: member.flatNumber || member.flatId,
        tower: member.tower,
        rejectionReason: '',
        suspensionReason: '',
        infoRequestNote: '',
        verifiedBy: user.uid,
        verifiedAt: serverTimestamp(),
        approvalAcknowledged: false,
        updatedAt: serverTimestamp(),
      });
      if (flatSnap.exists()) {
        batch.update(flatRef, { occupied: true, status: 'Occupied', primaryResidentUid: member.uid, updatedAt: serverTimestamp() });
      }
      batch.set(notifRef, {
        notificationId: notifId,
        uid: member.uid,
        societyId: member.societyId,
        type: 'verification_approved',
        title: 'Society Membership Approved',
        body: `Your flat ${member.tower} · ${member.flatId} is verified.`,
        read: false,
        dedupeKey: `approved_${member.uid}_${member.societyId}`,
        createdAt: serverTimestamp(),
      });
    } else if (type === 'reject') {
      batch.update(memberRef, { verificationStatus: 'rejected', rejectionReason: text, verifiedBy: user.uid, verifiedAt: serverTimestamp(), updatedAt: serverTimestamp() });
      batch.update(userRef, { membershipStatus: 'rejected', rejectionReason: text, verifiedBy: user.uid, verifiedAt: serverTimestamp(), updatedAt: serverTimestamp() });
      if (flatSnap.exists() && flatSnap.data().primaryResidentUid === member.uid) {
        batch.update(flatRef, { occupied: false, status: 'Available', primaryResidentUid: '', updatedAt: serverTimestamp() });
      }
      batch.set(notifRef, { notificationId: notifId, uid: member.uid, societyId: member.societyId, type: 'verification_rejected', title: 'Verification Rejected', body: text, read: false, createdAt: serverTimestamp() });
    } else if (type === 'info') {
      batch.update(memberRef, { infoRequestNote: text, updatedAt: serverTimestamp() });
      batch.update(userRef, { infoRequestNote: text, updatedAt: serverTimestamp() });
      batch.set(notifRef, { notificationId: notifId, uid: member.uid, societyId: member.societyId, type: 'info_requested', title: 'More Details Needed', body: text, read: false, createdAt: serverTimestamp() });
    } else if (type === 'suspend') {
      batch.update(memberRef, { verificationStatus: 'suspended', suspensionReason: text, updatedAt: serverTimestamp() });
      batch.update(userRef, { membershipStatus: 'suspended', accountStatus: 'suspended', suspensionReason: text, updatedAt: serverTimestamp() });
      if (flatSnap.exists()) batch.update(flatRef, { occupied: false, status: 'Suspended', updatedAt: serverTimestamp() });
      batch.set(notifRef, { notificationId: notifId, uid: member.uid, societyId: member.societyId, type: 'account_suspended', title: 'Account Suspended', body: text, read: false, createdAt: serverTimestamp() });
    } else if (type === 'reactivate') {
      batch.update(memberRef, { verificationStatus: 'approved', suspensionReason: '', verifiedBy: user.uid, verifiedAt: serverTimestamp(), updatedAt: serverTimestamp() });
      batch.update(userRef, { membershipStatus: 'approved', accountStatus: 'active', suspensionReason: '', approvalAcknowledged: true, updatedAt: serverTimestamp() });
      if (flatSnap.exists()) batch.update(flatRef, { occupied: true, status: 'Occupied', primaryResidentUid: member.uid, updatedAt: serverTimestamp() });
      batch.set(notifRef, { notificationId: notifId, uid: member.uid, societyId: member.societyId, type: 'account_reactivated', title: 'Account Reactivated', body: 'Your society marketplace access is restored.', read: false, createdAt: serverTimestamp() });
    }

    batch.set(historyRef, {
      historyId,
      uid: member.uid,
      societyId: member.societyId,
      flatId: member.flatId,
      tower: member.tower,
      action: type === 'info' ? 'info_requested' : type === 'approve' ? 'approved' : type === 'reject' ? 'rejected' : type === 'suspend' ? 'suspended' : 'reactivated',
      previousStatus: member.verificationStatus,
      newStatus: type === 'info' ? member.verificationStatus : type === 'approve' || type === 'reactivate' ? 'approved' : type === 'reject' ? 'rejected' : 'suspended',
      actorUid: user.uid,
      actorEmail: user.email ?? '',
      note: text || type,
      createdAt: serverTimestamp(),
    });

    const auditRef = doc(collection(db, 'auditLogs'));
    batch.set(auditRef, {
      logId: auditRef.id,
      actorUid: user.uid,
      actorEmail: user.email ?? '',
      actorRole: role?.roleId ?? 'super_admin',
      action: `${type.toUpperCase()}_MEMBERSHIP`,
      targetCollection: `societies/${member.societyId}/members`,
      targetId: member.uid,
      targetUid: member.uid,
      societyId: member.societyId,
      details: text || `${type} ${member.residentName}`,
      createdAt: serverTimestamp(),
    });

    await batch.commit();
    setDecisionModal(null);
    setReason('');
  };

  return (
    <AdminShell>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Resident Verification &amp; Customers</h1>
          <p className="text-sm text-slate-600 mt-1">
            Approve, reject, request details, suspend, or reactivate society residents.
          </p>
        </div>
        <div className="flex gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search resident, phone, flat..."
            className="px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg"
          />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
            className="px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg"
          >
            <option value="all">All Statuses</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="suspended">Suspended</option>
          </select>
        </div>
      </div>

      <div className="mt-6 bg-white border border-slate-200 rounded-xl overflow-x-auto">
        {filtered.length === 0 ? (
          <div className="p-8 text-sm text-slate-500">No verification records match filters.</div>
        ) : (
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
              <tr>
                <th className="px-4 py-3">Resident</th>
                <th className="px-4 py-3">Contact</th>
                <th className="px-4 py-3">Society</th>
                <th className="px-4 py-3">Tower &amp; Flat</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((m) => (
                <tr key={`${m.societyId}_${m.uid}`}>
                  <td className="px-4 py-3 font-semibold text-slate-900">{m.residentName}</td>
                  <td className="px-4 py-3 font-mono text-slate-600">{m.phoneNumber || m.email || m.uid}</td>
                  <td className="px-4 py-3 text-slate-700">{societyMap[m.societyId] ?? m.societyId}</td>
                  <td className="px-4 py-3 text-slate-700">{m.tower} · {m.flatNumber || m.flatId}</td>
                  <td className="px-4 py-3 text-slate-600">{m.residentType ?? 'Owner'}</td>
                  <td className="px-4 py-3 font-medium text-slate-800">{m.verificationStatus}</td>
                  <td className="px-4 py-3 text-right space-x-2 whitespace-nowrap">
                    <button onClick={() => setInspectMember(m)} className="text-slate-700 hover:underline">History</button>
                    {m.verificationStatus === 'pending' ? (
                      <>
                        <button onClick={() => { setReason(''); setDecisionModal({ type: 'approve', member: m }); }} className="text-[#0F3D2E] font-semibold">Approve</button>
                        <button onClick={() => { setReason(''); setDecisionModal({ type: 'info', member: m }); }} className="text-amber-700 font-semibold">Info</button>
                        <button onClick={() => { setReason(''); setDecisionModal({ type: 'reject', member: m }); }} className="text-red-700 font-semibold">Reject</button>
                      </>
                    ) : null}
                    {m.verificationStatus === 'approved' ? (
                      <button onClick={() => { setReason(''); setDecisionModal({ type: 'suspend', member: m }); }} className="text-red-700 font-semibold">Suspend</button>
                    ) : null}
                    {m.verificationStatus === 'suspended' ? (
                      <button onClick={() => { setReason(''); setDecisionModal({ type: 'reactivate', member: m }); }} className="text-[#0F3D2E] font-semibold">Reactivate</button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {decisionModal ? (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <form onSubmit={executeDecision} className="max-w-md w-full bg-white rounded-xl p-6 space-y-4">
            <h2 className="text-base font-bold text-slate-900">
              Confirm {decisionModal.type.toUpperCase()} — {decisionModal.member.residentName}
            </h2>
            <textarea
              rows={3}
              required={decisionModal.type === 'reject' || decisionModal.type === 'info' || decisionModal.type === 'suspend'}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Enter reason or audit note..."
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
            />
            {error ? <div className="text-xs text-red-600">{error}</div> : null}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setDecisionModal(null)} className="px-4 py-2 text-xs border border-slate-300 rounded-lg">Cancel</button>
              <button type="submit" className="px-4 py-2 text-xs bg-[#0F3D2E] text-white font-semibold rounded-lg">Confirm</button>
            </div>
          </form>
        </div>
      ) : null}

      {inspectMember ? (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="max-w-lg w-full bg-white rounded-xl p-6 space-y-3">
            <div className="flex justify-between items-center">
              <h2 className="text-base font-bold">{inspectMember.residentName} — History</h2>
              <button onClick={() => setInspectMember(null)} className="text-xs underline">Close</button>
            </div>
            <div className="space-y-2 max-h-72 overflow-y-auto text-xs">
              {history.length === 0 ? (
                <div className="text-slate-500">No history entries yet.</div>
              ) : (
                history.map((h) => (
                  <div key={h.historyId} className="p-3 border border-slate-200 rounded-lg">
                    <div className="font-semibold">{h.action} → {h.newStatus}</div>
                    <div className="text-slate-600 mt-0.5">{h.note}</div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      ) : null}
    </AdminShell>
  );
}
