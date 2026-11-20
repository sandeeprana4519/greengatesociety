import { FieldValue } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import {
  adminAuth,
  adminDb,
  checkRateLimit,
  claimIdempotencyKey,
  normalizeFlatDocId,
  requireAuth,
  requireStaffPermission,
  sha256Hex,
} from '../security/authz';
import { writeAuditLog } from '../audit/auditLogger';
import {
  notifyInfoRequested,
  notifyMembershipApproved,
  notifyMembershipReactivated,
  notifyMembershipRejected,
  notifyMembershipSubmitted,
  notifyMembershipSuspended,
} from '../notifications/notifications';
import { validateInvitationCode } from './invitations';

export { validateInvitationCode as validateSocietyInvitation };

async function appendVerificationHistory(params: {
  uid: string;
  societyId: string;
  flatId: string;
  tower: string;
  action:
    | 'submitted'
    | 'resubmitted'
    | 'approved'
    | 'rejected'
    | 'info_requested'
    | 'suspended'
    | 'reactivated'
    | 'society_change_requested';
  previousStatus?: string;
  newStatus: string;
  actorUid: string;
  actorEmail?: string;
  note?: string;
}) {
  const ref = adminDb
    .collection('societies')
    .doc(params.societyId)
    .collection('verificationHistory')
    .doc();
  await ref.set({
    historyId: ref.id,
    uid: params.uid,
    societyId: params.societyId,
    flatId: params.flatId,
    tower: params.tower,
    action: params.action,
    previousStatus: params.previousStatus ?? '',
    newStatus: params.newStatus,
    actorUid: params.actorUid,
    actorEmail: params.actorEmail ?? '',
    note: (params.note ?? '').slice(0, 300),
    createdAt: FieldValue.serverTimestamp(),
  });
}

export const submitSocietyVerification = onCall(async (request) => {
  const caller = requireAuth(request);
  await checkRateLimit(`submit_ver_${caller.uid}`, 6, 300);

  const invitationCode = String(request.data?.invitationCode || '').trim().toUpperCase();
  const tower = String(request.data?.tower || '').trim().slice(0, 64);
  const rawFlatNumber = String(request.data?.flatNumber || request.data?.flatId || '').trim().slice(0, 32);
  const flatDocId = normalizeFlatDocId(tower, rawFlatNumber);
  const residentName = String(request.data?.residentName || request.data?.fullName || '').trim().slice(0, 100);
  const residentType = request.data?.residentType === 'Tenant' ? 'Tenant' : 'Owner';
  const email = typeof request.data?.email === 'string' ? request.data.email.trim().slice(0, 160) : '';
  const alternateContact =
    typeof request.data?.alternateContact === 'string'
      ? request.data.alternateContact.replace(/\s+/g, '').slice(0, 20)
      : '';
  const addressConfirmed = request.data?.addressConfirmed !== false;
  const idempotencyKey =
    typeof request.data?.idempotencyKey === 'string' ? request.data.idempotencyKey : undefined;

  if (!invitationCode || !tower || !rawFlatNumber || residentName.length < 2) {
    throw new HttpsError(
      'invalid-argument',
      'invitationCode, tower, flatNumber, and residentName are required.'
    );
  }
  if (!addressConfirmed) {
    throw new HttpsError('invalid-argument', 'You must confirm your residential society and flat details.');
  }

  const acquired = await claimIdempotencyKey(idempotencyKey, caller.uid, 'submit_verification');
  if (!acquired) {
    return { status: 'pending', deduplicated: true };
  }

  // Resolve hashed invitation first, falling back to legacy Phase 1 collection
  const codeHash = sha256Hex(invitationCode);
  const hashedQuery = await adminDb
    .collection('invitationCodes')
    .where('codeHash', '==', codeHash)
    .limit(1)
    .get();

  let societyId = '';
  let societyName = '';
  let inviteCodeRef: FirebaseFirestore.DocumentReference | null = null;

  if (!hashedQuery.empty) {
    const rec = hashedQuery.docs[0].data();
    inviteCodeRef = hashedQuery.docs[0].ref;
    societyId = String(rec.societyId);
    societyName = String(rec.societyName);
    if (rec.status !== 'active') {
      throw new HttpsError('failed-precondition', `Invitation code is ${rec.status}.`);
    }
    if (rec.expiresAt && Date.parse(String(rec.expiresAt)) <= Date.now()) {
      throw new HttpsError('failed-precondition', 'Invitation code has expired.');
    }
    if (typeof rec.maxUses === 'number' && typeof rec.usedCount === 'number' && rec.usedCount >= rec.maxUses) {
      throw new HttpsError('resource-exhausted', 'Invitation code usage limit reached.');
    }
  } else {
    const legacySnap = await adminDb.collection('invitations').doc(invitationCode).get();
    if (!legacySnap.exists || legacySnap.data()?.active !== true) {
      throw new HttpsError('not-found', 'Invalid or inactive society invitation code.');
    }
    societyId = String(legacySnap.data()!.societyId);
    societyName = String(legacySnap.data()!.societyName);
  }

  const societySnap = await adminDb.collection('societies').doc(societyId).get();
  if (!societySnap.exists || societySnap.data()?.status !== 'active') {
    throw new HttpsError('failed-precondition', 'Target society is inactive.');
  }

  const userRef = adminDb.collection('users').doc(caller.uid);
  const memberRef = adminDb.collection('societies').doc(societyId).collection('members').doc(caller.uid);
  const flatRef = adminDb.collection('societies').doc(societyId).collection('flats').doc(flatDocId);

  let actionType: 'submitted' | 'resubmitted' = 'submitted';
  let prevStatus = 'not_submitted';

  await adminDb.runTransaction(async (tx) => {
    const [userSnap, flatSnap, memberSnap] = await Promise.all([
      tx.get(userRef),
      tx.get(flatRef),
      tx.get(memberRef),
    ]);

    if (userSnap.exists) {
      const u = userSnap.data()!;
      prevStatus = String(u.membershipStatus || 'not_submitted');
      if (u.accountStatus === 'suspended' || u.accountStatus === 'blocked') {
        throw new HttpsError('permission-denied', 'Suspended accounts cannot submit society verification.');
      }
      if (u.membershipStatus === 'approved') {
        throw new HttpsError(
          'failed-precondition',
          'Verified residents cannot change their society membership directly. Use society change request.'
        );
      }
      if (u.membershipStatus === 'rejected') {
        actionType = 'resubmitted';
      }
    }

    // Prevent duplicate primary resident registration for the exact same flat
    if (flatSnap.exists) {
      const f = flatSnap.data()!;
      if (
        f.primaryResidentUid &&
        f.primaryResidentUid !== caller.uid &&
        (f.status === 'Occupied' || f.status === 'Active' || f.status === 'Verification Pending')
      ) {
        throw new HttpsError(
          'already-exists',
          `Flat ${tower} · ${rawFlatNumber} already has an active or pending primary resident registration.`
        );
      }
    }

    if (inviteCodeRef) {
      const codeSnap = await tx.get(inviteCodeRef);
      const c = codeSnap.data();
      if (!c || c.status !== 'active' || (c.maxUses && c.usedCount >= c.maxUses)) {
        throw new HttpsError('failed-precondition', 'Invitation code is no longer valid.');
      }
      tx.update(inviteCodeRef, {
        usedCount: FieldValue.increment(1),
        updatedAt: FieldValue.serverTimestamp(),
      });
      if (c.codeHash) {
        tx.update(adminDb.collection('invitationLookups').doc(String(c.codeHash)), {
          usedCount: FieldValue.increment(1),
        });
      }
    }

    tx.set(
      flatRef,
      {
        flatId: flatDocId,
        societyId,
        tower,
        flatNumber: rawFlatNumber,
        occupied: false,
        status: 'Verification Pending',
        primaryResidentUid: caller.uid,
        residentType,
        createdAt: flatSnap.exists ? flatSnap.data()!.createdAt : FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    tx.set(
      userRef,
      {
        uid: caller.uid,
        name: residentName,
        fullName: residentName,
        phoneNumber: caller.phoneNumber ?? userSnap.data()?.phoneNumber ?? '',
        email: email || caller.email || userSnap.data()?.email || '',
        alternateContact,
        societyId,
        flatId: rawFlatNumber,
        flatNumber: rawFlatNumber,
        tower,
        residentType,
        addressConfirmed: true,
        accountType: userSnap.data()?.accountType ?? 'customer',
        membershipStatus: 'pending',
        accountStatus: 'active',
        rejectionReason: '',
        infoRequestNote: '',
        createdAt: userSnap.exists ? userSnap.data()!.createdAt : FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    tx.set(memberRef, {
      uid: caller.uid,
      societyId,
      flatId: rawFlatNumber,
      flatNumber: rawFlatNumber,
      tower,
      residentName,
      residentType,
      phoneNumber: caller.phoneNumber ?? userSnap.data()?.phoneNumber ?? '',
      email: email || caller.email || '',
      alternateContact,
      addressConfirmed: true,
      invitationCodeId: inviteCodeRef?.id ?? '',
      verificationStatus: 'pending',
      rejectionReason: '',
      infoRequestNote: '',
      createdAt: memberSnap.exists ? memberSnap.data()!.createdAt : FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });

  await Promise.all([
    appendVerificationHistory({
      uid: caller.uid,
      societyId,
      flatId: rawFlatNumber,
      tower,
      action: actionType,
      previousStatus: prevStatus,
      newStatus: 'pending',
      actorUid: caller.uid,
      note: `${residentType} verification submitted for ${tower} · ${rawFlatNumber}`,
    }),
    notifyMembershipSubmitted({
      uid: caller.uid,
      societyId,
      societyName,
      tower,
      flatNumber: rawFlatNumber,
      attemptStamp: idempotencyKey || String(Date.now()),
    }),
    writeAuditLog({
      actorUid: caller.uid,
      actorEmail: caller.email,
      actorRole: 'customer',
      action: actionType === 'resubmitted' ? 'RESUBMIT_SOCIETY_VERIFICATION' : 'SUBMIT_SOCIETY_VERIFICATION',
      targetCollection: `societies/${societyId}/members`,
      targetId: caller.uid,
      targetUid: caller.uid,
      resourceType: 'membership',
      resourceId: caller.uid,
      societyId,
      status: 'success',
      details: `Submitted ${tower} / ${rawFlatNumber} (${residentType}) for verification`,
    }),
  ]);

  return { status: 'pending', societyId, flatId: rawFlatNumber, tower };
});

export const approveMembership = onCall(async (request) => {
  const societyId = String(request.data?.societyId || '').trim();
  const targetUid = String(request.data?.uid || '').trim();
  const admin = await requireStaffPermission(request, 'customer.verify', societyId);

  if (!societyId || !targetUid) {
    throw new HttpsError('invalid-argument', 'societyId and uid are required.');
  }

  const societySnap = await adminDb.collection('societies').doc(societyId).get();
  const societyName = societySnap.exists ? String(societySnap.data()!.societyName) : societyId;

  const userRef = adminDb.collection('users').doc(targetUid);
  const memberRef = adminDb.collection('societies').doc(societyId).collection('members').doc(targetUid);

  let approvedTower = '';
  let approvedFlat = '';
  let prevStatus = 'pending';

  await adminDb.runTransaction(async (tx) => {
    const memberSnap = await tx.get(memberRef);
    if (!memberSnap.exists) {
      throw new HttpsError('not-found', 'Membership request does not exist.');
    }
    const member = memberSnap.data()!;
    prevStatus = String(member.verificationStatus || 'pending');
    approvedTower = String(member.tower || '');
    approvedFlat = String(member.flatNumber || member.flatId || '');

    // Idempotent check
    if (member.verificationStatus === 'approved') {
      return;
    }

    const flatDocId = normalizeFlatDocId(approvedTower, approvedFlat);
    const flatRef = adminDb.collection('societies').doc(societyId).collection('flats').doc(flatDocId);
    const flatSnap = await tx.get(flatRef);

    tx.update(memberRef, {
      verificationStatus: 'approved',
      rejectionReason: '',
      suspensionReason: '',
      verifiedBy: admin.uid,
      verifiedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    tx.update(userRef, {
      societyId,
      flatId: approvedFlat,
      flatNumber: approvedFlat,
      tower: approvedTower,
      membershipStatus: 'approved',
      accountStatus: 'active',
      rejectionReason: '',
      suspensionReason: '',
      verifiedBy: admin.uid,
      verifiedAt: FieldValue.serverTimestamp(),
      approvalAcknowledged: false,
      updatedAt: FieldValue.serverTimestamp(),
    });

    tx.set(
      flatRef,
      {
        flatId: flatDocId,
        societyId,
        tower: approvedTower,
        flatNumber: approvedFlat,
        occupied: true,
        status: 'Occupied',
        primaryResidentUid: targetUid,
        residentType: member.residentType || 'Owner',
        createdAt: flatSnap.exists ? flatSnap.data()!.createdAt : FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  });

  try {
    const authUser = await adminAuth.getUser(targetUid);
    await adminAuth.setCustomUserClaims(targetUid, {
      ...(authUser.customClaims ?? {}),
      societyId,
      membershipStatus: 'approved',
      role: 'customer',
    });
  } catch {
    // Non-fatal when Firestore membership doc is authoritative
  }

  await Promise.all([
    appendVerificationHistory({
      uid: targetUid,
      societyId,
      flatId: approvedFlat,
      tower: approvedTower,
      action: 'approved',
      previousStatus: prevStatus,
      newStatus: 'approved',
      actorUid: admin.uid,
      actorEmail: admin.email,
      note: 'Society membership approved by admin',
    }),
    notifyMembershipApproved({
      uid: targetUid,
      societyId,
      societyName,
      tower: approvedTower,
      flatNumber: approvedFlat,
    }),
    writeAuditLog({
      actorUid: admin.uid,
      actorEmail: admin.email,
      actorRole: admin.roleId,
      action: 'APPROVE_SOCIETY_MEMBERSHIP',
      targetCollection: `societies/${societyId}/members`,
      targetId: targetUid,
      targetUid,
      resourceType: 'membership',
      resourceId: targetUid,
      societyId,
      status: 'success',
      details: `Approved resident ${targetUid} (${approvedTower} · ${approvedFlat}) in society ${societyId}`,
    }),
  ]);

  return { approved: true, societyId, uid: targetUid };
});

export const approveSocietyMembership = approveMembership;

export const rejectMembership = onCall(async (request) => {
  const societyId = String(request.data?.societyId || '').trim();
  const targetUid = String(request.data?.uid || '').trim();
  const reason = String(request.data?.reason || '').trim().slice(0, 240);
  const admin = await requireStaffPermission(request, 'customer.reject', societyId);

  if (!societyId || !targetUid || reason.length < 5) {
    throw new HttpsError('invalid-argument', 'societyId, uid, and a rejection reason (min 5 chars) are required.');
  }

  const userRef = adminDb.collection('users').doc(targetUid);
  const memberRef = adminDb.collection('societies').doc(societyId).collection('members').doc(targetUid);

  let tower = '';
  let flatNumber = '';
  let prevStatus = 'pending';

  await adminDb.runTransaction(async (tx) => {
    const memberSnap = await tx.get(memberRef);
    if (!memberSnap.exists) {
      throw new HttpsError('not-found', 'Membership request does not exist.');
    }
    const member = memberSnap.data()!;
    prevStatus = String(member.verificationStatus || 'pending');
    tower = String(member.tower || '');
    flatNumber = String(member.flatNumber || member.flatId || '');

    const flatDocId = normalizeFlatDocId(tower, flatNumber);
    const flatRef = adminDb.collection('societies').doc(societyId).collection('flats').doc(flatDocId);
    const flatSnap = await tx.get(flatRef);

    tx.update(memberRef, {
      verificationStatus: 'rejected',
      rejectionReason: reason,
      verifiedBy: admin.uid,
      verifiedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    tx.update(userRef, {
      membershipStatus: 'rejected',
      rejectionReason: reason,
      verifiedBy: admin.uid,
      verifiedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    if (flatSnap.exists && flatSnap.data()?.primaryResidentUid === targetUid) {
      tx.update(flatRef, {
        occupied: false,
        status: 'Available',
        primaryResidentUid: '',
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
  });

  try {
    const authUser = await adminAuth.getUser(targetUid);
    await adminAuth.setCustomUserClaims(targetUid, {
      ...(authUser.customClaims ?? {}),
      societyId: null,
      membershipStatus: 'rejected',
    });
  } catch {
    // Non-fatal
  }

  const stamp = String(Date.now());
  await Promise.all([
    appendVerificationHistory({
      uid: targetUid,
      societyId,
      flatId: flatNumber,
      tower,
      action: 'rejected',
      previousStatus: prevStatus,
      newStatus: 'rejected',
      actorUid: admin.uid,
      actorEmail: admin.email,
      note: reason,
    }),
    notifyMembershipRejected({
      uid: targetUid,
      societyId,
      reason,
      timestampKey: stamp,
    }),
    writeAuditLog({
      actorUid: admin.uid,
      actorEmail: admin.email,
      actorRole: admin.roleId,
      action: 'REJECT_SOCIETY_MEMBERSHIP',
      targetCollection: `societies/${societyId}/members`,
      targetId: targetUid,
      targetUid,
      resourceType: 'membership',
      resourceId: targetUid,
      societyId,
      status: 'success',
      reason,
      details: `Rejected resident ${targetUid}: ${reason}`,
    }),
  ]);

  return { rejected: true, societyId, uid: targetUid };
});

export const rejectSocietyMembership = rejectMembership;

export const requestMoreVerificationInfo = onCall(async (request) => {
  const societyId = String(request.data?.societyId || '').trim();
  const targetUid = String(request.data?.uid || '').trim();
  const note = String(request.data?.note || '').trim().slice(0, 300);
  const admin = await requireStaffPermission(request, 'customer.verify', societyId);

  if (!societyId || !targetUid || note.length < 5) {
    throw new HttpsError('invalid-argument', 'societyId, uid, and note are required.');
  }

  const memberRef = adminDb.collection('societies').doc(societyId).collection('members').doc(targetUid);
  const userRef = adminDb.collection('users').doc(targetUid);
  const memberSnap = await memberRef.get();
  if (!memberSnap.exists) {
    throw new HttpsError('not-found', 'Membership record not found.');
  }

  const member = memberSnap.data()!;
  await Promise.all([
    memberRef.update({
      infoRequestNote: note,
      updatedAt: FieldValue.serverTimestamp(),
    }),
    userRef.update({
      infoRequestNote: note,
      updatedAt: FieldValue.serverTimestamp(),
    }),
    appendVerificationHistory({
      uid: targetUid,
      societyId,
      flatId: String(member.flatNumber || member.flatId || ''),
      tower: String(member.tower || ''),
      action: 'info_requested',
      previousStatus: String(member.verificationStatus),
      newStatus: String(member.verificationStatus),
      actorUid: admin.uid,
      actorEmail: admin.email,
      note,
    }),
    notifyInfoRequested({
      uid: targetUid,
      societyId,
      note,
      timestampKey: String(Date.now()),
    }),
    writeAuditLog({
      actorUid: admin.uid,
      actorEmail: admin.email,
      actorRole: admin.roleId,
      action: 'REQUEST_VERIFICATION_INFO',
      targetCollection: `societies/${societyId}/members`,
      targetId: targetUid,
      targetUid,
      resourceType: 'membership',
      resourceId: targetUid,
      societyId,
      status: 'success',
      reason: note,
      details: `Requested more info from ${targetUid}: ${note}`,
    }),
  ]);

  return { requested: true };
});

export const suspendMembership = onCall(async (request) => {
  const societyId = String(request.data?.societyId || '').trim();
  const targetUid = String(request.data?.uid || '').trim();
  const reason = String(request.data?.reason || '').trim().slice(0, 240);
  const admin = await requireStaffPermission(request, 'customer.suspend', societyId);

  if (!societyId || !targetUid || reason.length < 5) {
    throw new HttpsError('invalid-argument', 'societyId, uid, and suspension reason are required.');
  }

  const userRef = adminDb.collection('users').doc(targetUid);
  const memberRef = adminDb.collection('societies').doc(societyId).collection('members').doc(targetUid);

  let tower = '';
  let flatNumber = '';
  let prevStatus = 'approved';

  await adminDb.runTransaction(async (tx) => {
    const memberSnap = await tx.get(memberRef);
    if (!memberSnap.exists) {
      throw new HttpsError('not-found', 'Membership record does not exist.');
    }
    const member = memberSnap.data()!;
    prevStatus = String(member.verificationStatus || 'approved');
    tower = String(member.tower || '');
    flatNumber = String(member.flatNumber || member.flatId || '');

    const flatRef = adminDb
      .collection('societies')
      .doc(societyId)
      .collection('flats')
      .doc(normalizeFlatDocId(tower, flatNumber));
    const flatSnap = await tx.get(flatRef);

    tx.update(memberRef, {
      verificationStatus: 'suspended',
      suspensionReason: reason,
      verifiedBy: admin.uid,
      updatedAt: FieldValue.serverTimestamp(),
    });

    tx.update(userRef, {
      membershipStatus: 'suspended',
      accountStatus: 'suspended',
      suspensionReason: reason,
      updatedAt: FieldValue.serverTimestamp(),
    });

    if (flatSnap.exists) {
      tx.update(flatRef, {
        status: 'Suspended',
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
  });

  try {
    const authUser = await adminAuth.getUser(targetUid);
    await adminAuth.setCustomUserClaims(targetUid, {
      ...(authUser.customClaims ?? {}),
      membershipStatus: 'suspended',
      accountStatus: 'suspended',
    });
  } catch {
    // Non-fatal
  }

  await Promise.all([
    appendVerificationHistory({
      uid: targetUid,
      societyId,
      flatId: flatNumber,
      tower,
      action: 'suspended',
      previousStatus: prevStatus,
      newStatus: 'suspended',
      actorUid: admin.uid,
      actorEmail: admin.email,
      note: reason,
    }),
    notifyMembershipSuspended({
      uid: targetUid,
      societyId,
      reason,
      timestampKey: String(Date.now()),
    }),
    writeAuditLog({
      actorUid: admin.uid,
      actorEmail: admin.email,
      actorRole: admin.roleId,
      action: 'SUSPEND_SOCIETY_MEMBERSHIP',
      targetCollection: `societies/${societyId}/members`,
      targetId: targetUid,
      targetUid,
      resourceType: 'membership',
      resourceId: targetUid,
      societyId,
      status: 'success',
      reason,
      details: `Suspended resident ${targetUid}: ${reason}`,
    }),
  ]);

  return { suspended: true, societyId, uid: targetUid };
});

export const reactivateMembership = onCall(async (request) => {
  const societyId = String(request.data?.societyId || '').trim();
  const targetUid = String(request.data?.uid || '').trim();
  const admin = await requireStaffPermission(request, 'customer.suspend', societyId);

  if (!societyId || !targetUid) {
    throw new HttpsError('invalid-argument', 'societyId and uid are required.');
  }

  const societySnap = await adminDb.collection('societies').doc(societyId).get();
  const societyName = societySnap.exists ? String(societySnap.data()!.societyName) : societyId;

  const userRef = adminDb.collection('users').doc(targetUid);
  const memberRef = adminDb.collection('societies').doc(societyId).collection('members').doc(targetUid);

  let tower = '';
  let flatNumber = '';

  await adminDb.runTransaction(async (tx) => {
    const memberSnap = await tx.get(memberRef);
    if (!memberSnap.exists) {
      throw new HttpsError('not-found', 'Membership record does not exist.');
    }
    const member = memberSnap.data()!;
    tower = String(member.tower || '');
    flatNumber = String(member.flatNumber || member.flatId || '');

    const flatRef = adminDb
      .collection('societies')
      .doc(societyId)
      .collection('flats')
      .doc(normalizeFlatDocId(tower, flatNumber));
    const flatSnap = await tx.get(flatRef);

    tx.update(memberRef, {
      verificationStatus: 'approved',
      suspensionReason: '',
      verifiedBy: admin.uid,
      verifiedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    tx.update(userRef, {
      membershipStatus: 'approved',
      accountStatus: 'active',
      suspensionReason: '',
      updatedAt: FieldValue.serverTimestamp(),
    });

    if (flatSnap.exists) {
      tx.update(flatRef, {
        occupied: true,
        status: 'Occupied',
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
  });

  try {
    const authUser = await adminAuth.getUser(targetUid);
    await adminAuth.setCustomUserClaims(targetUid, {
      ...(authUser.customClaims ?? {}),
      societyId,
      membershipStatus: 'approved',
      accountStatus: 'active',
    });
  } catch {
    // Non-fatal
  }

  await Promise.all([
    appendVerificationHistory({
      uid: targetUid,
      societyId,
      flatId: flatNumber,
      tower,
      action: 'reactivated',
      previousStatus: 'suspended',
      newStatus: 'approved',
      actorUid: admin.uid,
      actorEmail: admin.email,
      note: 'Resident membership reactivated',
    }),
    notifyMembershipReactivated({
      uid: targetUid,
      societyId,
      societyName,
      timestampKey: String(Date.now()),
    }),
    writeAuditLog({
      actorUid: admin.uid,
      actorEmail: admin.email,
      actorRole: admin.roleId,
      action: 'REACTIVATE_SOCIETY_MEMBERSHIP',
      targetCollection: `societies/${societyId}/members`,
      targetId: targetUid,
      targetUid,
      resourceType: 'membership',
      resourceId: targetUid,
      societyId,
      status: 'success',
      details: `Reactivated resident ${targetUid} in ${societyId}`,
    }),
  ]);

  return { reactivated: true, societyId, uid: targetUid };
});

/**
 * Controlled society transfer: requires an approved resident to move back into
 * `pending` status and undergo admin re-verification in the new society/flat.
 */
export const changeResidentSociety = onCall(async (request) => {
  const caller = requireAuth(request);
  const newInvitationCode = String(request.data?.invitationCode || '').trim().toUpperCase();
  const newTower = String(request.data?.tower || '').trim().slice(0, 64);
  const newFlatNumber = String(request.data?.flatNumber || '').trim().slice(0, 32);
  const residentType = request.data?.residentType === 'Tenant' ? 'Tenant' : 'Owner';

  if (!newInvitationCode || !newTower || !newFlatNumber) {
    throw new HttpsError('invalid-argument', 'invitationCode, tower, and flatNumber are required.');
  }

  const userRef = adminDb.collection('users').doc(caller.uid);
  const userSnap = await userRef.get();
  if (!userSnap.exists) {
    throw new HttpsError('not-found', 'User profile not found.');
  }
  const user = userSnap.data()!;
  if (user.accountStatus === 'suspended' || user.accountStatus === 'blocked') {
    throw new HttpsError('permission-denied', 'Suspended accounts cannot change society.');
  }

  const oldSocietyId = String(user.societyId || '');
  const oldTower = String(user.tower || '');
  const oldFlat = String(user.flatNumber || user.flatId || '');

  // Validate new invitation code
  const codeHash = sha256Hex(newInvitationCode);
  const hashedQuery = await adminDb
    .collection('invitationCodes')
    .where('codeHash', '==', codeHash)
    .limit(1)
    .get();
  if (hashedQuery.empty || hashedQuery.docs[0].data().status !== 'active') {
    throw new HttpsError('not-found', 'Valid active invitation code is required to request society change.');
  }

  const targetSocietyId = String(hashedQuery.docs[0].data().societyId);
  const newFlatDocId = normalizeFlatDocId(newTower, newFlatNumber);

  await adminDb.runTransaction(async (tx) => {
    // Release old flat lock if transferring away
    if (oldSocietyId && oldTower && oldFlat) {
      const oldFlatRef = adminDb
        .collection('societies')
        .doc(oldSocietyId)
        .collection('flats')
        .doc(normalizeFlatDocId(oldTower, oldFlat));
      const oldFlatSnap = await tx.get(oldFlatRef);
      if (oldFlatSnap.exists && oldFlatSnap.data()?.primaryResidentUid === caller.uid) {
        tx.update(oldFlatRef, {
          occupied: false,
          status: 'Available',
          primaryResidentUid: '',
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
    }

    const newFlatRef = adminDb
      .collection('societies')
      .doc(targetSocietyId)
      .collection('flats')
      .doc(newFlatDocId);
    const newFlatSnap = await tx.get(newFlatRef);
    if (
      newFlatSnap.exists &&
      newFlatSnap.data()?.primaryResidentUid &&
      newFlatSnap.data()?.primaryResidentUid !== caller.uid &&
      newFlatSnap.data()?.status === 'Occupied'
    ) {
      throw new HttpsError('already-exists', 'Target flat is already occupied.');
    }

    tx.set(
      newFlatRef,
      {
        flatId: newFlatDocId,
        societyId: targetSocietyId,
        tower: newTower,
        flatNumber: newFlatNumber,
        occupied: false,
        status: 'Verification Pending',
        primaryResidentUid: caller.uid,
        residentType,
        createdAt: newFlatSnap.exists ? newFlatSnap.data()!.createdAt : FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    tx.update(userRef, {
      societyId: targetSocietyId,
      tower: newTower,
      flatId: newFlatNumber,
      flatNumber: newFlatNumber,
      residentType,
      membershipStatus: 'pending',
      approvalAcknowledged: false,
      updatedAt: FieldValue.serverTimestamp(),
    });

    tx.set(
      adminDb.collection('societies').doc(targetSocietyId).collection('members').doc(caller.uid),
      {
        uid: caller.uid,
        societyId: targetSocietyId,
        tower: newTower,
        flatId: newFlatNumber,
        flatNumber: newFlatNumber,
        residentName: user.fullName || user.name || 'Resident',
        residentType,
        phoneNumber: user.phoneNumber || caller.phoneNumber || '',
        verificationStatus: 'pending',
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }
    );
  });

  try {
    const authUser = await adminAuth.getUser(caller.uid);
    await adminAuth.setCustomUserClaims(caller.uid, {
      ...(authUser.customClaims ?? {}),
      societyId: null,
      membershipStatus: 'pending',
    });
  } catch {
    // Non-fatal
  }

  await Promise.all([
    appendVerificationHistory({
      uid: caller.uid,
      societyId: targetSocietyId,
      flatId: newFlatNumber,
      tower: newTower,
      action: 'society_change_requested',
      previousStatus: String(user.membershipStatus),
      newStatus: 'pending',
      actorUid: caller.uid,
      note: `Requested move from ${oldSocietyId || 'none'} (${oldFlat}) to ${targetSocietyId} (${newTower} · ${newFlatNumber})`,
    }),
    writeAuditLog({
      actorUid: caller.uid,
      actorRole: 'customer',
      action: 'CHANGE_RESIDENT_SOCIETY_REQUEST',
      targetCollection: `societies/${targetSocietyId}/members`,
      targetId: caller.uid,
      targetUid: caller.uid,
      societyId: targetSocietyId,
      status: 'success',
      details: `Moved back to pending for admin re-verification in ${targetSocietyId} (${newTower} · ${newFlatNumber})`,
    }),
  ]);

  return { status: 'pending', societyId: targetSocietyId };
});

export const getPendingVerifications = onCall(async (request) => {
  const societyId = typeof request.data?.societyId === 'string' ? request.data.societyId.trim() : undefined;
  await requireStaffPermission(request, 'customer.view', societyId);

  let q: FirebaseFirestore.Query = adminDb
    .collectionGroup('members')
    .where('verificationStatus', '==', 'pending');
  if (societyId) {
    q = q.where('societyId', '==', societyId);
  }
  const snap = await q.orderBy('createdAt', 'desc').limit(100).get();
  return { items: snap.docs.map((d) => d.data()) };
});

export const getApprovedResidents = onCall(async (request) => {
  const societyId = typeof request.data?.societyId === 'string' ? request.data.societyId.trim() : undefined;
  await requireStaffPermission(request, 'customer.view', societyId);

  let q: FirebaseFirestore.Query = adminDb
    .collectionGroup('members')
    .where('verificationStatus', '==', 'approved');
  if (societyId) {
    q = q.where('societyId', '==', societyId);
  }
  const snap = await q.orderBy('verifiedAt', 'desc').limit(100).get();
  return { items: snap.docs.map((d) => d.data()) };
});

export const getSocietyMembers = onCall(async (request) => {
  const societyId = String(request.data?.societyId || '').trim();
  if (!societyId) {
    throw new HttpsError('invalid-argument', 'societyId is required.');
  }
  await requireStaffPermission(request, 'customer.view', societyId);

  const statusFilter = typeof request.data?.status === 'string' ? request.data.status.trim() : '';
  let q: FirebaseFirestore.Query = adminDb
    .collection('societies')
    .doc(societyId)
    .collection('members');
  if (statusFilter) {
    q = q.where('verificationStatus', '==', statusFilter);
  }
  const snap = await q.orderBy('createdAt', 'desc').limit(200).get();
  return { items: snap.docs.map((d) => d.data()) };
});

export const getCustomerVerificationDetails = onCall(async (request) => {
  const societyId = String(request.data?.societyId || '').trim();
  const targetUid = String(request.data?.uid || '').trim();
  if (!societyId || !targetUid) {
    throw new HttpsError('invalid-argument', 'societyId and uid are required.');
  }
  await requireStaffPermission(request, 'customer.view', societyId);

  const [userSnap, memberSnap, historySnap] = await Promise.all([
    adminDb.collection('users').doc(targetUid).get(),
    adminDb.collection('societies').doc(societyId).collection('members').doc(targetUid).get(),
    adminDb
      .collection('societies')
      .doc(societyId)
      .collection('verificationHistory')
      .where('uid', '==', targetUid)
      .orderBy('createdAt', 'desc')
      .limit(30)
      .get(),
  ]);

  return {
    user: userSnap.exists ? userSnap.data() : null,
    member: memberSnap.exists ? memberSnap.data() : null,
    history: historySnap.docs.map((d) => d.data()),
  };
});
