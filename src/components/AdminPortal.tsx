import React, { useEffect, useMemo, useState } from 'react';
import {
  Ban,
  Check,
  Copy,
  Eye,
  KeyRound,
  Menu,
  MessageSquareMore,
  Plus,
  RotateCcw,
  Search,
  ShieldCheck,
  X,
} from 'lucide-react';
import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import type {
  AuditLog,
  BulkOfferCampaign,
  GroupBuyCampaign,
  InvitationCodeRecord,
  MembershipVerificationHistory,
  Order,
  Product,
  RoleDefinition,
  ServiceCatalogItem,
  Society,
  SocietyFlat,
  SocietyMembership,
  StaffMember,
  UserProfile,
} from '@society-marketplace/shared-types';
import {
  ADMIN_SIDEBAR_MODULES,
  PERMISSION_KEYS,
  SERVICE_CATEGORIES,
  SOCIETY_MANAGEMENT_SUBMODULES,
} from '@society-marketplace/constants';
import {
  formatINRFromPaise,
  hasGranularPermission,
  normalizeFlatDocId,
  sha256HexBrowser,
} from '@society-marketplace/business-logic';
import {
  validateAdminReason,
  validateFlatInput,
  validateInvitationCreateInput,
  validateSocietyCreateInput,
} from '@society-marketplace/validation';
import { useAppAuth } from '../contexts/AppAuthContext';
import {
  OperationType,
  configuredDatabaseId,
  configuredProjectId,
  db,
  handleFirestoreError,
} from '../lib/firebase';

type ModuleId = (typeof ADMIN_SIDEBAR_MODULES)[number]['id'];
type SocietySubmoduleId = (typeof SOCIETY_MANAGEMENT_SUBMODULES)[number]['id'];

function formatTimestamp(ts: unknown): string {
  if (!ts) return '—';
  if (typeof ts === 'string') {
    const parsed = new Date(ts);
    return Number.isNaN(parsed.getTime())
      ? ts
      : parsed.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  }
  if (typeof ts === 'object' && ts !== null && 'toDate' in ts && typeof (ts as { toDate: () => Date }).toDate === 'function') {
    return (ts as { toDate: () => Date }).toDate().toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  }
  return '—';
}

function toTimestampMs(ts: unknown): number {
  if (!ts) return 0;
  if (typeof ts === 'string') {
    const t = Date.parse(ts);
    return Number.isNaN(t) ? 0 : t;
  }
  if (typeof ts === 'object' && ts !== null && 'toMillis' in ts && typeof (ts as { toMillis: () => number }).toMillis === 'function') {
    return (ts as { toMillis: () => number }).toMillis();
  }
  return 0;
}

export function AdminPortal() {
  const {
    firebaseUser,
    staffProfile,
    staffRole,
    adminPermissions,
    isAdminAuthorized,
    loading,
    connectionStatus,
    connectionError,
    signInWithGoogle,
    logout,
  } = useAppAuth();

  const [activeModule, setActiveModule] = useState<ModuleId>('overview');
  const [societySubmodule, setSocietySubmodule] = useState<SocietySubmoduleId>('all_societies');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // Live Firestore collections
  const [societies, setSocieties] = useState<Society[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [allMembers, setAllMembers] = useState<SocietyMembership[]>([]);
  const [invitationCodes, setInvitationCodes] = useState<InvitationCodeRecord[]>([]);
  const [flats, setFlats] = useState<SocietyFlat[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [services, setServices] = useState<ServiceCatalogItem[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [staffList, setStaffList] = useState<StaffMember[]>([]);
  const [roles, setRoles] = useState<RoleDefinition[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [selectedSocietyId, setSelectedSocietyId] = useState<string>('');
  const [bulkCampaigns, setBulkCampaigns] = useState<BulkOfferCampaign[]>([]);
  const [groupCampaigns, setGroupCampaigns] = useState<GroupBuyCampaign[]>([]);

  // Society Filters
  const [societySearch, setSocietySearch] = useState('');
  const [societyCityFilter, setSocietyCityFilter] = useState('all');
  const [societyStatusFilter, setSocietyStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');

  // Flat Filters & Form
  const [flatTowerFilter, setFlatTowerFilter] = useState('all');
  const [flatStatusFilter, setFlatStatusFilter] = useState('all');
  const [newFlat, setNewFlat] = useState({ tower: '', flatNumber: '' });
  const [flatError, setFlatError] = useState<string | null>(null);

  // Invitation Form & One-time Plaintext Reveal
  const [inviteForm, setInviteForm] = useState({
    societyId: '',
    maxUses: '100',
    expiresAt: '',
    customCode: '',
  });
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [createdPlaintextCode, setCreatedPlaintextCode] = useState<{
    code: string;
    societyName: string;
  } | null>(null);

  // Resident & Verification Filters
  const [customerSearch, setCustomerSearch] = useState('');
  const [residentSocietyFilter, setResidentSocietyFilter] = useState('all');
  const [residentTowerFilter, setResidentTowerFilter] = useState('');
  const [residentStatusFilter, setResidentStatusFilter] = useState<'all' | 'pending' | 'approved' | 'rejected' | 'suspended'>('all');
  const [residentDateFrom, setResidentDateFrom] = useState('');
  const [residentDateTo, setResidentDateTo] = useState('');
  const [residentPage, setResidentPage] = useState(1);
  const PAGE_SIZE = 10;

  // Admin Action Modals
  const [showNewSocietyModal, setShowNewSocietyModal] = useState(false);
  const [showDemoSeedConfirm, setShowDemoSeedConfirm] = useState(false);
  const [seedingDemo, setSeedingDemo] = useState(false);

  const [inspectMember, setInspectMember] = useState<SocietyMembership | null>(null);
  const [inspectHistory, setInspectHistory] = useState<MembershipVerificationHistory[]>([]);

  const [actionDialog, setActionDialog] = useState<{
    type: 'approve' | 'reject' | 'info' | 'suspend' | 'reactivate';
    member: SocietyMembership;
  } | null>(null);
  const [actionReason, setActionReason] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  // Create Society form
  const [newSoc, setNewSoc] = useState({
    societyName: '',
    address: '',
    city: '',
    state: '',
    pincode: '',
    invitationCode: '',
  });
  const [newSocError, setNewSocError] = useState<string | null>(null);

  // Create Campaign forms
  const [newBulk, setNewBulk] = useState({
    title: '',
    description: '',
    category: SERVICE_CATEGORIES[0] as string,
    regularPriceRupees: '999',
    offerPriceRupees: '599',
    minimumTarget: '15',
    maximumCapacity: '60',
    bookingDeadline: '2026-12-10',
    scheduledDate: '2026-12-15',
  });
  const [newGroup, setNewGroup] = useState({
    title: '',
    description: '',
    unitLabel: '5 kg box',
    marketPriceRupees: '1200',
    groupPriceRupees: '850',
    minimumGroupQuantity: '20',
    deadline: '2026-12-12',
    expectedDeliveryDate: '2026-12-16',
  });

  // Create Product / Service / Role forms
  const [newProduct, setNewProduct] = useState({
    title: '',
    description: '',
    category: 'Fresh Produce',
    mrpRupees: '250',
    priceRupees: '199',
    unitLabel: '1 kg pack',
    stockQuantity: '50',
  });
  const [newService, setNewService] = useState({
    title: '',
    category: SERVICE_CATEGORIES[0] as string,
    description: '',
    instructions: '',
    startingPriceRupees: '399',
  });
  const [newRole, setNewRole] = useState({
    roleId: '',
    name: '',
    description: '',
    permissions: ['society.view', 'customer.view', 'customer.verify', 'customer.reject'] as string[],
  });

  const notify = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 5000);
  };

  useEffect(() => {
    if (!isAdminAuthorized || !db) return;

    const unsubSoc = onSnapshot(
      query(collection(db, 'societies'), orderBy('createdAt', 'desc')),
      (snap) => {
        const list = snap.docs.map((d) => d.data() as Society);
        setSocieties(list);
        if (!selectedSocietyId && list.length > 0) {
          setSelectedSocietyId(list[0].societyId);
          setInviteForm((prev) => ({ ...prev, societyId: prev.societyId || list[0].societyId }));
        }
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'societies')
    );

    const unsubUsers = onSnapshot(
      query(collection(db, 'users'), orderBy('createdAt', 'desc')),
      (snap) => setUsers(snap.docs.map((d) => d.data() as UserProfile)),
      (err) => handleFirestoreError(err, OperationType.LIST, 'users')
    );

    const unsubMembers = onSnapshot(
      collectionGroup(db, 'members'),
      (snap) => setAllMembers(snap.docs.map((d) => d.data() as SocietyMembership)),
      (err) => handleFirestoreError(err, OperationType.LIST, 'members')
    );

    const unsubCodes = onSnapshot(
      query(collection(db, 'invitationCodes'), orderBy('createdAt', 'desc')),
      (snap) => setInvitationCodes(snap.docs.map((d) => d.data() as InvitationCodeRecord)),
      (err) => handleFirestoreError(err, OperationType.LIST, 'invitationCodes')
    );

    const unsubProducts = onSnapshot(
      collection(db, 'products'),
      (snap) => setProducts(snap.docs.map((d) => d.data() as Product)),
      (err) => handleFirestoreError(err, OperationType.LIST, 'products')
    );

    const unsubServices = onSnapshot(
      collection(db, 'services'),
      (snap) => setServices(snap.docs.map((d) => d.data() as ServiceCatalogItem)),
      (err) => handleFirestoreError(err, OperationType.LIST, 'services')
    );

    const unsubOrders = onSnapshot(
      query(collectionGroup(db, 'orders'), limit(50)),
      (snap) => setOrders(snap.docs.map((d) => d.data() as Order)),
      (err) => handleFirestoreError(err, OperationType.LIST, 'orders')
    );

    const unsubStaff = onSnapshot(
      collection(db, 'staff'),
      (snap) => setStaffList(snap.docs.map((d) => d.data() as StaffMember)),
      (err) => handleFirestoreError(err, OperationType.LIST, 'staff')
    );

    const unsubRoles = onSnapshot(
      collection(db, 'roles'),
      (snap) => setRoles(snap.docs.map((d) => d.data() as RoleDefinition)),
      (err) => handleFirestoreError(err, OperationType.LIST, 'roles')
    );

    const unsubAudit = onSnapshot(
      query(collection(db, 'auditLogs'), orderBy('createdAt', 'desc'), limit(60)),
      (snap) => setAuditLogs(snap.docs.map((d) => d.data() as AuditLog)),
      (err) => handleFirestoreError(err, OperationType.LIST, 'auditLogs')
    );

    return () => {
      unsubSoc();
      unsubUsers();
      unsubMembers();
      unsubCodes();
      unsubProducts();
      unsubServices();
      unsubOrders();
      unsubStaff();
      unsubRoles();
      unsubAudit();
    };
  }, [isAdminAuthorized, selectedSocietyId]);

  useEffect(() => {
    if (!isAdminAuthorized || !selectedSocietyId || !db) return;
    const unsubBulk = onSnapshot(
      collection(db, 'societies', selectedSocietyId, 'campaigns'),
      (snap) => setBulkCampaigns(snap.docs.map((d) => d.data() as BulkOfferCampaign)),
      (err) =>
        handleFirestoreError(err, OperationType.LIST, `societies/${selectedSocietyId}/campaigns`)
    );
    const unsubGroup = onSnapshot(
      collection(db, 'societies', selectedSocietyId, 'groupCampaigns'),
      (snap) => setGroupCampaigns(snap.docs.map((d) => d.data() as GroupBuyCampaign)),
      (err) =>
        handleFirestoreError(
          err,
          OperationType.LIST,
          `societies/${selectedSocietyId}/groupCampaigns`
        )
    );
    const unsubFlats = onSnapshot(
      collection(db, 'societies', selectedSocietyId, 'flats'),
      (snap) => setFlats(snap.docs.map((d) => d.data() as SocietyFlat)),
      (err) => handleFirestoreError(err, OperationType.LIST, `societies/${selectedSocietyId}/flats`)
    );
    return () => {
      unsubBulk();
      unsubGroup();
      unsubFlats();
    };
  }, [isAdminAuthorized, selectedSocietyId]);

  useEffect(() => {
    if (!inspectMember || !db) {
      setInspectHistory([]);
      return;
    }
    const q = query(
      collection(db, 'societies', inspectMember.societyId, 'verificationHistory'),
      where('uid', '==', inspectMember.uid),
      orderBy('createdAt', 'desc'),
      limit(25)
    );
    return onSnapshot(
      q,
      (snap) => setInspectHistory(snap.docs.map((d) => d.data() as MembershipVerificationHistory)),
      () => setInspectHistory([])
    );
  }, [inspectMember]);

  // All derived memos placed BEFORE any early return (fixes React hooks rule)
  const assignedIds = staffProfile?.assignedSocietyIds;
  const scopedSocieties = useMemo(() => {
    if (!assignedIds || assignedIds.length === 0) return societies;
    return societies.filter((s) => assignedIds.includes(s.societyId));
  }, [societies, assignedIds]);

  const societyNameMap = useMemo(() => {
    const map: Record<string, Society> = {};
    for (const s of societies) map[s.societyId] = s;
    return map;
  }, [societies]);

  const userMap = useMemo(() => {
    const map: Record<string, UserProfile> = {};
    for (const u of users) map[u.uid] = u;
    return map;
  }, [users]);

  const scopedMembers = useMemo(() => {
    const base =
      !assignedIds || assignedIds.length === 0
        ? allMembers
        : allMembers.filter((m) => assignedIds.includes(m.societyId));
    return [...base].sort((a, b) => toTimestampMs(b.createdAt) - toTimestampMs(a.createdAt));
  }, [allMembers, assignedIds]);

  const pendingMembers = useMemo(
    () => scopedMembers.filter((m) => m.verificationStatus === 'pending'),
    [scopedMembers]
  );
  const approvedMembers = useMemo(
    () => scopedMembers.filter((m) => m.verificationStatus === 'approved'),
    [scopedMembers]
  );
  const rejectedMembers = useMemo(
    () => scopedMembers.filter((m) => m.verificationStatus === 'rejected'),
    [scopedMembers]
  );
  const suspendedMembers = useMemo(
    () => scopedMembers.filter((m) => m.verificationStatus === 'suspended'),
    [scopedMembers]
  );

  const registeredCustomersCount = useMemo(
    () => users.filter((u) => !u.accountType || u.accountType === 'customer').length,
    [users]
  );

  const cities = useMemo(
    () => Array.from(new Set(scopedSocieties.map((s) => s.city).filter(Boolean))).sort(),
    [scopedSocieties]
  );

  const filteredSocieties = useMemo(() => {
    return scopedSocieties.filter((s) => {
      const matchesSearch =
        s.societyName.toLowerCase().includes(societySearch.toLowerCase()) ||
        s.city.toLowerCase().includes(societySearch.toLowerCase()) ||
        s.invitationCode.toLowerCase().includes(societySearch.toLowerCase());
      const matchesCity = societyCityFilter === 'all' || s.city === societyCityFilter;
      const matchesStatus = societyStatusFilter === 'all' || s.status === societyStatusFilter;
      return matchesSearch && matchesCity && matchesStatus;
    });
  }, [scopedSocieties, societySearch, societyCityFilter, societyStatusFilter]);

  const flatTowers = useMemo(
    () => Array.from(new Set(flats.map((f) => f.tower))).sort(),
    [flats]
  );

  const filteredFlats = useMemo(() => {
    return flats
      .filter((f) => {
        const matchesTower = flatTowerFilter === 'all' || f.tower === flatTowerFilter;
        const matchesStatus = flatStatusFilter === 'all' || f.status === flatStatusFilter;
        return matchesTower && matchesStatus;
      })
      .sort((a, b) => `${a.tower}_${a.flatNumber}`.localeCompare(`${b.tower}_${b.flatNumber}`));
  }, [flats, flatTowerFilter, flatStatusFilter]);

  const filteredMembersQueue = useMemo(() => {
    let source = scopedMembers;
    if (activeModule === 'societies') {
      if (societySubmodule === 'pending_verifications') source = pendingMembers;
      else if (societySubmodule === 'approved_residents') source = approvedMembers;
      else if (societySubmodule === 'rejected_applications') source = rejectedMembers;
      else if (societySubmodule === 'suspended_memberships') source = suspendedMembers;
    } else if (residentStatusFilter !== 'all') {
      source = scopedMembers.filter((m) => m.verificationStatus === residentStatusFilter);
    }

    const term = customerSearch.trim().toLowerCase();
    const fromMs = residentDateFrom ? Date.parse(residentDateFrom) : 0;
    const toMs = residentDateTo ? Date.parse(residentDateTo) + 86400000 - 1 : 0;

    return source.filter((m) => {
      if (residentSocietyFilter !== 'all' && m.societyId !== residentSocietyFilter) return false;
      if (
        residentTowerFilter.trim() &&
        !m.tower.toLowerCase().includes(residentTowerFilter.trim().toLowerCase())
      ) {
        return false;
      }
      if (fromMs || toMs) {
        const createdMs = toTimestampMs(m.createdAt);
        if (fromMs && createdMs < fromMs) return false;
        if (toMs && createdMs > toMs) return false;
      }
      if (!term) return true;
      const socName = societyNameMap[m.societyId]?.societyName ?? '';
      return (
        m.residentName.toLowerCase().includes(term) ||
        (m.phoneNumber ?? '').toLowerCase().includes(term) ||
        (m.email ?? '').toLowerCase().includes(term) ||
        m.flatId.toLowerCase().includes(term) ||
        m.tower.toLowerCase().includes(term) ||
        socName.toLowerCase().includes(term)
      );
    });
  }, [
    scopedMembers,
    activeModule,
    societySubmodule,
    pendingMembers,
    approvedMembers,
    rejectedMembers,
    suspendedMembers,
    residentStatusFilter,
    customerSearch,
    residentSocietyFilter,
    residentTowerFilter,
    residentDateFrom,
    residentDateTo,
    societyNameMap,
  ]);

  const totalResidentPages = Math.max(1, Math.ceil(filteredMembersQueue.length / PAGE_SIZE));
  const paginatedMembers = useMemo(() => {
    const safePage = Math.min(residentPage, totalResidentPages);
    const start = (safePage - 1) * PAGE_SIZE;
    return filteredMembersQueue.slice(start, start + PAGE_SIZE);
  }, [filteredMembersQueue, residentPage, totalResidentPages]);

  const filteredUsers = useMemo(() => {
    const term = customerSearch.trim().toLowerCase();
    return users.filter((u) => {
      if (residentSocietyFilter !== 'all' && u.societyId !== residentSocietyFilter) return false;
      if (!term) return true;
      return (
        (u.fullName || u.name).toLowerCase().includes(term) ||
        (u.phoneNumber || '').includes(term) ||
        (u.email || '').toLowerCase().includes(term) ||
        (u.flatNumber || u.flatId || '').toLowerCase().includes(term)
      );
    });
  }, [users, customerSearch, residentSocietyFilter]);

  const writeClientAuditLog = async (
    action: string,
    targetCollection: string,
    targetId: string,
    details: string,
    societyId = '',
    targetUid = ''
  ) => {
    if (!firebaseUser || !db) return;
    const logRef = doc(collection(db, 'auditLogs'));
    await setDoc(logRef, {
      logId: logRef.id,
      actorUid: firebaseUser.uid,
      actorEmail: firebaseUser.email ?? '',
      actorRole: staffRole?.roleId ?? 'super_admin',
      action,
      targetCollection,
      targetId,
      ...(targetUid ? { targetUid } : {}),
      societyId,
      status: 'success',
      details,
      createdAt: serverTimestamp(),
    });
  };

  // Actions
  const handleCreateSociety = async (e: React.FormEvent) => {
    e.preventDefault();
    setNewSocError(null);
    if (!firebaseUser || !db) return;
    if (!hasGranularPermission(adminPermissions, 'society.create')) {
      setNewSocError('Your role does not permit registering new societies.');
      return;
    }
    const check = validateSocietyCreateInput(newSoc);
    if (!check.valid) {
      setNewSocError(check.error ?? 'Invalid society details.');
      return;
    }

    const code = newSoc.invitationCode.trim().toUpperCase();
    const societyId = `soc_${code.toLowerCase()}_${Date.now().toString(36)}`;
    const codeHash = await sha256HexBrowser(code);
    const codeId = `inv_${societyId}_${Date.now().toString(36)}`;
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
      isDemo: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    batch.set(doc(db, 'invitations', code), {
      code,
      societyId,
      societyName: newSoc.societyName.trim(),
      city: newSoc.city.trim(),
      active: true,
      createdAt: serverTimestamp(),
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
      createdBy: firebaseUser.uid,
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

    try {
      await batch.commit();
      await writeClientAuditLog(
        'CREATE_SOCIETY',
        'societies',
        societyId,
        `Created society ${newSoc.societyName.trim()} with SHA-256 hashed invitation ${code.slice(0, 4)}••••`,
        societyId
      );
      setSelectedSocietyId(societyId);
      setCreatedPlaintextCode({ code, societyName: newSoc.societyName.trim() });
      setShowNewSocietyModal(false);
      setNewSoc({
        societyName: '',
        address: '',
        city: '',
        state: '',
        pincode: '',
        invitationCode: '',
      });
      notify(`Society created and SHA-256 invitation code registered (${code}).`);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `societies/${societyId}`);
    }
  };

  const handleToggleSocietyStatus = async (soc: Society) => {
    if (!hasGranularPermission(adminPermissions, 'society.suspend')) {
      notify('Your role lacks society suspension/update permission.');
      return;
    }
    const nextStatus = soc.status === 'active' ? 'inactive' : 'active';
    try {
      await updateDoc(doc(db, 'societies', soc.societyId), {
        status: nextStatus,
        updatedAt: serverTimestamp(),
      });
      await writeClientAuditLog(
        'UPDATE_SOCIETY_STATUS',
        'societies',
        soc.societyId,
        `Changed society status to ${nextStatus}`,
        soc.societyId
      );
      notify(`${soc.societyName} marked ${nextStatus}.`);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `societies/${soc.societyId}`);
    }
  };

  const handleCreateFlat = async (e: React.FormEvent) => {
    e.preventDefault();
    setFlatError(null);
    if (!selectedSocietyId) {
      setFlatError('Select a society first.');
      return;
    }
    const check = validateFlatInput(newFlat);
    if (!check.valid) {
      setFlatError(check.error ?? 'Invalid flat details.');
      return;
    }
    const flatDocId = normalizeFlatDocId(newFlat.tower, newFlat.flatNumber);
    try {
      await setDoc(doc(db, 'societies', selectedSocietyId, 'flats', flatDocId), {
        flatId: flatDocId,
        societyId: selectedSocietyId,
        tower: newFlat.tower.trim(),
        flatNumber: newFlat.flatNumber.trim(),
        occupied: false,
        status: 'Available',
        primaryResidentUid: '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await writeClientAuditLog(
        'CREATE_FLAT',
        `societies/${selectedSocietyId}/flats`,
        flatDocId,
        `Added ${newFlat.tower.trim()} · ${newFlat.flatNumber.trim()}`,
        selectedSocietyId
      );
      setNewFlat({ tower: '', flatNumber: '' });
      notify(`Flat ${newFlat.tower.trim()} · ${newFlat.flatNumber.trim()} added.`);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `societies/${selectedSocietyId}/flats/${flatDocId}`);
    }
  };

  const handleGenerateInvitationCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setInviteError(null);
    if (!firebaseUser || !db) return;
    const targetSocietyId = inviteForm.societyId || selectedSocietyId;
    const targetSociety = societyNameMap[targetSocietyId];
    if (!targetSociety) {
      setInviteError('Select a valid residential society.');
      return;
    }
    const maxUsesNum = Number(inviteForm.maxUses);
    const expiresIso = inviteForm.expiresAt ? new Date(`${inviteForm.expiresAt}T23:59:59Z`).toISOString() : '';
    const custom = inviteForm.customCode.trim().toUpperCase();

    const check = validateInvitationCreateInput({
      societyId: targetSocietyId,
      maxUses: maxUsesNum,
      expiresAt: expiresIso || undefined,
      customCode: custom || undefined,
    });
    if (!check.valid) {
      setInviteError(check.error ?? 'Invalid invitation configuration.');
      return;
    }

    const randomSuffix = Math.random().toString(36).slice(2, 8).toUpperCase();
    const prefix = targetSociety.societyName.replace(/[^A-Za-z0-9]/g, '').slice(0, 4).toUpperCase() || 'SOC';
    const rawCode = custom || `GG-${prefix}-${randomSuffix}`;
    const codeHash = await sha256HexBrowser(rawCode);
    const codeId = `inv_${Date.now().toString(36)}_${randomSuffix.toLowerCase()}`;

    const batch = writeBatch(db);
    batch.set(doc(db, 'invitationCodes', codeId), {
      codeId,
      societyId: targetSociety.societyId,
      societyName: targetSociety.societyName,
      city: targetSociety.city,
      codeHash,
      codePreview: `${rawCode.slice(0, 4)}••••`,
      status: 'active',
      ...(expiresIso ? { expiresAt: expiresIso } : {}),
      maxUses: maxUsesNum,
      usedCount: 0,
      createdBy: firebaseUser.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(db, 'invitationLookups', codeHash), {
      codeId,
      societyId: targetSociety.societyId,
      societyName: targetSociety.societyName,
      city: targetSociety.city,
      status: 'active',
      ...(expiresIso ? { expiresAt: expiresIso } : {}),
      maxUses: maxUsesNum,
      usedCount: 0,
    });

    try {
      await batch.commit();
      await writeClientAuditLog(
        'CREATE_INVITATION_CODE',
        'invitationCodes',
        codeId,
        `Generated invitation code ${rawCode.slice(0, 4)}•••• (maxUses=${maxUsesNum})`,
        targetSociety.societyId
      );
      setCreatedPlaintextCode({ code: rawCode, societyName: targetSociety.societyName });
      setInviteForm((prev) => ({ ...prev, customCode: '' }));
      notify(`New SHA-256 invitation code generated for ${targetSociety.societyName}.`);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `invitationCodes/${codeId}`);
    }
  };

  const handleInvitationStatusChange = async (
    record: InvitationCodeRecord,
    nextStatus: 'active' | 'inactive' | 'revoked'
  ) => {
    if (!db) return;
    const batch = writeBatch(db);
    batch.update(doc(db, 'invitationCodes', record.codeId), {
      status: nextStatus,
      updatedAt: serverTimestamp(),
    });
    batch.set(
      doc(db, 'invitationLookups', record.codeHash),
      {
        codeId: record.codeId,
        societyId: record.societyId,
        societyName: record.societyName,
        city: record.city,
        status: nextStatus,
        ...(record.expiresAt ? { expiresAt: record.expiresAt } : {}),
        maxUses: record.maxUses,
        usedCount: record.usedCount,
      },
      { merge: true }
    );
    try {
      await batch.commit();
      await writeClientAuditLog(
        nextStatus === 'revoked' ? 'REVOKE_INVITATION_CODE' : 'TOGGLE_INVITATION_CODE',
        'invitationCodes',
        record.codeId,
        `Set invitation ${record.codePreview ?? record.codeId} to ${nextStatus}`,
        record.societyId
      );
      notify(`Invitation code marked ${nextStatus}.`);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `invitationCodes/${record.codeId}`);
    }
  };

  const openActionDialog = (
    type: 'approve' | 'reject' | 'info' | 'suspend' | 'reactivate',
    member: SocietyMembership
  ) => {
    setActionReason('');
    setActionError(null);
    setActionDialog({ type, member });
  };

  const handleExecuteMemberAction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!actionDialog || !firebaseUser || !db) return;
    const { type, member } = actionDialog;
    setActionError(null);

    if (type === 'reject' || type === 'info' || type === 'suspend') {
      const check = validateAdminReason(
        actionReason,
        type === 'reject' ? 'rejection' : type === 'info' ? 'information request' : 'suspension'
      );
      if (!check.valid) {
        setActionError(check.error ?? 'Reason is required.');
        return;
      }
    }

    setActionBusy(true);
    const reasonText = actionReason.trim();
    const flatDocId = normalizeFlatDocId(member.tower, member.flatNumber || member.flatId);
    const memberRef = doc(db, 'societies', member.societyId, 'members', member.uid);
    const userRef = doc(db, 'users', member.uid);
    const flatRef = doc(db, 'societies', member.societyId, 'flats', flatDocId);
    const historyId = `hist_${Date.now()}_${member.uid.slice(0, 6)}`;
    const historyRef = doc(db, 'societies', member.societyId, 'verificationHistory', historyId);
    const notifId = `notif_${type}_${member.uid}_${Date.now().toString(36)}`;
    const notifRef = doc(db, 'notifications', notifId);
    const socName = societyNameMap[member.societyId]?.societyName ?? member.societyId;

    try {
      const flatSnap = await getDoc(flatRef);
      const batch = writeBatch(db);

      if (type === 'approve') {
        batch.update(memberRef, {
          verificationStatus: 'approved',
          rejectionReason: '',
          suspensionReason: '',
          infoRequestNote: '',
          verifiedBy: firebaseUser.uid,
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
          verifiedBy: firebaseUser.uid,
          verifiedAt: serverTimestamp(),
          approvalAcknowledged: false,
          updatedAt: serverTimestamp(),
        });
        if (flatSnap.exists()) {
          batch.update(flatRef, {
            occupied: true,
            status: 'Occupied',
            primaryResidentUid: member.uid,
            residentType: member.residentType ?? 'Owner',
            updatedAt: serverTimestamp(),
          });
        } else {
          batch.set(flatRef, {
            flatId: flatDocId,
            societyId: member.societyId,
            tower: member.tower,
            flatNumber: member.flatNumber || member.flatId,
            occupied: true,
            status: 'Occupied',
            primaryResidentUid: member.uid,
            residentType: member.residentType ?? 'Owner',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
        batch.set(historyRef, {
          historyId,
          uid: member.uid,
          societyId: member.societyId,
          flatId: member.flatId,
          tower: member.tower,
          action: 'approved',
          previousStatus: member.verificationStatus,
          newStatus: 'approved',
          actorUid: firebaseUser.uid,
          actorEmail: firebaseUser.email ?? '',
          note: reasonText || `Approved ${member.tower} · ${member.flatId}`,
          createdAt: serverTimestamp(),
        });
        batch.set(notifRef, {
          notificationId: notifId,
          uid: member.uid,
          societyId: member.societyId,
          type: 'verification_approved',
          title: 'Society Membership Approved',
          body: `Your residence at ${socName} (${member.tower} · ${member.flatId}) has been verified.`,
          read: false,
          dedupeKey: `approved_${member.uid}_${member.societyId}`,
          createdAt: serverTimestamp(),
        });
      } else if (type === 'reject') {
        batch.update(memberRef, {
          verificationStatus: 'rejected',
          rejectionReason: reasonText,
          verifiedBy: firebaseUser.uid,
          verifiedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        batch.update(userRef, {
          membershipStatus: 'rejected',
          rejectionReason: reasonText,
          verifiedBy: firebaseUser.uid,
          verifiedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        if (flatSnap.exists() && flatSnap.data().primaryResidentUid === member.uid) {
          batch.update(flatRef, {
            occupied: false,
            status: 'Available',
            primaryResidentUid: '',
            updatedAt: serverTimestamp(),
          });
        }
        batch.set(historyRef, {
          historyId,
          uid: member.uid,
          societyId: member.societyId,
          flatId: member.flatId,
          tower: member.tower,
          action: 'rejected',
          previousStatus: member.verificationStatus,
          newStatus: 'rejected',
          actorUid: firebaseUser.uid,
          actorEmail: firebaseUser.email ?? '',
          note: reasonText,
          createdAt: serverTimestamp(),
        });
        batch.set(notifRef, {
          notificationId: notifId,
          uid: member.uid,
          societyId: member.societyId,
          type: 'verification_rejected',
          title: 'Society Verification Rejected',
          body: `Action needed for ${socName} (${member.tower} · ${member.flatId}): ${reasonText}`,
          read: false,
          dedupeKey: `rejected_${member.uid}_${Date.now()}`,
          createdAt: serverTimestamp(),
        });
      } else if (type === 'info') {
        batch.update(memberRef, {
          infoRequestNote: reasonText,
          updatedAt: serverTimestamp(),
        });
        batch.update(userRef, {
          infoRequestNote: reasonText,
          updatedAt: serverTimestamp(),
        });
        batch.set(historyRef, {
          historyId,
          uid: member.uid,
          societyId: member.societyId,
          flatId: member.flatId,
          tower: member.tower,
          action: 'info_requested',
          previousStatus: member.verificationStatus,
          newStatus: member.verificationStatus,
          actorUid: firebaseUser.uid,
          actorEmail: firebaseUser.email ?? '',
          note: reasonText,
          createdAt: serverTimestamp(),
        });
        batch.set(notifRef, {
          notificationId: notifId,
          uid: member.uid,
          societyId: member.societyId,
          type: 'info_requested',
          title: 'Additional Verification Details Requested',
          body: reasonText,
          read: false,
          dedupeKey: `info_${member.uid}_${Date.now()}`,
          createdAt: serverTimestamp(),
        });
      } else if (type === 'suspend') {
        batch.update(memberRef, {
          verificationStatus: 'suspended',
          suspensionReason: reasonText,
          updatedAt: serverTimestamp(),
        });
        batch.update(userRef, {
          membershipStatus: 'suspended',
          accountStatus: 'suspended',
          suspensionReason: reasonText,
          updatedAt: serverTimestamp(),
        });
        if (flatSnap.exists()) {
          batch.update(flatRef, {
            occupied: false,
            status: 'Suspended',
            updatedAt: serverTimestamp(),
          });
        }
        batch.set(historyRef, {
          historyId,
          uid: member.uid,
          societyId: member.societyId,
          flatId: member.flatId,
          tower: member.tower,
          action: 'suspended',
          previousStatus: member.verificationStatus,
          newStatus: 'suspended',
          actorUid: firebaseUser.uid,
          actorEmail: firebaseUser.email ?? '',
          note: reasonText,
          createdAt: serverTimestamp(),
        });
        batch.set(notifRef, {
          notificationId: notifId,
          uid: member.uid,
          societyId: member.societyId,
          type: 'account_suspended',
          title: 'Society Membership Suspended',
          body: `Marketplace access suspended: ${reasonText}`,
          read: false,
          dedupeKey: `suspended_${member.uid}_${Date.now()}`,
          createdAt: serverTimestamp(),
        });
      } else if (type === 'reactivate') {
        batch.update(memberRef, {
          verificationStatus: 'approved',
          suspensionReason: '',
          verifiedBy: firebaseUser.uid,
          verifiedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        batch.update(userRef, {
          membershipStatus: 'approved',
          accountStatus: 'active',
          suspensionReason: '',
          approvalAcknowledged: true,
          updatedAt: serverTimestamp(),
        });
        if (flatSnap.exists()) {
          batch.update(flatRef, {
            occupied: true,
            status: 'Occupied',
            primaryResidentUid: member.uid,
            updatedAt: serverTimestamp(),
          });
        }
        batch.set(historyRef, {
          historyId,
          uid: member.uid,
          societyId: member.societyId,
          flatId: member.flatId,
          tower: member.tower,
          action: 'reactivated',
          previousStatus: member.verificationStatus,
          newStatus: 'approved',
          actorUid: firebaseUser.uid,
          actorEmail: firebaseUser.email ?? '',
          note: reasonText || 'Account reactivated by society admin',
          createdAt: serverTimestamp(),
        });
        batch.set(notifRef, {
          notificationId: notifId,
          uid: member.uid,
          societyId: member.societyId,
          type: 'account_reactivated',
          title: 'Society Membership Reactivated',
          body: `Your access to ${socName} has been restored.`,
          read: false,
          dedupeKey: `reactivated_${member.uid}_${Date.now()}`,
          createdAt: serverTimestamp(),
        });
      }

      await batch.commit();
      await writeClientAuditLog(
        `${type.toUpperCase()}_MEMBERSHIP`,
        `societies/${member.societyId}/members`,
        member.uid,
        `${type.toUpperCase()} ${member.residentName} (${member.tower} · ${member.flatId})${reasonText ? ` — ${reasonText}` : ''}`,
        member.societyId,
        member.uid
      );
      setActionDialog(null);
      notify(`Updated ${member.residentName} (${type}).`);
    } catch (err) {
      handleFirestoreError(
        err,
        OperationType.UPDATE,
        `societies/${member.societyId}/members/${member.uid}`
      );
    } finally {
      setActionBusy(false);
    }
  };

  const handleCreateBulkOffer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSocietyId) return;
    const campaignId = `bulk_${Date.now().toString(36)}`;
    try {
      await setDoc(doc(db, 'societies', selectedSocietyId, 'campaigns', campaignId), {
        campaignId,
        societyId: selectedSocietyId,
        title: newBulk.title.trim(),
        description: newBulk.description.trim() || 'Society-exclusive vendor bulk offer',
        category: newBulk.category,
        imageUrl: '/src/assets/images/service_ac_maintenance_1795187598387.jpg',
        regularPricePaise: Math.round(Number(newBulk.regularPriceRupees) * 100),
        offerPricePaise: Math.round(Number(newBulk.offerPriceRupees) * 100),
        minimumTarget: Math.max(1, Math.round(Number(newBulk.minimumTarget))),
        maximumCapacity: Math.max(1, Math.round(Number(newBulk.maximumCapacity))),
        currentParticipants: 0,
        bookingDeadline: newBulk.bookingDeadline,
        scheduledDate: newBulk.scheduledDate,
        status: 'active',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await writeClientAuditLog(
        'CREATE_BULK_CAMPAIGN',
        `societies/${selectedSocietyId}/campaigns`,
        campaignId,
        `Created bulk offer ${newBulk.title.trim()}`,
        selectedSocietyId
      );
      setNewBulk((p) => ({ ...p, title: '', description: '' }));
      notify('Bulk vendor offer published to selected society.');
    } catch (err) {
      handleFirestoreError(
        err,
        OperationType.CREATE,
        `societies/${selectedSocietyId}/campaigns/${campaignId}`
      );
    }
  };

  const handleCreateGroupOffer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSocietyId) return;
    const campaignId = `grp_${Date.now().toString(36)}`;
    try {
      await setDoc(doc(db, 'societies', selectedSocietyId, 'groupCampaigns', campaignId), {
        campaignId,
        societyId: selectedSocietyId,
        title: newGroup.title.trim(),
        description: newGroup.description.trim() || 'Direct farm/brand group batch',
        unitLabel: newGroup.unitLabel.trim(),
        imageUrl: '/src/assets/images/group_buy_mangoes_1795187598328.jpg',
        marketPricePaise: Math.round(Number(newGroup.marketPriceRupees) * 100),
        groupPricePaise: Math.round(Number(newGroup.groupPriceRupees) * 100),
        minimumGroupQuantity: Math.max(1, Math.round(Number(newGroup.minimumGroupQuantity))),
        currentQuantity: 0,
        deadline: newGroup.deadline,
        expectedDeliveryDate: newGroup.expectedDeliveryDate,
        status: 'active',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await writeClientAuditLog(
        'CREATE_GROUP_CAMPAIGN',
        `societies/${selectedSocietyId}/groupCampaigns`,
        campaignId,
        `Created group buy ${newGroup.title.trim()}`,
        selectedSocietyId
      );
      setNewGroup((p) => ({ ...p, title: '', description: '' }));
      notify('Group buying campaign published to selected society.');
    } catch (err) {
      handleFirestoreError(
        err,
        OperationType.CREATE,
        `societies/${selectedSocietyId}/groupCampaigns/${campaignId}`
      );
    }
  };

  const handleCreateProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    const productId = `prod_${Date.now().toString(36)}`;
    try {
      await setDoc(doc(db, 'products', productId), {
        productId,
        title: newProduct.title.trim(),
        description: newProduct.description.trim() || 'Fresh society-delivered essential',
        category: newProduct.category,
        imageUrl: '/src/assets/images/group_buy_mangoes_1795187598328.jpg',
        mrpPaise: Math.round(Number(newProduct.mrpRupees) * 100),
        pricePaise: Math.round(Number(newProduct.priceRupees) * 100),
        unitLabel: newProduct.unitLabel.trim(),
        stockQuantity: Math.max(0, Math.round(Number(newProduct.stockQuantity))),
        active: true,
        createdAt: serverTimestamp(),
      });
      await writeClientAuditLog('CREATE_PRODUCT', 'products', productId, newProduct.title.trim());
      setNewProduct((p) => ({ ...p, title: '', description: '' }));
      notify('Product added to Buy Now catalog.');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `products/${productId}`);
    }
  };

  const handleCreateService = async (e: React.FormEvent) => {
    e.preventDefault();
    const serviceId = `svc_${Date.now().toString(36)}`;
    try {
      await setDoc(doc(db, 'services', serviceId), {
        serviceId,
        title: newService.title.trim(),
        category: newService.category,
        description: newService.description.trim() || 'Trained background-verified technician',
        instructions: newService.instructions.trim(),
        imageUrl: newService.category.includes('Cleaning')
          ? '/src/assets/images/service_deep_cleaning_1795187599857.jpg'
          : '/src/assets/images/service_ac_maintenance_1795187598387.jpg',
        startingPricePaise: Math.round(Number(newService.startingPriceRupees) * 100),
        available: true,
        createdAt: serverTimestamp(),
      });
      await writeClientAuditLog('CREATE_SERVICE', 'services', serviceId, newService.title.trim());
      setNewService((p) => ({ ...p, title: '', description: '', instructions: '' }));
      notify('Home service added to catalog.');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `services/${serviceId}`);
    }
  };

  const handleCreateRole = async (e: React.FormEvent) => {
    e.preventDefault();
    const roleId = newRole.roleId.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    if (!roleId || !newRole.name.trim()) return;
    try {
      await setDoc(doc(db, 'roles', roleId), {
        roleId,
        name: newRole.name.trim(),
        description: newRole.description.trim(),
        permissions: newRole.permissions,
        createdAt: serverTimestamp(),
      });
      await writeClientAuditLog('CREATE_ROLE', 'roles', roleId, `Created role ${newRole.name}`);
      setNewRole({
        roleId: '',
        name: '',
        description: '',
        permissions: ['society.view', 'customer.view', 'customer.verify'],
      });
      notify(`Role ${roleId} saved.`);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `roles/${roleId}`);
    }
  };

  const handleInsertLabelledDemoCatalog = async () => {
    if (!firebaseUser) return;
    setSeedingDemo(true);
    try {
      const batch = writeBatch(db);
      const demoSocId = 'demo_palm_meadows';
      const demoCode = 'PALMDEMO26';
      const demoHash = await sha256HexBrowser(demoCode);
      const demoCodeId = 'inv_demo_palmdemo26';

      batch.set(doc(db, 'societies', demoSocId), {
        societyId: demoSocId,
        societyName: '[DEMO] Palm Meadows Residency',
        address: 'Whitefield Main Road, Bengaluru',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincode: '560066',
        invitationCode: demoCode,
        towers: ['Tower A', 'Tower B'],
        totalFlats: 240,
        status: 'active',
        isDemo: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      batch.set(doc(db, 'invitations', demoCode), {
        code: demoCode,
        societyId: demoSocId,
        societyName: '[DEMO] Palm Meadows Residency',
        city: 'Bengaluru',
        active: true,
        createdAt: serverTimestamp(),
      });
      batch.set(doc(db, 'invitationCodes', demoCodeId), {
        codeId: demoCodeId,
        societyId: demoSocId,
        societyName: '[DEMO] Palm Meadows Residency',
        city: 'Bengaluru',
        codeHash: demoHash,
        codePreview: 'PALM••••',
        status: 'active',
        maxUses: 500,
        usedCount: 0,
        createdBy: firebaseUser.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      batch.set(doc(db, 'invitationLookups', demoHash), {
        codeId: demoCodeId,
        societyId: demoSocId,
        societyName: '[DEMO] Palm Meadows Residency',
        city: 'Bengaluru',
        status: 'active',
        maxUses: 500,
        usedCount: 0,
      });

      const demoFlats = [
        { tower: 'Tower A', flatNumber: 'A-401' },
        { tower: 'Tower A', flatNumber: 'A-402' },
        { tower: 'Tower B', flatNumber: 'B-201' },
      ];
      for (const f of demoFlats) {
        const flatId = normalizeFlatDocId(f.tower, f.flatNumber);
        batch.set(doc(db, 'societies', demoSocId, 'flats', flatId), {
          flatId,
          societyId: demoSocId,
          tower: f.tower,
          flatNumber: f.flatNumber,
          occupied: false,
          status: 'Available',
          primaryResidentUid: '',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      const bulkId = 'demo_bulk_ac_service';
      batch.set(doc(db, 'societies', demoSocId, 'campaigns', bulkId), {
        campaignId: bulkId,
        societyId: demoSocId,
        title: '[DEMO] Split AC Jet-Pump Servicing',
        description: 'Society-wide AC foam jet servicing with 30-day warranty.',
        category: 'AC Repair and Servicing',
        imageUrl: '/src/assets/images/service_ac_maintenance_1795187598387.jpg',
        regularPricePaise: 79900,
        offerPricePaise: 49900,
        minimumTarget: 15,
        maximumCapacity: 60,
        currentParticipants: 0,
        bookingDeadline: '2026-12-15',
        scheduledDate: '2026-12-20',
        status: 'active',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      const grpId = 'demo_group_alphonso';
      batch.set(doc(db, 'societies', demoSocId, 'groupCampaigns', grpId), {
        campaignId: grpId,
        societyId: demoSocId,
        title: '[DEMO] Ratnagiri Alphonso & Organic Pantry Crate',
        description: 'Direct orchard harvest delivered to your tower lobby.',
        unitLabel: '1 Dozen Crate',
        imageUrl: '/src/assets/images/group_buy_mangoes_1795187598328.jpg',
        marketPricePaise: 145000,
        groupPricePaise: 99000,
        minimumGroupQuantity: 25,
        currentQuantity: 0,
        deadline: '2026-12-12',
        expectedDeliveryDate: '2026-12-18',
        status: 'active',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      batch.set(doc(db, 'products', 'demo_prod_quinoa'), {
        productId: 'demo_prod_quinoa',
        title: '[DEMO] Organic Pantry Essentials Pack',
        description: 'Whole grain quinoa, rolled oats, and brown rice in glass jars.',
        category: 'Pantry & Staples',
        imageUrl: '/src/assets/images/group_buy_mangoes_1795187598328.jpg',
        mrpPaise: 65000,
        pricePaise: 49500,
        unitLabel: '1.35 kg combo',
        stockQuantity: 40,
        active: true,
        createdAt: serverTimestamp(),
      });

      const svcSeed = [
        { id: 'demo_svc_ac', title: '[DEMO] Split AC Foam Servicing', category: 'AC Repair and Servicing', price: 49900 },
        { id: 'demo_svc_plumb', title: '[DEMO] Tap & Pipeline Leak Repair', category: 'Plumbing', price: 24900 },
        { id: 'demo_svc_elec', title: '[DEMO] MCB & Switchboard Inspection', category: 'Electrical Work', price: 29900 },
        { id: 'demo_svc_pest', title: '[DEMO] Kitchen Gel Pest Control', category: 'Pest Control', price: 69900 },
        { id: 'demo_svc_clean', title: '[DEMO] 2BHK Kitchen & Bath Deep Clean', category: 'Deep Cleaning', price: 149900 },
        { id: 'demo_svc_ro', title: '[DEMO] RO Filter & Membrane Service', category: 'RO Servicing', price: 39900 },
        { id: 'demo_svc_paint', title: '[DEMO] Balcony & Wall Touch-up', category: 'Painting', price: 99900 },
        { id: 'demo_svc_other', title: '[DEMO] General Handyman Visit', category: 'Other Home Services', price: 24900 },
      ];

      for (const s of svcSeed) {
        batch.set(doc(db, 'services', s.id), {
          serviceId: s.id,
          title: s.title,
          category: s.category,
          description: `Verified society technician for ${s.category}.`,
          instructions: 'Technician carries society entry pass and standard tools.',
          imageUrl: s.category.includes('Cleaning')
            ? '/src/assets/images/service_deep_cleaning_1795187599857.jpg'
            : '/src/assets/images/service_ac_maintenance_1795187598387.jpg',
          startingPricePaise: s.price,
          available: true,
          createdAt: serverTimestamp(),
        });
      }

      await batch.commit();
      await writeClientAuditLog(
        'SEED_LABELLED_DEMO_DATA',
        'societies',
        demoSocId,
        'Admin manually inserted labelled [DEMO] society (PALMDEMO26) with SHA-256 lookup and demo flats',
        demoSocId
      );
      setSelectedSocietyId(demoSocId);
      setShowDemoSeedConfirm(false);
      notify('Labelled [DEMO] society (invite: PALMDEMO26) and SHA-256 lookup inserted.');
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'societies/demo_palm_meadows');
    } finally {
      setSeedingDemo(false);
    }
  };

  // Protected Route Gate
  if (loading) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-16 text-center text-sm text-slate-600">
        Verifying administrator credentials...
      </div>
    );
  }

  if (!firebaseUser || !isAdminAuthorized) {
    return (
      <div className="max-w-md mx-auto px-4 py-16">
        <div className="bg-white border border-slate-200 rounded-2xl p-8">
          <div className="flex items-center gap-2 text-[#0F3D2E] font-semibold text-xs">
            <ShieldCheck className="w-4 h-4" />
            <span>Protected Admin Route</span>
          </div>
          <h1 className="mt-2 text-2xl font-bold text-slate-900">Admin Console Sign In</h1>
          <p className="mt-2 text-sm text-slate-600 leading-relaxed">
            Access is restricted to verified administrators and active staff roles defined in Cloud Firestore.
          </p>
          {firebaseUser && !isAdminAuthorized ? (
            <div className="mt-4 p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800">
              Signed in as <span className="font-mono">{firebaseUser.email || firebaseUser.uid}</span>, which does not hold an active staff/super-admin authorization.
            </div>
          ) : null}
          <div className="mt-6 flex flex-col gap-2">
            {!firebaseUser ? (
              <button
                onClick={signInWithGoogle}
                className="w-full py-2.5 px-4 rounded-xl bg-[#0F3D2E] text-white text-sm font-semibold hover:bg-[#0B2E22]"
              >
                Sign In with Verified Google Account
              </button>
            ) : (
              <button
                onClick={logout}
                className="w-full py-2.5 px-4 rounded-xl border border-slate-300 text-sm font-semibold text-slate-700"
              >
                Sign Out and Switch Account
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  const activeModuleMeta = ADMIN_SIDEBAR_MODULES.find((m) => m.id === activeModule)!;

  const renderVerificationTable = (rows: SocietyMembership[]) => {
    if (rows.length === 0) {
      return (
        <div className="p-8 text-sm text-slate-500">
          No resident verification records match the current filters.
        </div>
      );
    }

    return (
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
            <tr>
              <th className="px-4 py-3">Resident Name</th>
              <th className="px-4 py-3">Mobile / Email</th>
              <th className="px-4 py-3">Society</th>
              <th className="px-4 py-3">Tower &amp; Flat</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Submitted</th>
              <th className="px-4 py-3">Verification</th>
              <th className="px-4 py-3">Account</th>
              <th className="px-4 py-3">Reviewed By</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((m) => {
              const userDoc = userMap[m.uid];
              const socName = societyNameMap[m.societyId]?.societyName ?? m.societyId;
              const accountStat = userDoc?.accountStatus ?? (m.verificationStatus === 'suspended' ? 'suspended' : 'active');
              return (
                <tr key={`${m.societyId}_${m.uid}`} className="hover:bg-slate-50/70">
                  <td className="px-4 py-3 font-semibold text-slate-900 whitespace-nowrap">
                    {m.residentName}
                  </td>
                  <td className="px-4 py-3 text-slate-600 font-mono whitespace-nowrap">
                    <div>{m.phoneNumber || userDoc?.phoneNumber || '—'}</div>
                    {m.email ? <div className="text-[11px] text-slate-400">{m.email}</div> : null}
                  </td>
                  <td className="px-4 py-3 text-slate-700 max-w-[180px] truncate">{socName}</td>
                  <td className="px-4 py-3 text-slate-700 whitespace-nowrap">
                    {m.tower} · {m.flatNumber || m.flatId}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{m.residentType ?? 'Owner'}</td>
                  <td className="px-4 py-3 text-slate-500 whitespace-nowrap tabular-nums">
                    {formatTimestamp(m.createdAt)}
                  </td>
                  <td className="px-4 py-3 font-medium whitespace-nowrap">
                    <span
                      className={
                        m.verificationStatus === 'approved'
                          ? 'text-emerald-700'
                          : m.verificationStatus === 'pending'
                            ? 'text-amber-700'
                            : m.verificationStatus === 'rejected'
                              ? 'text-red-700'
                              : 'text-slate-700'
                      }
                    >
                      {m.verificationStatus}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{accountStat}</td>
                  <td className="px-4 py-3 font-mono text-[11px] text-slate-500 whitespace-nowrap">
                    {m.verifiedBy ? m.verifiedBy.slice(0, 10) : '—'}
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <div className="inline-flex items-center gap-1.5">
                      <button
                        onClick={() => setInspectMember(m)}
                        title="View Verification Details"
                        className="px-2 py-1 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-100 inline-flex items-center gap-1"
                      >
                        <Eye className="w-3 h-3" />
                        <span>View</span>
                      </button>
                      {m.verificationStatus !== 'approved' && m.verificationStatus !== 'suspended' ? (
                        <button
                          onClick={() => openActionDialog('approve', m)}
                          className="px-2.5 py-1 rounded-lg bg-[#0F3D2E] text-white font-semibold"
                        >
                          Approve
                        </button>
                      ) : null}
                      {m.verificationStatus === 'pending' ? (
                        <>
                          <button
                            onClick={() => openActionDialog('info', m)}
                            className="px-2 py-1 rounded-lg border border-slate-300 text-slate-700"
                          >
                            Request Info
                          </button>
                          <button
                            onClick={() => openActionDialog('reject', m)}
                            className="px-2 py-1 rounded-lg border border-red-200 text-red-700"
                          >
                            Reject
                          </button>
                        </>
                      ) : null}
                      {m.verificationStatus === 'approved' ? (
                        <button
                          onClick={() => openActionDialog('suspend', m)}
                          className="px-2 py-1 rounded-lg border border-red-200 text-red-700"
                        >
                          Suspend
                        </button>
                      ) : null}
                      {m.verificationStatus === 'suspended' ? (
                        <button
                          onClick={() => openActionDialog('reactivate', m)}
                          className="px-2.5 py-1 rounded-lg bg-[#0F3D2E] text-white font-semibold"
                        >
                          Reactivate
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className="min-h-[calc(100vh-65px)] flex bg-[#F8FAF9]">
      {/* Mobile Sidebar Overlay */}
      {sidebarOpen ? (
        <div
          onClick={() => setSidebarOpen(false)}
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
        />
      ) : null}

      {/* Dark Green Enterprise Sidebar */}
      <aside
        className={`fixed lg:static inset-y-0 left-0 z-50 w-64 shrink-0 bg-[#0F3D2E] text-white flex flex-col transition-transform lg:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
          <div>
            <div className="text-sm font-bold tracking-tight">Operations Console</div>
            <div className="text-xs text-emerald-200/80 mt-0.5">
              {staffRole?.name ?? 'Super Administrator'}
            </div>
          </div>
          <button onClick={() => setSidebarOpen(false)} className="lg:hidden text-white/80">
            <X className="w-4 h-4" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto py-3 px-2.5 space-y-0.5">
          {ADMIN_SIDEBAR_MODULES.map((mod) => {
            const active = activeModule === mod.id;
            return (
              <button
                key={mod.id}
                onClick={() => {
                  setActiveModule(mod.id);
                  setSidebarOpen(false);
                }}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-left text-xs font-medium transition-colors ${
                  active
                    ? 'bg-white/15 text-white font-semibold'
                    : 'text-emerald-100/80 hover:bg-white/10'
                }`}
              >
                <span className="truncate">{mod.label}</span>
                {mod.id === 'customers' && pendingMembers.length > 0 ? (
                  <span className="font-mono tabular-nums text-[11px] text-amber-300 ml-2">
                    {pendingMembers.length}
                  </span>
                ) : mod.phase === 2 ? (
                  <span className="text-[10px] text-emerald-200/65 shrink-0 ml-2">Phase 2</span>
                ) : null}
              </button>
            );
          })}
        </nav>

        <div className="p-3 border-t border-white/10 text-[11px] text-emerald-100/80 space-y-1">
          <div className="font-mono truncate">{configuredProjectId}</div>
          <div className="truncate">
            Firestore: {connectionStatus === 'connected' ? 'Connected' : connectionStatus}
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 min-w-0 p-5 lg:p-8">
        <div className="flex flex-wrap items-center justify-between gap-4 pb-5 border-b border-slate-200">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(true)}
              aria-label="Open sidebar"
              className="lg:hidden p-2 rounded-lg border border-slate-200 bg-white text-slate-700"
            >
              <Menu className="w-4 h-4" />
            </button>
            <div>
              <div className="text-xs text-slate-500">
                Admin Console · {activeModuleMeta.phase === 1 ? 'Phase 2 Operational' : 'Phase 3 Scheduled'}
              </div>
              <h1 className="text-xl lg:text-2xl font-bold text-slate-900">
                {activeModuleMeta.label}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowDemoSeedConfirm(true)}
              className="px-3.5 py-2 rounded-xl border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              Insert Labelled Demo Catalog
            </button>
            <button
              onClick={() => setShowNewSocietyModal(true)}
              className="px-3.5 py-2 rounded-xl bg-[#0F3D2E] text-white text-xs font-semibold hover:bg-[#0B2E22] flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Society</span>
            </button>
          </div>
        </div>

        {toast ? (
          <div className="mt-4 px-4 py-3 rounded-xl bg-[#0F3D2E] text-white text-xs font-medium flex items-center justify-between">
            <span>{toast}</span>
            <button onClick={() => setToast(null)}>
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : null}

        {createdPlaintextCode ? (
          <div className="mt-4 p-4 rounded-xl bg-emerald-50 border border-emerald-200 flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs text-emerald-950">
              <div className="font-bold">
                One-time Invitation Code Reveal — {createdPlaintextCode.societyName}
              </div>
              <div className="mt-1 text-emerald-800">
                Share this code securely with residents. Only its SHA-256 digest is stored for customer lookup.
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="px-3 py-1.5 rounded-lg bg-white border border-emerald-300 font-mono text-sm font-bold text-[#0F3D2E]">
                {createdPlaintextCode.code}
              </span>
              <button
                onClick={() => {
                  navigator.clipboard?.writeText(createdPlaintextCode.code);
                  notify('Invitation code copied.');
                }}
                className="px-3 py-1.5 rounded-lg bg-[#0F3D2E] text-white text-xs font-semibold inline-flex items-center gap-1"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>Copy</span>
              </button>
              <button
                onClick={() => setCreatedPlaintextCode(null)}
                className="p-1.5 text-emerald-800 hover:text-emerald-950"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        ) : null}

        {/* MODULE 1: OVERVIEW (6 Phase 2 KPIs + Live Queue) */}
        {activeModule === 'overview' ? (
          <div className="mt-6 space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
              <div className="bg-white border border-slate-200 rounded-xl p-4">
                <div className="text-xs font-medium text-slate-500">Total Societies</div>
                <div className="mt-1 text-2xl font-bold font-mono tabular-nums text-slate-900">
                  {scopedSocieties.length}
                </div>
              </div>
              <div className="bg-white border border-slate-200 rounded-xl p-4">
                <div className="text-xs font-medium text-slate-500">Registered Residents</div>
                <div className="mt-1 text-2xl font-bold font-mono tabular-nums text-slate-900">
                  {registeredCustomersCount}
                </div>
              </div>
              <div className="bg-white border border-slate-200 rounded-xl p-4">
                <div className="text-xs font-medium text-slate-500">Pending Verifications</div>
                <div className="mt-1 text-2xl font-bold font-mono tabular-nums text-amber-700">
                  {pendingMembers.length}
                </div>
              </div>
              <div className="bg-white border border-slate-200 rounded-xl p-4">
                <div className="text-xs font-medium text-slate-500">Approved Residents</div>
                <div className="mt-1 text-2xl font-bold font-mono tabular-nums text-emerald-700">
                  {approvedMembers.length}
                </div>
              </div>
              <div className="bg-white border border-slate-200 rounded-xl p-4">
                <div className="text-xs font-medium text-slate-500">Rejected Applications</div>
                <div className="mt-1 text-2xl font-bold font-mono tabular-nums text-red-700">
                  {rejectedMembers.length}
                </div>
              </div>
              <div className="bg-white border border-slate-200 rounded-xl p-4">
                <div className="text-xs font-medium text-slate-500">Suspended Accounts</div>
                <div className="mt-1 text-2xl font-bold font-mono tabular-nums text-slate-700">
                  {suspendedMembers.length}
                </div>
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <h2 className="text-sm font-bold text-slate-900">Firebase Connection &amp; Security Health</h2>
              <div className="mt-3 grid grid-cols-1 md:grid-cols-4 gap-4 text-xs">
                <div>
                  <span className="text-slate-500">Project ID:</span>{' '}
                  <span className="font-mono text-slate-900">{configuredProjectId}</span>
                </div>
                <div>
                  <span className="text-slate-500">Database ID:</span>{' '}
                  <span className="font-mono text-slate-900">{configuredDatabaseId}</span>
                </div>
                <div>
                  <span className="text-slate-500">Live Orders:</span>{' '}
                  <span className="font-mono tabular-nums font-semibold text-slate-900">{orders.length}</span>
                </div>
                <div>
                  <span className="text-slate-500">Connection Status:</span>{' '}
                  <span className={connectionStatus === 'connected' ? 'text-emerald-700 font-semibold' : 'text-red-600 font-semibold'}>
                    {connectionStatus === 'connected' ? 'Connected to Cloud Firestore' : connectionError || connectionStatus}
                  </span>
                </div>
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
                <h2 className="text-sm font-bold text-slate-900">
                  Pending Resident Verification Queue ({pendingMembers.length})
                </h2>
                <button
                  onClick={() => setActiveModule('customers')}
                  className="text-xs font-semibold text-[#0F3D2E] hover:underline"
                >
                  Open Resident Directory
                </button>
              </div>
              {pendingMembers.length === 0 ? (
                <div className="p-6 text-sm text-slate-500">
                  No pending resident verification requests in Firestore.
                </div>
              ) : (
                renderVerificationTable(pendingMembers.slice(0, 8))
              )}
            </div>
          </div>
        ) : null}

        {/* MODULE 2: SOCIETY MANAGEMENT (7 Sub-modules) */}
        {activeModule === 'societies' ? (
          <div className="mt-6 space-y-5">
            <div className="flex flex-wrap gap-1.5 border-b border-slate-200 pb-3">
              {SOCIETY_MANAGEMENT_SUBMODULES.map((sub) => {
                const active = societySubmodule === sub.id;
                const badgeCount =
                  sub.id === 'pending_verifications'
                    ? pendingMembers.length
                    : sub.id === 'approved_residents'
                      ? approvedMembers.length
                      : sub.id === 'rejected_applications'
                        ? rejectedMembers.length
                        : sub.id === 'suspended_memberships'
                          ? suspendedMembers.length
                          : undefined;
                return (
                  <button
                    key={sub.id}
                    onClick={() => {
                      setSocietySubmodule(sub.id);
                      setResidentPage(1);
                    }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                      active
                        ? 'bg-[#0F3D2E] text-white'
                        : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <span>{sub.label}</span>
                    {badgeCount !== undefined ? (
                      <span className="ml-1.5 font-mono tabular-nums opacity-80">
                        ({badgeCount})
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>

            {societySubmodule === 'all_societies' ? (
              <div className="space-y-4">
                <div className="flex flex-wrap gap-3">
                  <div className="relative flex-1 min-w-[220px] max-w-sm">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      value={societySearch}
                      onChange={(e) => setSocietySearch(e.target.value)}
                      placeholder="Search societies or invite code..."
                      className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-slate-200 rounded-xl"
                    />
                  </div>
                  <select
                    value={societyCityFilter}
                    onChange={(e) => setSocietyCityFilter(e.target.value)}
                    className="px-3 py-2 text-sm bg-white border border-slate-200 rounded-xl"
                  >
                    <option value="all">All Cities</option>
                    {cities.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                  <select
                    value={societyStatusFilter}
                    onChange={(e) =>
                      setSocietyStatusFilter(e.target.value as 'all' | 'active' | 'inactive')
                    }
                    className="px-3 py-2 text-sm bg-white border border-slate-200 rounded-xl"
                  >
                    <option value="all">All Statuses</option>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>

                <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
                  {filteredSocieties.length === 0 ? (
                    <div className="p-8 text-sm text-slate-500">
                      No societies registered yet. Click &ldquo;Add Society&rdquo; or insert the labelled demo catalog.
                    </div>
                  ) : (
                    <table className="w-full text-left text-sm">
                      <thead className="bg-slate-50 text-xs text-slate-500 border-b border-slate-200">
                        <tr>
                          <th className="px-5 py-3">Society Name</th>
                          <th className="px-5 py-3">Location</th>
                          <th className="px-5 py-3">Primary Code</th>
                          <th className="px-5 py-3">Status</th>
                          <th className="px-5 py-3 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {filteredSocieties.map((soc) => (
                          <tr key={soc.societyId} className="hover:bg-slate-50/70">
                            <td className="px-5 py-3 font-semibold text-slate-900">
                              {soc.societyName}
                            </td>
                            <td className="px-5 py-3 text-slate-600">
                              {soc.city}, {soc.state} · {soc.pincode}
                            </td>
                            <td className="px-5 py-3 font-mono text-xs text-[#0F3D2E]">
                              {soc.invitationCode}
                            </td>
                            <td className="px-5 py-3 text-slate-700">{soc.status}</td>
                            <td className="px-5 py-3 text-right space-x-3 whitespace-nowrap">
                              <button
                                onClick={() => {
                                  setSelectedSocietyId(soc.societyId);
                                  setSocietySubmodule('towers_flats');
                                }}
                                className="text-xs font-semibold text-slate-700 hover:underline"
                              >
                                Flats
                              </button>
                              <button
                                onClick={() => {
                                  setSelectedSocietyId(soc.societyId);
                                  setInviteForm((prev) => ({ ...prev, societyId: soc.societyId }));
                                  setSocietySubmodule('invitation_codes');
                                }}
                                className="text-xs font-semibold text-slate-700 hover:underline"
                              >
                                Codes
                              </button>
                              <button
                                onClick={() => handleToggleSocietyStatus(soc)}
                                className="text-xs font-semibold text-[#0F3D2E] hover:underline"
                              >
                                {soc.status === 'active' ? 'Deactivate' : 'Activate'}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            ) : null}

            {societySubmodule === 'towers_flats' ? (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                <form
                  onSubmit={handleCreateFlat}
                  className="lg:col-span-4 bg-white border border-slate-200 rounded-xl p-5 space-y-3 h-fit"
                >
                  <h2 className="text-sm font-bold text-slate-900">Configure Tower &amp; Flat</h2>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Society</label>
                    <select
                      value={selectedSocietyId}
                      onChange={(e) => setSelectedSocietyId(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl bg-white"
                    >
                      {scopedSocieties.map((s) => (
                        <option key={s.societyId} value={s.societyId}>
                          {s.societyName}
                        </option>
                      ))}
                    </select>
                  </div>
                  <input
                    required
                    value={newFlat.tower}
                    onChange={(e) => setNewFlat({ ...newFlat, tower: e.target.value })}
                    placeholder="Tower / Block (e.g. Tower A)"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl"
                  />
                  <input
                    required
                    value={newFlat.flatNumber}
                    onChange={(e) => setNewFlat({ ...newFlat, flatNumber: e.target.value })}
                    placeholder="Flat Number (e.g. A-401)"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl"
                  />
                  {flatError ? <div className="text-xs text-red-600">{flatError}</div> : null}
                  <button
                    type="submit"
                    disabled={!selectedSocietyId}
                    className="w-full py-2.5 px-4 rounded-xl bg-[#0F3D2E] text-white text-sm font-semibold"
                  >
                    Register Flat Unit
                  </button>
                </form>

                <div className="lg:col-span-8 bg-white border border-slate-200 rounded-xl overflow-hidden">
                  <div className="px-5 py-3.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm font-bold text-slate-900">
                      Registered Flats ({filteredFlats.length})
                    </div>
                    <div className="flex gap-2">
                      <select
                        value={flatTowerFilter}
                        onChange={(e) => setFlatTowerFilter(e.target.value)}
                        className="px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg bg-white"
                      >
                        <option value="all">All Towers</option>
                        {flatTowers.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                      <select
                        value={flatStatusFilter}
                        onChange={(e) => setFlatStatusFilter(e.target.value)}
                        className="px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg bg-white"
                      >
                        <option value="all">All Statuses</option>
                        <option value="Available">Available</option>
                        <option value="Verification Pending">Verification Pending</option>
                        <option value="Occupied">Occupied</option>
                        <option value="Suspended">Suspended</option>
                      </select>
                    </div>
                  </div>
                  {filteredFlats.length === 0 ? (
                    <div className="p-6 text-sm text-slate-500">
                      No flats configured yet for this society.
                    </div>
                  ) : (
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
                        <tr>
                          <th className="px-4 py-3">Tower</th>
                          <th className="px-4 py-3">Flat Number</th>
                          <th className="px-4 py-3">Status</th>
                          <th className="px-4 py-3">Type</th>
                          <th className="px-4 py-3">Primary Resident UID</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {filteredFlats.map((f) => (
                          <tr key={f.flatId}>
                            <td className="px-4 py-3 font-medium text-slate-900">{f.tower}</td>
                            <td className="px-4 py-3 font-mono text-slate-800">{f.flatNumber}</td>
                            <td className="px-4 py-3">
                              <span
                                className={
                                  f.status === 'Occupied' || f.status === 'Active'
                                    ? 'text-emerald-700 font-semibold'
                                    : f.status === 'Verification Pending'
                                      ? 'text-amber-700 font-semibold'
                                      : f.status === 'Suspended'
                                        ? 'text-red-700 font-semibold'
                                        : 'text-slate-600'
                                }
                              >
                                {f.status}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-slate-600">{f.residentType ?? '—'}</td>
                            <td className="px-4 py-3 font-mono text-slate-500">
                              {f.primaryResidentUid ? f.primaryResidentUid.slice(0, 14) : 'Unassigned'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            ) : null}

            {societySubmodule === 'invitation_codes' ? (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                <form
                  onSubmit={handleGenerateInvitationCode}
                  className="lg:col-span-4 bg-white border border-slate-200 rounded-xl p-5 space-y-3 h-fit"
                >
                  <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
                    <KeyRound className="w-4 h-4 text-[#0F3D2E]" />
                    <span>Generate SHA-256 Invitation Code</span>
                  </div>
                  <select
                    value={inviteForm.societyId || selectedSocietyId}
                    onChange={(e) => setInviteForm({ ...inviteForm, societyId: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl bg-white"
                  >
                    {scopedSocieties.map((s) => (
                      <option key={s.societyId} value={s.societyId}>
                        {s.societyName}
                      </option>
                    ))}
                  </select>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 mb-1">
                        Max Uses
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={10000}
                        value={inviteForm.maxUses}
                        onChange={(e) => setInviteForm({ ...inviteForm, maxUses: e.target.value })}
                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 mb-1">
                        Expires On (Optional)
                      </label>
                      <input
                        type="date"
                        value={inviteForm.expiresAt}
                        onChange={(e) => setInviteForm({ ...inviteForm, expiresAt: e.target.value })}
                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 mb-1">
                      Custom Code (Optional)
                    </label>
                    <input
                      value={inviteForm.customCode}
                      onChange={(e) =>
                        setInviteForm({ ...inviteForm, customCode: e.target.value.toUpperCase() })
                      }
                      placeholder="Auto-generated if blank"
                      className="w-full px-3 py-2 text-sm font-mono uppercase border border-slate-300 rounded-xl"
                    />
                  </div>
                  {inviteError ? <div className="text-xs text-red-600">{inviteError}</div> : null}
                  <button
                    type="submit"
                    disabled={scopedSocieties.length === 0}
                    className="w-full py-2.5 px-4 rounded-xl bg-[#0F3D2E] text-white text-sm font-semibold"
                  >
                    Generate Hashed Code
                  </button>
                </form>

                <div className="lg:col-span-8 bg-white border border-slate-200 rounded-xl overflow-x-auto">
                  <div className="px-5 py-3.5 border-b border-slate-200 text-sm font-bold text-slate-900">
                    Invitation Codes ({invitationCodes.length})
                  </div>
                  {invitationCodes.length === 0 ? (
                    <div className="p-6 text-sm text-slate-500">
                      No hashed invitation codes recorded yet.
                    </div>
                  ) : (
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
                        <tr>
                          <th className="px-4 py-3">Preview</th>
                          <th className="px-4 py-3">Society</th>
                          <th className="px-4 py-3">Usage</th>
                          <th className="px-4 py-3">Expires</th>
                          <th className="px-4 py-3">Status</th>
                          <th className="px-4 py-3 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {invitationCodes.map((c) => (
                          <tr key={c.codeId}>
                            <td className="px-4 py-3 font-mono font-semibold text-slate-900">
                              {c.codePreview ?? `${c.codeHash.slice(0, 8)}…`}
                            </td>
                            <td className="px-4 py-3 text-slate-700">{c.societyName}</td>
                            <td className="px-4 py-3 font-mono tabular-nums text-slate-700">
                              {c.usedCount} / {c.maxUses}
                            </td>
                            <td className="px-4 py-3 text-slate-500 tabular-nums">
                              {c.expiresAt ? formatTimestamp(c.expiresAt) : 'No expiry'}
                            </td>
                            <td className="px-4 py-3 font-medium">
                              <span
                                className={
                                  c.status === 'active'
                                    ? 'text-emerald-700'
                                    : c.status === 'revoked'
                                      ? 'text-red-700'
                                      : 'text-slate-600'
                                }
                              >
                                {c.status}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right space-x-2 whitespace-nowrap">
                              {c.status === 'active' ? (
                                <button
                                  onClick={() => handleInvitationStatusChange(c, 'inactive')}
                                  className="text-slate-700 font-semibold hover:underline"
                                >
                                  Pause
                                </button>
                              ) : null}
                              {c.status === 'inactive' ? (
                                <button
                                  onClick={() => handleInvitationStatusChange(c, 'active')}
                                  className="text-[#0F3D2E] font-semibold hover:underline"
                                >
                                  Activate
                                </button>
                              ) : null}
                              {c.status !== 'revoked' ? (
                                <button
                                  onClick={() => handleInvitationStatusChange(c, 'revoked')}
                                  className="text-red-700 font-semibold hover:underline"
                                >
                                  Revoke
                                </button>
                              ) : null}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            ) : null}

            {(societySubmodule === 'pending_verifications' ||
              societySubmodule === 'approved_residents' ||
              societySubmodule === 'rejected_applications' ||
              societySubmodule === 'suspended_memberships') ? (
              <div className="space-y-4">
                <div className="flex flex-wrap gap-3">
                  <div className="relative flex-1 min-w-[220px] max-w-sm">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      value={customerSearch}
                      onChange={(e) => {
                        setCustomerSearch(e.target.value);
                        setResidentPage(1);
                      }}
                      placeholder="Search name, phone, flat..."
                      className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-slate-200 rounded-xl"
                    />
                  </div>
                  <select
                    value={residentSocietyFilter}
                    onChange={(e) => {
                      setResidentSocietyFilter(e.target.value);
                      setResidentPage(1);
                    }}
                    className="px-3 py-2 text-sm bg-white border border-slate-200 rounded-xl"
                  >
                    <option value="all">All Societies</option>
                    {scopedSocieties.map((s) => (
                      <option key={s.societyId} value={s.societyId}>
                        {s.societyName}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                  {renderVerificationTable(paginatedMembers)}
                </div>

                {totalResidentPages > 1 ? (
                  <div className="flex items-center justify-between text-xs text-slate-600">
                    <span>
                      Page {residentPage} of {totalResidentPages} ({filteredMembersQueue.length} records)
                    </span>
                    <div className="flex gap-2">
                      <button
                        disabled={residentPage <= 1}
                        onClick={() => setResidentPage((p) => Math.max(1, p - 1))}
                        className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white disabled:opacity-40"
                      >
                        Previous
                      </button>
                      <button
                        disabled={residentPage >= totalResidentPages}
                        onClick={() => setResidentPage((p) => Math.min(totalResidentPages, p + 1))}
                        className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white disabled:opacity-40"
                      >
                        Next
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {/* MODULE 3: CUSTOMER MANAGEMENT (Full Filterable Verification + Directory) */}
        {activeModule === 'customers' ? (
          <div className="mt-6 space-y-6">
            <div className="bg-white border border-slate-200 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
              <div className="relative lg:col-span-2">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  value={customerSearch}
                  onChange={(e) => {
                    setCustomerSearch(e.target.value);
                    setResidentPage(1);
                  }}
                  placeholder="Search name, phone, email, flat..."
                  className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-slate-200 rounded-xl"
                />
              </div>
              <select
                value={residentSocietyFilter}
                onChange={(e) => {
                  setResidentSocietyFilter(e.target.value);
                  setResidentPage(1);
                }}
                className="px-3 py-2 text-sm bg-white border border-slate-200 rounded-xl"
              >
                <option value="all">All Societies</option>
                {scopedSocieties.map((s) => (
                  <option key={s.societyId} value={s.societyId}>
                    {s.societyName}
                  </option>
                ))}
              </select>
              <input
                value={residentTowerFilter}
                onChange={(e) => {
                  setResidentTowerFilter(e.target.value);
                  setResidentPage(1);
                }}
                placeholder="Filter Tower..."
                className="px-3 py-2 text-sm bg-white border border-slate-200 rounded-xl"
              />
              <select
                value={residentStatusFilter}
                onChange={(e) => {
                  setResidentStatusFilter(
                    e.target.value as 'all' | 'pending' | 'approved' | 'rejected' | 'suspended'
                  );
                  setResidentPage(1);
                }}
                className="px-3 py-2 text-sm bg-white border border-slate-200 rounded-xl"
              >
                <option value="all">All Verification Statuses</option>
                <option value="pending">Pending</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
                <option value="suspended">Suspended</option>
              </select>
              <div className="flex gap-1.5">
                <input
                  type="date"
                  value={residentDateFrom}
                  onChange={(e) => {
                    setResidentDateFrom(e.target.value);
                    setResidentPage(1);
                  }}
                  className="w-1/2 px-2 py-2 text-xs bg-white border border-slate-200 rounded-xl"
                  title="Submitted from date"
                />
                <input
                  type="date"
                  value={residentDateTo}
                  onChange={(e) => {
                    setResidentDateTo(e.target.value);
                    setResidentPage(1);
                  }}
                  className="w-1/2 px-2 py-2 text-xs bg-white border border-slate-200 rounded-xl"
                  title="Submitted to date"
                />
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
                <div className="text-sm font-bold text-slate-900">
                  Society Memberships &amp; Verification Queue ({filteredMembersQueue.length})
                </div>
                {totalResidentPages > 1 ? (
                  <div className="flex items-center gap-2 text-xs text-slate-600">
                    <span>
                      Page {residentPage} / {totalResidentPages}
                    </span>
                    <button
                      disabled={residentPage <= 1}
                      onClick={() => setResidentPage((p) => Math.max(1, p - 1))}
                      className="px-2.5 py-1 rounded border border-slate-200 disabled:opacity-40"
                    >
                      Prev
                    </button>
                    <button
                      disabled={residentPage >= totalResidentPages}
                      onClick={() => setResidentPage((p) => Math.min(totalResidentPages, p + 1))}
                      className="px-2.5 py-1 rounded border border-slate-200 disabled:opacity-40"
                    >
                      Next
                    </button>
                  </div>
                ) : null}
              </div>
              {renderVerificationTable(paginatedMembers)}
            </div>

            <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
              <div className="px-5 py-3.5 border-b border-slate-200 text-sm font-bold text-slate-900">
                All Authenticated Accounts ({filteredUsers.length})
              </div>
              {filteredUsers.length === 0 ? (
                <div className="p-8 text-sm text-slate-500">No customers registered yet.</div>
              ) : (
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-xs text-slate-500 border-b border-slate-200">
                    <tr>
                      <th className="px-5 py-3">Name</th>
                      <th className="px-5 py-3">Contact</th>
                      <th className="px-5 py-3">Society / Flat</th>
                      <th className="px-5 py-3">Membership</th>
                      <th className="px-5 py-3">Account</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredUsers.map((u) => (
                      <tr key={u.uid}>
                        <td className="px-5 py-3 font-semibold text-slate-900">
                          {u.fullName || u.name}
                        </td>
                        <td className="px-5 py-3 font-mono text-xs text-slate-600">
                          {u.phoneNumber || u.email || u.uid}
                        </td>
                        <td className="px-5 py-3 text-slate-600">
                          {u.societyId
                            ? `${societyNameMap[u.societyId]?.societyName ?? u.societyId} · ${u.tower ?? ''} ${u.flatNumber || u.flatId || ''}`
                            : 'Not Submitted'}
                        </td>
                        <td className="px-5 py-3 text-slate-700">{u.membershipStatus}</td>
                        <td className="px-5 py-3 text-slate-700">{u.accountStatus}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        ) : null}

        {/* MODULE 4: BULK VENDOR OFFERS */}
        {activeModule === 'bulk_offers' ? (
          <div className="mt-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
            <form
              onSubmit={handleCreateBulkOffer}
              className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5 space-y-3 h-fit"
            >
              <h2 className="text-sm font-bold text-slate-900">Publish Society Bulk Vendor Offer</h2>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Target Society</label>
                <select
                  value={selectedSocietyId}
                  onChange={(e) => setSelectedSocietyId(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl bg-white"
                >
                  {scopedSocieties.map((s) => (
                    <option key={s.societyId} value={s.societyId}>
                      {s.societyName}
                    </option>
                  ))}
                </select>
              </div>
              <input
                required
                value={newBulk.title}
                onChange={(e) => setNewBulk({ ...newBulk, title: e.target.value })}
                placeholder="Offer Title (e.g. Split AC Servicing)"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl"
              />
              <div className="grid grid-cols-2 gap-3">
                <input
                  type="number"
                  value={newBulk.regularPriceRupees}
                  onChange={(e) => setNewBulk({ ...newBulk, regularPriceRupees: e.target.value })}
                  placeholder="Regular Price (₹)"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl"
                />
                <input
                  type="number"
                  value={newBulk.offerPriceRupees}
                  onChange={(e) => setNewBulk({ ...newBulk, offerPriceRupees: e.target.value })}
                  placeholder="Offer Price (₹)"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <input
                  type="number"
                  value={newBulk.minimumTarget}
                  onChange={(e) => setNewBulk({ ...newBulk, minimumTarget: e.target.value })}
                  placeholder="Min Flats Target"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl"
                />
                <input
                  type="date"
                  value={newBulk.scheduledDate}
                  onChange={(e) => setNewBulk({ ...newBulk, scheduledDate: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl"
                />
              </div>
              <button
                type="submit"
                disabled={!selectedSocietyId}
                className="w-full py-2.5 px-4 rounded-xl bg-[#0F3D2E] text-white text-sm font-semibold"
              >
                Publish Bulk Offer
              </button>
            </form>

            <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-slate-200 text-sm font-bold text-slate-900">
                Active Offers in Selected Society ({bulkCampaigns.length})
              </div>
              {bulkCampaigns.length === 0 ? (
                <div className="p-6 text-sm text-slate-500">No bulk offers in this society yet.</div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {bulkCampaigns.map((c) => (
                    <div key={c.campaignId} className="p-4 flex justify-between items-center">
                      <div>
                        <div className="text-sm font-semibold text-slate-900">{c.title}</div>
                        <div className="text-xs text-slate-500 font-mono tabular-nums">
                          {formatINRFromPaise(c.offerPricePaise)} (was {formatINRFromPaise(c.regularPricePaise)}) · Target {c.minimumTarget}
                        </div>
                      </div>
                      <span className="text-xs font-medium text-[#0F3D2E]">{c.status}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : null}

        {/* MODULE 5: GROUP BUYING */}
        {activeModule === 'group_buying' ? (
          <div className="mt-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
            <form
              onSubmit={handleCreateGroupOffer}
              className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5 space-y-3 h-fit"
            >
              <h2 className="text-sm font-bold text-slate-900">Publish Group Buying Batch</h2>
              <select
                value={selectedSocietyId}
                onChange={(e) => setSelectedSocietyId(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl bg-white"
              >
                {scopedSocieties.map((s) => (
                  <option key={s.societyId} value={s.societyId}>
                    {s.societyName}
                  </option>
                ))}
              </select>
              <input
                required
                value={newGroup.title}
                onChange={(e) => setNewGroup({ ...newGroup, title: e.target.value })}
                placeholder="Product Batch Title"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl"
              />
              <div className="grid grid-cols-2 gap-3">
                <input
                  type="number"
                  value={newGroup.marketPriceRupees}
                  onChange={(e) => setNewGroup({ ...newGroup, marketPriceRupees: e.target.value })}
                  placeholder="Market Price (₹)"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl"
                />
                <input
                  type="number"
                  value={newGroup.groupPriceRupees}
                  onChange={(e) => setNewGroup({ ...newGroup, groupPriceRupees: e.target.value })}
                  placeholder="Group Price (₹)"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl"
                />
              </div>
              <button
                type="submit"
                disabled={!selectedSocietyId}
                className="w-full py-2.5 px-4 rounded-xl bg-[#0F3D2E] text-white text-sm font-semibold"
              >
                Publish Group Batch
              </button>
            </form>

            <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-slate-200 text-sm font-bold text-slate-900">
                Group Batches in Selected Society ({groupCampaigns.length})
              </div>
              {groupCampaigns.length === 0 ? (
                <div className="p-6 text-sm text-slate-500">No group buying batches in this society yet.</div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {groupCampaigns.map((g) => (
                    <div key={g.campaignId} className="p-4 flex justify-between items-center">
                      <div>
                        <div className="text-sm font-semibold text-slate-900">{g.title}</div>
                        <div className="text-xs text-slate-500 font-mono tabular-nums">
                          {formatINRFromPaise(g.groupPricePaise)} · Min Qty {g.minimumGroupQuantity}
                        </div>
                      </div>
                      <span className="text-xs font-medium text-[#0F3D2E]">{g.status}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : null}

        {/* MODULE 6: BUY NOW PRODUCTS */}
        {activeModule === 'products' ? (
          <div className="mt-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
            <form
              onSubmit={handleCreateProduct}
              className="lg:col-span-4 bg-white border border-slate-200 rounded-xl p-5 space-y-3 h-fit"
            >
              <h2 className="text-sm font-bold text-slate-900">Add Buy Now Product</h2>
              <input
                required
                value={newProduct.title}
                onChange={(e) => setNewProduct({ ...newProduct, title: e.target.value })}
                placeholder="Product Name"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl"
              />
              <input
                value={newProduct.unitLabel}
                onChange={(e) => setNewProduct({ ...newProduct, unitLabel: e.target.value })}
                placeholder="Unit (e.g. 1 kg pack)"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl"
              />
              <div className="grid grid-cols-2 gap-3">
                <input
                  type="number"
                  value={newProduct.mrpRupees}
                  onChange={(e) => setNewProduct({ ...newProduct, mrpRupees: e.target.value })}
                  placeholder="MRP (₹)"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl"
                />
                <input
                  type="number"
                  value={newProduct.priceRupees}
                  onChange={(e) => setNewProduct({ ...newProduct, priceRupees: e.target.value })}
                  placeholder="Price (₹)"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl"
                />
              </div>
              <button
                type="submit"
                className="w-full py-2.5 px-4 rounded-xl bg-[#0F3D2E] text-white text-sm font-semibold"
              >
                Save Product
              </button>
            </form>

            <div className="lg:col-span-8 bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-slate-200 text-sm font-bold text-slate-900">
                Catalog Products ({products.length})
              </div>
              {products.length === 0 ? (
                <div className="p-6 text-sm text-slate-500">No products in Firestore yet.</div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {products.map((p) => (
                    <div key={p.productId} className="p-4 flex justify-between items-center">
                      <div>
                        <div className="text-sm font-semibold text-slate-900">{p.title}</div>
                        <div className="text-xs text-slate-500">
                          {p.category} · {p.unitLabel}
                        </div>
                      </div>
                      <div className="text-sm font-mono font-bold text-[#0F3D2E] tabular-nums">
                        {formatINRFromPaise(p.pricePaise)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : null}

        {/* MODULE 7: SERVICES */}
        {activeModule === 'services' ? (
          <div className="mt-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
            <form
              onSubmit={handleCreateService}
              className="lg:col-span-4 bg-white border border-slate-200 rounded-xl p-5 space-y-3 h-fit"
            >
              <h2 className="text-sm font-bold text-slate-900">Add Home Service</h2>
              <input
                required
                value={newService.title}
                onChange={(e) => setNewService({ ...newService, title: e.target.value })}
                placeholder="Service Title"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl"
              />
              <select
                value={newService.category}
                onChange={(e) => setNewService({ ...newService, category: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl bg-white"
              >
                {SERVICE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <input
                type="number"
                value={newService.startingPriceRupees}
                onChange={(e) => setNewService({ ...newService, startingPriceRupees: e.target.value })}
                placeholder="Starting Price (₹)"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl"
              />
              <button
                type="submit"
                className="w-full py-2.5 px-4 rounded-xl bg-[#0F3D2E] text-white text-sm font-semibold"
              >
                Save Service
              </button>
            </form>

            <div className="lg:col-span-8 bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-slate-200 text-sm font-bold text-slate-900">
                Services Catalog ({services.length})
              </div>
              {services.length === 0 ? (
                <div className="p-6 text-sm text-slate-500">No services in Firestore yet.</div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {services.map((s) => (
                    <div key={s.serviceId} className="p-4 flex justify-between items-center">
                      <div>
                        <div className="text-sm font-semibold text-slate-900">{s.title}</div>
                        <div className="text-xs text-slate-500">{s.category}</div>
                      </div>
                      <div className="text-sm font-mono font-bold text-[#0F3D2E] tabular-nums">
                        {formatINRFromPaise(s.startingPricePaise)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : null}

        {/* MODULE 9: ORDERS */}
        {activeModule === 'orders' ? (
          <div className="mt-6 bg-white border border-slate-200 rounded-xl overflow-x-auto">
            {orders.length === 0 ? (
              <div className="p-8 text-sm text-slate-500">No resident orders placed yet.</div>
            ) : (
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500 border-b border-slate-200">
                  <tr>
                    <th className="px-5 py-3">Order ID</th>
                    <th className="px-5 py-3">Society / Flat</th>
                    <th className="px-5 py-3">Amount</th>
                    <th className="px-5 py-3">Payment Status</th>
                    <th className="px-5 py-3">Order Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {orders.map((ord) => (
                    <tr key={ord.orderId}>
                      <td className="px-5 py-3 font-mono text-xs">{ord.orderId}</td>
                      <td className="px-5 py-3 text-slate-700">
                        {ord.societyId} · {ord.tower} {ord.flatId}
                      </td>
                      <td className="px-5 py-3 font-mono tabular-nums">
                        {formatINRFromPaise(ord.totalAmountPaise)}
                      </td>
                      <td className="px-5 py-3 text-xs text-amber-700">{ord.paymentStatus}</td>
                      <td className="px-5 py-3 text-xs font-semibold text-slate-900">
                        {ord.orderStatus}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ) : null}

        {/* MODULE 14 & 15: STAFF & ROLES */}
        {activeModule === 'staff' ? (
          <div className="mt-6 bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex justify-between items-center">
              <div className="text-sm font-bold text-slate-900">Authorized Staff Directory</div>
              <div className="text-xs text-slate-500">
                Bootstrapped Super Admin active via verified email claim
              </div>
            </div>
            {staffList.length === 0 ? (
              <div className="p-6 text-sm text-slate-500">
                No additional staff records created yet. Use scripts/bootstrap-admin.ts or define roles first.
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {staffList.map((st) => (
                  <div key={st.staffId} className="p-4 flex justify-between items-center">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">{st.name}</div>
                      <div className="text-xs text-slate-500 font-mono">
                        {st.email} · role: {st.roleId}
                        {st.assignedSocietyIds?.length ? ` · societies: ${st.assignedSocietyIds.join(', ')}` : ' · global scope'}
                      </div>
                    </div>
                    <span className="text-xs font-medium text-emerald-700">{st.status}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}

        {activeModule === 'roles' ? (
          <div className="mt-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
            <form
              onSubmit={handleCreateRole}
              className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5 space-y-3 h-fit"
            >
              <h2 className="text-sm font-bold text-slate-900">Define Granular RBAC Role</h2>
              <input
                required
                value={newRole.roleId}
                onChange={(e) => setNewRole({ ...newRole, roleId: e.target.value })}
                placeholder="Role ID (e.g. verification_officer)"
                className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-xl"
              />
              <input
                required
                value={newRole.name}
                onChange={(e) => setNewRole({ ...newRole, name: e.target.value })}
                placeholder="Display Name"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl"
              />
              <div className="max-h-52 overflow-y-auto border border-slate-200 rounded-xl p-3 space-y-1.5">
                {PERMISSION_KEYS.map((perm) => (
                  <label key={perm} className="flex items-center gap-2 text-xs text-slate-700">
                    <input
                      type="checkbox"
                      checked={newRole.permissions.includes(perm)}
                      onChange={(e) => {
                        setNewRole((prev) => ({
                          ...prev,
                          permissions: e.target.checked
                            ? [...prev.permissions, perm]
                            : prev.permissions.filter((p) => p !== perm),
                        }));
                      }}
                    />
                    <span className="font-mono">{perm}</span>
                  </label>
                ))}
              </div>
              <button
                type="submit"
                className="w-full py-2.5 px-4 rounded-xl bg-[#0F3D2E] text-white text-sm font-semibold"
              >
                Save Role Definition
              </button>
            </form>

            <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-slate-200 text-sm font-bold text-slate-900">
                Active Roles ({roles.length})
              </div>
              {roles.length === 0 ? (
                <div className="p-6 text-sm text-slate-500">No custom roles created yet.</div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {roles.map((r) => (
                    <div key={r.roleId} className="p-4">
                      <div className="text-sm font-bold text-slate-900">
                        {r.name} <span className="font-mono text-xs text-slate-500">({r.roleId})</span>
                      </div>
                      <div className="mt-1 text-xs font-mono text-slate-600">
                        {r.permissions.join(', ')}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : null}

        {/* MODULE 20: AUDIT LOGS */}
        {activeModule === 'audit_logs' ? (
          <div className="mt-6 bg-white border border-slate-200 rounded-xl overflow-x-auto">
            {auditLogs.length === 0 ? (
              <div className="p-8 text-sm text-slate-500">No audit events recorded yet.</div>
            ) : (
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500 border-b border-slate-200">
                  <tr>
                    <th className="px-5 py-3">Date</th>
                    <th className="px-5 py-3">Action</th>
                    <th className="px-5 py-3">Actor</th>
                    <th className="px-5 py-3">Target</th>
                    <th className="px-5 py-3">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {auditLogs.map((log) => (
                    <tr key={log.logId}>
                      <td className="px-5 py-3 text-xs text-slate-500 tabular-nums whitespace-nowrap">
                        {formatTimestamp(log.createdAt)}
                      </td>
                      <td className="px-5 py-3 font-mono text-xs text-[#0F3D2E]">{log.action}</td>
                      <td className="px-5 py-3 text-slate-700">{log.actorEmail || log.actorUid}</td>
                      <td className="px-5 py-3 font-mono text-xs text-slate-600">
                        {log.targetCollection}/{log.targetId}
                      </td>
                      <td className="px-5 py-3 text-slate-600">{log.details}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ) : null}

        {/* PHASE 3 PLANNED MODULES (HONEST PLACEHOLDERS) */}
        {activeModuleMeta.phase === 2 ? (
          <div className="mt-6 bg-white border border-slate-200 rounded-xl p-8 max-w-2xl">
            <div className="text-xs font-semibold text-amber-700">Scheduled Next Phase</div>
            <h2 className="mt-2 text-xl font-bold text-slate-900">{activeModuleMeta.label}</h2>
            <p className="mt-2 text-sm text-slate-600 leading-relaxed">
              This module is architected in the Firestore security rules and data blueprint, and is scheduled for upcoming workflow activation. No simulated metrics or stubbed transactions are displayed.
            </p>
          </div>
        ) : null}
      </div>

      {/* Inspect Full Resident Verification & History Modal */}
      {inspectMember ? (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="max-w-xl w-full bg-white rounded-2xl p-6 border border-slate-200 space-y-4 max-h-[85vh] overflow-y-auto">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-xs font-semibold text-[#0F3D2E]">
                  Resident Verification Profile
                </div>
                <h3 className="text-lg font-bold text-slate-900">{inspectMember.residentName}</h3>
              </div>
              <button onClick={() => setInspectMember(null)}>
                <X className="w-5 h-5 text-slate-500" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs bg-slate-50 p-4 rounded-xl border border-slate-200">
              <div>
                <span className="text-slate-500">Society:</span>{' '}
                <span className="font-semibold text-slate-900">
                  {societyNameMap[inspectMember.societyId]?.societyName ?? inspectMember.societyId}
                </span>
              </div>
              <div>
                <span className="text-slate-500">Tower &amp; Flat:</span>{' '}
                <span className="font-semibold text-slate-900">
                  {inspectMember.tower} · {inspectMember.flatNumber || inspectMember.flatId}
                </span>
              </div>
              <div>
                <span className="text-slate-500">Resident Type:</span>{' '}
                <span className="font-semibold text-slate-900">
                  {inspectMember.residentType ?? 'Owner'}
                </span>
              </div>
              <div>
                <span className="text-slate-500">Mobile:</span>{' '}
                <span className="font-mono text-slate-900">
                  {inspectMember.phoneNumber || '—'}
                </span>
              </div>
              <div>
                <span className="text-slate-500">Email:</span>{' '}
                <span className="font-mono text-slate-900">{inspectMember.email || '—'}</span>
              </div>
              <div>
                <span className="text-slate-500">Alt Contact:</span>{' '}
                <span className="font-mono text-slate-900">
                  {inspectMember.alternateContact || '—'}
                </span>
              </div>
              <div>
                <span className="text-slate-500">Address Confirmed:</span>{' '}
                <span className="text-slate-900">
                  {inspectMember.addressConfirmed ? 'Confirmed by Resident' : 'Yes (Legacy)'}
                </span>
              </div>
              <div>
                <span className="text-slate-500">Status:</span>{' '}
                <span className="font-semibold text-slate-900">
                  {inspectMember.verificationStatus}
                </span>
              </div>
            </div>

            {inspectMember.infoRequestNote ? (
              <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900">
                <span className="font-semibold">Latest Info Request:</span> {inspectMember.infoRequestNote}
              </div>
            ) : null}

            {inspectMember.rejectionReason ? (
              <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-800">
                <span className="font-semibold">Rejection Reason:</span> {inspectMember.rejectionReason}
              </div>
            ) : null}

            {inspectMember.suspensionReason ? (
              <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-800">
                <span className="font-semibold">Suspension Reason:</span> {inspectMember.suspensionReason}
              </div>
            ) : null}

            <div>
              <h4 className="text-xs font-bold text-slate-700 mb-2">Verification Audit Timeline</h4>
              {inspectHistory.length === 0 ? (
                <div className="text-xs text-slate-500">No verification history entries recorded yet.</div>
              ) : (
                <div className="space-y-2">
                  {inspectHistory.map((h) => (
                    <div key={h.historyId} className="p-3 rounded-xl border border-slate-200 text-xs">
                      <div className="flex justify-between">
                        <span className="font-semibold text-slate-900">{h.action}</span>
                        <span className="text-slate-500 tabular-nums">{formatTimestamp(h.createdAt)}</span>
                      </div>
                      <div className="mt-1 text-slate-600">{h.note || `Status → ${h.newStatus}`}</div>
                      <div className="mt-0.5 text-[11px] font-mono text-slate-400">
                        Actor: {h.actorEmail || h.actorUid}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {/* Admin Verification Decision Modal */}
      {actionDialog ? (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <form
            onSubmit={handleExecuteMemberAction}
            className="max-w-md w-full bg-white rounded-2xl p-6 border border-slate-200 space-y-4"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {actionDialog.type === 'approve' ? (
                  <Check className="w-4 h-4 text-[#0F3D2E]" />
                ) : actionDialog.type === 'info' ? (
                  <MessageSquareMore className="w-4 h-4 text-amber-700" />
                ) : actionDialog.type === 'reactivate' ? (
                  <RotateCcw className="w-4 h-4 text-[#0F3D2E]" />
                ) : (
                  <Ban className="w-4 h-4 text-red-700" />
                )}
                <h3 className="text-base font-bold text-slate-900">
                  {actionDialog.type === 'approve'
                    ? 'Approve Society Membership'
                    : actionDialog.type === 'reject'
                      ? 'Reject Verification Application'
                      : actionDialog.type === 'info'
                        ? 'Request Additional Information'
                        : actionDialog.type === 'suspend'
                          ? 'Suspend Resident Membership'
                          : 'Reactivate Resident Account'}
                </h3>
              </div>
              <button type="button" onClick={() => setActionDialog(null)}>
                <X className="w-5 h-5 text-slate-500" />
              </button>
            </div>

            <div className="text-xs text-slate-600 bg-slate-50 p-3 rounded-xl border border-slate-200">
              <div className="font-semibold text-slate-900">{actionDialog.member.residentName}</div>
              <div className="mt-0.5">
                {societyNameMap[actionDialog.member.societyId]?.societyName ?? actionDialog.member.societyId} · {actionDialog.member.tower} / {actionDialog.member.flatNumber || actionDialog.member.flatId}
              </div>
            </div>

            {actionDialog.type === 'reject' ||
            actionDialog.type === 'info' ||
            actionDialog.type === 'suspend' ? (
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  {actionDialog.type === 'reject'
                    ? 'Rejection Reason (visible to resident)'
                    : actionDialog.type === 'info'
                      ? 'Information Requested (visible on pending screen)'
                      : 'Suspension Reason (visible on blocked screen)'}
                </label>
                <textarea
                  required
                  rows={3}
                  value={actionReason}
                  onChange={(e) => setActionReason(e.target.value)}
                  placeholder="Enter a clear, specific note (5–240 characters)..."
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl"
                />
              </div>
            ) : (
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Optional Audit Note
                </label>
                <input
                  value={actionReason}
                  onChange={(e) => setActionReason(e.target.value)}
                  placeholder={
                    actionDialog.type === 'approve'
                      ? 'Flat occupancy verified with society office'
                      : 'Resident cleared for marketplace reactivation'
                  }
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl"
                />
              </div>
            )}

            {actionError ? <div className="text-xs text-red-600">{actionError}</div> : null}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setActionDialog(null)}
                className="px-4 py-2 rounded-xl border border-slate-300 text-xs font-semibold text-slate-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={actionBusy}
                className={`px-4 py-2 rounded-xl text-xs font-semibold text-white ${
                  actionDialog.type === 'reject' || actionDialog.type === 'suspend'
                    ? 'bg-red-700 hover:bg-red-800'
                    : 'bg-[#0F3D2E] hover:bg-[#0B2E22]'
                }`}
              >
                {actionBusy ? 'Saving...' : 'Confirm Action'}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {/* Add Society Modal */}
      {showNewSocietyModal ? (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <form
            onSubmit={handleCreateSociety}
            className="max-w-lg w-full bg-white rounded-2xl p-6 border border-slate-200 space-y-3"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-900">Register Residential Society</h3>
              <button type="button" onClick={() => setShowNewSocietyModal(false)}>
                <X className="w-5 h-5 text-slate-500" />
              </button>
            </div>
            <input
              required
              value={newSoc.societyName}
              onChange={(e) => setNewSoc({ ...newSoc, societyName: e.target.value })}
              placeholder="Society Name (e.g. Prestige Shantiniketan)"
              className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-xl"
            />
            <input
              required
              value={newSoc.address}
              onChange={(e) => setNewSoc({ ...newSoc, address: e.target.value })}
              placeholder="Street Address"
              className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-xl"
            />
            <div className="grid grid-cols-3 gap-2">
              <input
                required
                value={newSoc.city}
                onChange={(e) => setNewSoc({ ...newSoc, city: e.target.value })}
                placeholder="City"
                className="px-3 py-2 text-sm border border-slate-300 rounded-xl"
              />
              <input
                required
                value={newSoc.state}
                onChange={(e) => setNewSoc({ ...newSoc, state: e.target.value })}
                placeholder="State"
                className="px-3 py-2 text-sm border border-slate-300 rounded-xl"
              />
              <input
                required
                maxLength={6}
                value={newSoc.pincode}
                onChange={(e) => setNewSoc({ ...newSoc, pincode: e.target.value })}
                placeholder="Pincode"
                className="px-3 py-2 text-sm font-mono border border-slate-300 rounded-xl"
              />
            </div>
            <input
              required
              value={newSoc.invitationCode}
              onChange={(e) =>
                setNewSoc({ ...newSoc, invitationCode: e.target.value.toUpperCase() })
              }
              placeholder="Invitation Code (e.g. PRESTIGE26)"
              className="w-full px-3.5 py-2 text-sm font-mono uppercase border border-slate-300 rounded-xl"
            />
            {newSocError ? <div className="text-xs text-red-600">{newSocError}</div> : null}
            <button
              type="submit"
              className="w-full py-2.5 px-4 rounded-xl bg-[#0F3D2E] text-white text-sm font-semibold"
            >
              Create Society &amp; Hash Invitation Code
            </button>
          </form>
        </div>
      ) : null}

      {/* Explicit Demo Catalog Confirmation Dialog */}
      {showDemoSeedConfirm ? (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-white rounded-2xl p-6 border border-slate-200">
            <h3 className="text-base font-bold text-slate-900">
              Insert Labelled [DEMO] Catalog Records?
            </h3>
            <p className="mt-2 text-sm text-slate-600 leading-relaxed">
              This explicitly inserts a clearly labelled <span className="font-mono">[DEMO]</span> residential society (invitation code <span className="font-mono font-semibold">PALMDEMO26</span> with SHA-256 lookup), demo flats, sample bulk &amp; group campaigns, products, and all 8 service categories into Cloud Firestore so you can test end-to-end flows immediately.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setShowDemoSeedConfirm(false)}
                className="px-4 py-2 rounded-xl border border-slate-300 text-xs font-semibold text-slate-700"
              >
                Cancel
              </button>
              <button
                onClick={handleInsertLabelledDemoCatalog}
                disabled={seedingDemo}
                className="px-4 py-2 rounded-xl bg-[#0F3D2E] text-white text-xs font-semibold"
              >
                {seedingDemo ? 'Inserting...' : 'Confirm & Insert Demo Records'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
