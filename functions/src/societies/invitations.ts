import crypto from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import {
  adminDb,
  checkRateLimit,
  requireAuth,
  requireStaffPermission,
  sha256Hex,
} from '../security/authz';
import { writeAuditLog } from '../audit/auditLogger';

function generateCryptographicInviteCode(prefix = 'GG'): string {
  const randomChars = crypto
    .randomBytes(5)
    .toString('base64url')
    .replace(/[^A-Z0-9]/gi, '')
    .toUpperCase()
    .slice(0, 8);
  return `${prefix.replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 4)}-${randomChars}`;
}

export const createInvitationCode = onCall(async (request) => {
  const societyId = String(request.data?.societyId || '').trim();
  const caller = await requireStaffPermission(request, 'invitation.create', societyId);

  if (!societyId) {
    throw new HttpsError('invalid-argument', 'societyId is required.');
  }

  const societySnap = await adminDb.collection('societies').doc(societyId).get();
  if (!societySnap.exists) {
    throw new HttpsError('not-found', 'Target society does not exist.');
  }

  const society = societySnap.data()!;
  const maxUses = Number.isInteger(request.data?.maxUses)
    ? Math.min(10000, Math.max(1, Number(request.data.maxUses)))
    : 500;
  const expiresAt =
    typeof request.data?.expiresAt === 'string' && request.data.expiresAt.trim().length > 0
      ? request.data.expiresAt.trim()
      : '';

  if (expiresAt) {
    const expiryMs = Date.parse(expiresAt);
    if (Number.isNaN(expiryMs) || expiryMs <= Date.now()) {
      throw new HttpsError('invalid-argument', 'expiresAt must be a valid future ISO date.');
    }
  }

  const rawCustom = typeof request.data?.customCode === 'string' ? request.data.customCode.trim().toUpperCase() : '';
  const plaintextCode =
    rawCustom.length >= 4 && /^[A-Z0-9_-]{4,32}$/.test(rawCustom)
      ? rawCustom
      : generateCryptographicInviteCode(society.societyName.slice(0, 3));

  const codeHash = sha256Hex(plaintextCode);
  const existingHash = await adminDb
    .collection('invitationCodes')
    .where('codeHash', '==', codeHash)
    .limit(1)
    .get();
  if (!existingHash.empty) {
    throw new HttpsError('already-exists', 'An active or historical invitation code with this value already exists.');
  }

  const codeRef = adminDb.collection('invitationCodes').doc();
  const lookupRef = adminDb.collection('invitationLookups').doc(codeHash);

  const batch = adminDb.batch();
  batch.set(codeRef, {
    codeId: codeRef.id,
    societyId,
    societyName: society.societyName,
    city: society.city,
    codeHash,
    codePreview: `${plaintextCode.slice(0, 3)}***${plaintextCode.slice(-2)}`,
    status: 'active',
    expiresAt,
    maxUses,
    usedCount: 0,
    createdBy: caller.uid,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  batch.set(lookupRef, {
    codeId: codeRef.id,
    societyId,
    societyName: society.societyName,
    city: society.city,
    status: 'active',
    expiresAt,
    maxUses,
    usedCount: 0,
  });

  await batch.commit();

  await writeAuditLog({
    actorUid: caller.uid,
    actorEmail: caller.email,
    actorRole: caller.roleId,
    action: 'CREATE_INVITATION_CODE',
    targetCollection: 'invitationCodes',
    targetId: codeRef.id,
    resourceType: 'invitationCode',
    resourceId: codeRef.id,
    societyId,
    status: 'success',
    details: `Generated hashed invitation code (${plaintextCode.slice(0, 3)}***) with maxUses=${maxUses}`,
  });

  // Plaintext code is returned ONCE upon creation so admins can distribute it safely.
  return {
    codeId: codeRef.id,
    plaintextCode,
    codePreview: `${plaintextCode.slice(0, 3)}***${plaintextCode.slice(-2)}`,
    societyId,
    maxUses,
    expiresAt,
  };
});

export const validateInvitationCode = onCall(async (request) => {
  const caller = requireAuth(request);
  await checkRateLimit(`invite_validate_${caller.uid}`, 10, 300);

  const rawCode = String(request.data?.invitationCode || request.data?.code || '').trim().toUpperCase();
  if (!rawCode || rawCode.length < 4 || rawCode.length > 32 || !/^[A-Z0-9_-]+$/.test(rawCode)) {
    throw new HttpsError('invalid-argument', 'Enter a valid 4–32 character invitation code.');
  }

  const codeHash = sha256Hex(rawCode);
  const hashedQuery = await adminDb
    .collection('invitationCodes')
    .where('codeHash', '==', codeHash)
    .limit(1)
    .get();

  let societyId = '';
  let societyName = '';
  let city = '';
  let codeId = '';

  if (!hashedQuery.empty) {
    const rec = hashedQuery.docs[0].data();
    codeId = String(rec.codeId);
    societyId = String(rec.societyId);
    societyName = String(rec.societyName);
    city = String(rec.city);

    if (rec.status !== 'active') {
      throw new HttpsError('failed-precondition', `Invitation code is ${rec.status}.`);
    }
    if (rec.expiresAt && Date.parse(String(rec.expiresAt)) <= Date.now()) {
      throw new HttpsError('failed-precondition', 'This invitation code has expired.');
    }
    if (typeof rec.maxUses === 'number' && typeof rec.usedCount === 'number' && rec.usedCount >= rec.maxUses) {
      throw new HttpsError('resource-exhausted', 'This invitation code has reached its usage limit.');
    }
  } else {
    // Fallback to legacy Phase 1 invitation collection
    const legacySnap = await adminDb.collection('invitations').doc(rawCode).get();
    if (!legacySnap.exists || legacySnap.data()?.active !== true) {
      await writeAuditLog({
        actorUid: caller.uid,
        action: 'VALIDATE_INVITATION_FAILED',
        targetCollection: 'invitationCodes',
        targetId: codeHash.slice(0, 16),
        status: 'denied',
        reason: 'Invalid or inactive invitation code',
      });
      throw new HttpsError('not-found', 'Society invitation code is invalid or inactive.');
    }
    const legacy = legacySnap.data()!;
    societyId = String(legacy.societyId);
    societyName = String(legacy.societyName);
    city = String(legacy.city);
  }

  const societySnap = await adminDb.collection('societies').doc(societyId).get();
  if (!societySnap.exists || societySnap.data()?.status !== 'active') {
    throw new HttpsError('failed-precondition', 'Target society is currently inactive.');
  }

  return {
    valid: true,
    codeId,
    societyId,
    societyName: societySnap.data()!.societyName || societyName,
    city: societySnap.data()!.city || city,
    address: societySnap.data()!.address || '',
    towers: Array.isArray(societySnap.data()!.towers) ? societySnap.data()!.towers : [],
  };
});

export const revokeInvitationCode = onCall(async (request) => {
  const codeId = String(request.data?.codeId || '').trim();
  const nextStatus =
    request.data?.status === 'active' || request.data?.status === 'inactive' || request.data?.status === 'revoked'
      ? request.data.status
      : 'revoked';

  if (!codeId) {
    throw new HttpsError('invalid-argument', 'codeId is required.');
  }

  const codeRef = adminDb.collection('invitationCodes').doc(codeId);
  const snap = await codeRef.get();
  if (!snap.exists) {
    throw new HttpsError('not-found', 'Invitation code record not found.');
  }

  const rec = snap.data()!;
  const caller = await requireStaffPermission(request, 'invitation.revoke', String(rec.societyId));

  const batch = adminDb.batch();
  batch.update(codeRef, {
    status: nextStatus,
    updatedAt: FieldValue.serverTimestamp(),
  });
  if (rec.codeHash) {
    batch.update(adminDb.collection('invitationLookups').doc(String(rec.codeHash)), {
      status: nextStatus,
    });
  }
  await batch.commit();

  await writeAuditLog({
    actorUid: caller.uid,
    actorEmail: caller.email,
    actorRole: caller.roleId,
    action: nextStatus === 'revoked' ? 'REVOKE_INVITATION_CODE' : 'UPDATE_INVITATION_CODE_STATUS',
    targetCollection: 'invitationCodes',
    targetId: codeId,
    resourceType: 'invitationCode',
    resourceId: codeId,
    societyId: String(rec.societyId),
    status: 'success',
    details: `Updated invitation code ${codeId} status to ${nextStatus}`,
  });

  return { codeId, status: nextStatus };
});
