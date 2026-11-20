'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import type {
  InvitationCodeRecord,
  Society,
  SocietyFlat,
} from '@society-marketplace/shared-types';
import { normalizeFlatDocId, sha256HexBrowser } from '@society-marketplace/business-logic';
import {
  validateFlatInput,
  validateInvitationCreateInput,
  validateSocietyCreateInput,
} from '@society-marketplace/validation';
import { AdminShell } from '../../components/AdminShell';
import { useAdminAuth } from '../../hooks/useAdminAuth';
import { db } from '../../lib/firebase';

export default function AdminSocietiesPage() {
  const { user, role } = useAdminAuth();
  const [tab, setTab] = useState<'societies' | 'flats' | 'invitations'>('societies');
  const [societies, setSocieties] = useState<Society[]>([]);
  const [selectedSocietyId, setSelectedSocietyId] = useState('');
  const [flats, setFlats] = useState<SocietyFlat[]>([]);
  const [codes, setCodes] = useState<InvitationCodeRecord[]>([]);
  const [search, setSearch] = useState('');
  const [revealedCode, setRevealedCode] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const [newSoc, setNewSoc] = useState({
    societyName: '',
    address: '',
    city: '',
    state: '',
    pincode: '',
    invitationCode: '',
  });
  const [newFlat, setNewFlat] = useState({ tower: '', flatNumber: '' });
  const [newInvite, setNewInvite] = useState({ maxUses: '100', expiresAt: '', customCode: '' });

  useEffect(() => {
    if (!db) return;
    const u1 = onSnapshot(query(collection(db, 'societies'), orderBy('createdAt', 'desc')), (snap) => {
      const list = snap.docs.map((d) => d.data() as Society);
      setSocieties(list);
      if (!selectedSocietyId && list.length > 0) setSelectedSocietyId(list[0].societyId);
    });
    const u2 = onSnapshot(query(collection(db, 'invitationCodes'), orderBy('createdAt', 'desc')), (snap) => {
      setCodes(snap.docs.map((d) => d.data() as InvitationCodeRecord));
    });
    return () => {
      u1();
      u2();
    };
  }, [selectedSocietyId]);

  useEffect(() => {
    if (!db || !selectedSocietyId) return;
    return onSnapshot(collection(db, 'societies', selectedSocietyId, 'flats'), (snap) => {
      setFlats(snap.docs.map((d) => d.data() as SocietyFlat));
    });
  }, [selectedSocietyId]);

  const filteredSocieties = useMemo(
    () =>
      societies.filter(
        (s) =>
          s.societyName.toLowerCase().includes(search.toLowerCase()) ||
          s.city.toLowerCase().includes(search.toLowerCase())
      ),
    [societies, search]
  );

  const handleCreateSociety = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!db || !user) return;
    const check = validateSocietyCreateInput(newSoc);
    if (!check.valid) {
      setFeedback(check.error ?? 'Invalid society input.');
      return;
    }
    const code = newSoc.invitationCode.trim().toUpperCase();
    const societyId = `soc_${code.toLowerCase()}_${Date.now().toString(36)}`;
    const codeHash = await sha256HexBrowser(code);
    const codeId = `inv_${societyId}`;
    const batch = writeBatch(db);

    batch.set(doc(db, 'societies', societyId), {
      societyId,
      societyName: newSoc.societyName.trim(),
      address: newSoc.address.trim(),
      city: newSoc.city.trim(),
      state: newSoc.state.trim(),
      pincode: newSoc.pincode.trim(),
      invitationCode: code,
      status: 'active',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(db, 'invitationCodes', codeId), {
      codeId,
      societyId,
      societyName: newSoc.societyName.trim(),
      city: newSoc.city.trim(),
      codeHash,
      codePreview: `${code.slice(0, 4)}••••`,
      status: 'active',
      maxUses: 500,
      usedCount: 0,
      createdBy: user.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(db, 'invitationLookups', codeHash), {
      codeId,
      societyId,
      societyName: newSoc.societyName.trim(),
      city: newSoc.city.trim(),
      status: 'active',
      maxUses: 500,
      usedCount: 0,
    });
    await batch.commit();
    setRevealedCode(code);
    setNewSoc({ societyName: '', address: '', city: '', state: '', pincode: '', invitationCode: '' });
    setFeedback(`Created ${newSoc.societyName.trim()} with SHA-256 invitation.`);
  };

  const handleCreateFlat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!db || !selectedSocietyId) return;
    const check = validateFlatInput(newFlat);
    if (!check.valid) {
      setFeedback(check.error ?? 'Invalid flat details.');
      return;
    }
    const flatId = normalizeFlatDocId(newFlat.tower, newFlat.flatNumber);
    await setDoc(doc(db, 'societies', selectedSocietyId, 'flats', flatId), {
      flatId,
      societyId: selectedSocietyId,
      tower: newFlat.tower.trim(),
      flatNumber: newFlat.flatNumber.trim(),
      occupied: false,
      status: 'Available',
      primaryResidentUid: '',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    setNewFlat({ tower: '', flatNumber: '' });
    setFeedback(`Registered flat ${newFlat.tower.trim()} · ${newFlat.flatNumber.trim()}.`);
  };

  const handleCreateInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!db || !user || !selectedSocietyId) return;
    const soc = societies.find((s) => s.societyId === selectedSocietyId);
    if (!soc) return;
    const maxUses = Number(newInvite.maxUses);
    const expiresIso = newInvite.expiresAt ? new Date(`${newInvite.expiresAt}T23:59:59Z`).toISOString() : undefined;
    const customCode = newInvite.customCode.trim().toUpperCase() || undefined;
    const check = validateInvitationCreateInput({
      societyId: selectedSocietyId,
      maxUses,
      expiresAt: expiresIso,
      customCode,
    });
    if (!check.valid) {
      setFeedback(check.error ?? 'Invalid invitation code input.');
      return;
    }
    const rawCode = customCode || `GG-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const codeHash = await sha256HexBrowser(rawCode);
    const codeId = `inv_${Date.now().toString(36)}`;
    const batch = writeBatch(db);
    batch.set(doc(db, 'invitationCodes', codeId), {
      codeId,
      societyId: soc.societyId,
      societyName: soc.societyName,
      city: soc.city,
      codeHash,
      codePreview: `${rawCode.slice(0, 4)}••••`,
      status: 'active',
      ...(expiresIso ? { expiresAt: expiresIso } : {}),
      maxUses,
      usedCount: 0,
      createdBy: user.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(db, 'invitationLookups', codeHash), {
      codeId,
      societyId: soc.societyId,
      societyName: soc.societyName,
      city: soc.city,
      status: 'active',
      ...(expiresIso ? { expiresAt: expiresIso } : {}),
      maxUses,
      usedCount: 0,
    });
    await batch.commit();
    await setDoc(doc(collection(db, 'auditLogs')), {
      logId: `aud_${Date.now()}`,
      actorUid: user.uid,
      actorEmail: user.email ?? '',
      actorRole: role?.roleId ?? 'super_admin',
      action: 'CREATE_INVITATION_CODE',
      targetCollection: 'invitationCodes',
      targetId: codeId,
      societyId: soc.societyId,
      details: `Generated SHA-256 invitation for ${soc.societyName}`,
      createdAt: serverTimestamp(),
    });
    setRevealedCode(rawCode);
    setNewInvite({ maxUses: '100', expiresAt: '', customCode: '' });
  };

  const handleToggleCode = async (rec: InvitationCodeRecord, status: 'active' | 'inactive' | 'revoked') => {
    if (!db) return;
    const batch = writeBatch(db);
    batch.update(doc(db, 'invitationCodes', rec.codeId), { status, updatedAt: serverTimestamp() });
    batch.update(doc(db, 'invitationLookups', rec.codeHash), { status });
    await batch.commit();
  };

  return (
    <AdminShell>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Society Management</h1>
          <p className="text-sm text-slate-600">
            Societies, tower &amp; flat registries, and SHA-256 hashed invitation codes.
          </p>
        </div>
        <div className="flex gap-2">
          {(['societies', 'flats', 'invitations'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3.5 py-2 rounded-lg text-xs font-semibold ${
                tab === t
                  ? 'bg-[#0F3D2E] text-white'
                  : 'bg-white border border-slate-200 text-slate-700'
              }`}
            >
              {t === 'societies' ? 'All Societies' : t === 'flats' ? 'Towers & Flats' : 'Invitation Codes'}
            </button>
          ))}
        </div>
      </div>

      {revealedCode ? (
        <div className="mt-4 p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-950 flex justify-between items-center">
          <span>
            One-time Invitation Code: <span className="font-mono font-bold text-sm">{revealedCode}</span>
          </span>
          <button onClick={() => setRevealedCode(null)} className="font-semibold underline">
            Dismiss
          </button>
        </div>
      ) : null}

      {feedback ? (
        <div className="mt-3 text-xs text-[#0F3D2E] font-medium">{feedback}</div>
      ) : null}

      {tab === 'societies' ? (
        <div className="mt-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
          <form onSubmit={handleCreateSociety} className="lg:col-span-4 bg-white border border-slate-200 rounded-xl p-5 space-y-3 h-fit">
            <h2 className="text-sm font-bold text-slate-900">Register New Society</h2>
            <input required value={newSoc.societyName} onChange={(e) => setNewSoc({ ...newSoc, societyName: e.target.value })} placeholder="Society Name" className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" />
            <input required value={newSoc.address} onChange={(e) => setNewSoc({ ...newSoc, address: e.target.value })} placeholder="Address" className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" />
            <div className="grid grid-cols-3 gap-2">
              <input required value={newSoc.city} onChange={(e) => setNewSoc({ ...newSoc, city: e.target.value })} placeholder="City" className="px-2.5 py-2 text-sm border border-slate-200 rounded-lg" />
              <input required value={newSoc.state} onChange={(e) => setNewSoc({ ...newSoc, state: e.target.value })} placeholder="State" className="px-2.5 py-2 text-sm border border-slate-200 rounded-lg" />
              <input required maxLength={6} value={newSoc.pincode} onChange={(e) => setNewSoc({ ...newSoc, pincode: e.target.value })} placeholder="Pincode" className="px-2.5 py-2 text-sm font-mono border border-slate-200 rounded-lg" />
            </div>
            <input required value={newSoc.invitationCode} onChange={(e) => setNewSoc({ ...newSoc, invitationCode: e.target.value.toUpperCase() })} placeholder="Invitation Code" className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-lg" />
            <button type="submit" className="w-full py-2.5 rounded-lg bg-[#0F3D2E] text-white text-xs font-semibold">
              Create Society
            </button>
          </form>

          <div className="lg:col-span-8 space-y-3">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search society or city..."
              className="px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg w-full max-w-sm"
            />
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              {filteredSocieties.length === 0 ? (
                <div className="p-8 text-sm text-slate-500">No societies found in Cloud Firestore.</div>
              ) : (
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-xs text-slate-500 border-b border-slate-200">
                    <tr>
                      <th className="px-5 py-3">Society</th>
                      <th className="px-5 py-3">Location</th>
                      <th className="px-5 py-3">Status</th>
                      <th className="px-5 py-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredSocieties.map((s) => (
                      <tr key={s.societyId}>
                        <td className="px-5 py-3 font-medium text-slate-900">{s.societyName}</td>
                        <td className="px-5 py-3 text-slate-600">{s.city}, {s.state} · {s.pincode}</td>
                        <td className="px-5 py-3 text-slate-700">{s.status}</td>
                        <td className="px-5 py-3 text-right">
                          <button
                            onClick={() => updateDoc(doc(db!, 'societies', s.societyId), { status: s.status === 'active' ? 'inactive' : 'active', updatedAt: serverTimestamp() })}
                            className="text-xs font-semibold text-[#0F3D2E] hover:underline"
                          >
                            {s.status === 'active' ? 'Deactivate' : 'Activate'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {tab === 'flats' ? (
        <div className="mt-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
          <form onSubmit={handleCreateFlat} className="lg:col-span-4 bg-white border border-slate-200 rounded-xl p-5 space-y-3 h-fit">
            <h2 className="text-sm font-bold text-slate-900">Add Flat</h2>
            <select value={selectedSocietyId} onChange={(e) => setSelectedSocietyId(e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white">
              {societies.map((s) => (
                <option key={s.societyId} value={s.societyId}>{s.societyName}</option>
              ))}
            </select>
            <input required value={newFlat.tower} onChange={(e) => setNewFlat({ ...newFlat, tower: e.target.value })} placeholder="Tower (e.g. Tower A)" className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" />
            <input required value={newFlat.flatNumber} onChange={(e) => setNewFlat({ ...newFlat, flatNumber: e.target.value })} placeholder="Flat Number (e.g. A-401)" className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" />
            <button type="submit" className="w-full py-2.5 rounded-lg bg-[#0F3D2E] text-white text-xs font-semibold">Add Flat</button>
          </form>
          <div className="lg:col-span-8 bg-white border border-slate-200 rounded-xl overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3">Tower</th>
                  <th className="px-4 py-3">Flat</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Resident UID</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {flats.map((f) => (
                  <tr key={f.flatId}>
                    <td className="px-4 py-3 font-medium">{f.tower}</td>
                    <td className="px-4 py-3 font-mono">{f.flatNumber}</td>
                    <td className="px-4 py-3">{f.status}</td>
                    <td className="px-4 py-3 font-mono text-slate-500">{f.primaryResidentUid || 'Available'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {tab === 'invitations' ? (
        <div className="mt-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
          <form onSubmit={handleCreateInvite} className="lg:col-span-4 bg-white border border-slate-200 rounded-xl p-5 space-y-3 h-fit">
            <h2 className="text-sm font-bold text-slate-900">Generate Hashed Code</h2>
            <select value={selectedSocietyId} onChange={(e) => setSelectedSocietyId(e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white">
              {societies.map((s) => (
                <option key={s.societyId} value={s.societyId}>{s.societyName}</option>
              ))}
            </select>
            <input type="number" min={1} max={10000} value={newInvite.maxUses} onChange={(e) => setNewInvite({ ...newInvite, maxUses: e.target.value })} placeholder="Max Uses" className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" />
            <input type="date" value={newInvite.expiresAt} onChange={(e) => setNewInvite({ ...newInvite, expiresAt: e.target.value })} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" />
            <input value={newInvite.customCode} onChange={(e) => setNewInvite({ ...newInvite, customCode: e.target.value.toUpperCase() })} placeholder="Custom Code (optional)" className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-lg" />
            <button type="submit" className="w-full py-2.5 rounded-lg bg-[#0F3D2E] text-white text-xs font-semibold">Generate Code</button>
          </form>
          <div className="lg:col-span-8 bg-white border border-slate-200 rounded-xl overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3">Preview</th>
                  <th className="px-4 py-3">Society</th>
                  <th className="px-4 py-3">Usage</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {codes.map((c) => (
                  <tr key={c.codeId}>
                    <td className="px-4 py-3 font-mono">{c.codePreview ?? c.codeHash.slice(0, 8)}</td>
                    <td className="px-4 py-3">{c.societyName}</td>
                    <td className="px-4 py-3 font-mono">{c.usedCount} / {c.maxUses}</td>
                    <td className="px-4 py-3">{c.status}</td>
                    <td className="px-4 py-3 text-right space-x-2">
                      {c.status !== 'revoked' ? (
                        <button onClick={() => handleToggleCode(c, 'revoked')} className="text-red-700 font-semibold">
                          Revoke
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </AdminShell>
  );
}
