import * as functionsV1 from 'firebase-functions/v1';
import { FieldValue } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { adminDb, requireAuth } from '../security/authz';
import { writeAuditLog } from '../audit/auditLogger';

/**
 * Auth creation trigger initializing a clean customer profile document
 * with unverified/not_submitted membership status and zero privileged fields.
 */
export const onUserCreated = functionsV1.auth.user().onCreate(async (user) => {
  const userRef = adminDb.collection('users').doc(user.uid);
  const snap = await userRef.get();
  if (snap.exists) return;

  const displayName = (user.displayName || 'Resident').trim().slice(0, 100);
  await userRef.set({
    uid: user.uid,
    name: displayName,
    fullName: displayName,
    phoneNumber: user.phoneNumber ?? '',
    email: user.email ?? '',
    accountType: 'customer',
    membershipStatus: 'not_submitted',
    accountStatus: 'active',
    preferredLocale: 'en',
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  await writeAuditLog({
    actorUid: user.uid,
    actorEmail: user.email ?? '',
    actorRole: 'customer',
    action: 'USER_AUTH_CREATED',
    targetCollection: 'users',
    targetId: user.uid,
    targetUid: user.uid,
    resourceType: 'user',
    resourceId: user.uid,
    status: 'success',
    details: 'Initialized customer profile upon Firebase Authentication sign-up',
  });
});

export const getCurrentUserProfile = onCall(async (request) => {
  const caller = requireAuth(request);
  const userSnap = await adminDb.collection('users').doc(caller.uid).get();
  if (!userSnap.exists) {
    return { profile: null };
  }
  return { profile: userSnap.data() };
});

/**
 * Strict allowlisted profile update endpoint:
 * customers can update display name, alternate contact, locale, or FCM token,
 * but can NEVER modify societyId, flatId, membershipStatus, accountStatus, or role.
 */
export const updateCustomerProfile = onCall(async (request) => {
  const caller = requireAuth(request);
  const userRef = adminDb.collection('users').doc(caller.uid);
  const userSnap = await userRef.get();

  if (!userSnap.exists) {
    throw new HttpsError('not-found', 'User profile not found.');
  }

  const current = userSnap.data()!;
  if (current.accountStatus === 'suspended' || current.accountStatus === 'blocked') {
    throw new HttpsError('permission-denied', 'Suspended accounts cannot modify profile data.');
  }

  const patch: Record<string, unknown> = {
    updatedAt: FieldValue.serverTimestamp(),
  };

  if (typeof request.data?.fullName === 'string') {
    const clean = request.data.fullName.trim().slice(0, 100);
    if (clean.length < 2) {
      throw new HttpsError('invalid-argument', 'Full name must be at least 2 characters.');
    }
    patch.fullName = clean;
    patch.name = clean;
  }

  if (typeof request.data?.email === 'string') {
    const cleanEmail = request.data.email.trim().slice(0, 160);
    if (cleanEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      throw new HttpsError('invalid-argument', 'Invalid email address format.');
    }
    patch.email = cleanEmail;
  }

  if (typeof request.data?.alternateContact === 'string') {
    const cleanAlt = request.data.alternateContact.replace(/\s+/g, '').slice(0, 20);
    if (cleanAlt && !/^\+91[6-9]\d{9}$/.test(cleanAlt)) {
      throw new HttpsError('invalid-argument', 'Alternate contact must be a valid +91 number.');
    }
    patch.alternateContact = cleanAlt;
  }

  if (request.data?.preferredLocale === 'en' || request.data?.preferredLocale === 'hi') {
    patch.preferredLocale = request.data.preferredLocale;
  }

  if (typeof request.data?.fcmToken === 'string') {
    patch.fcmToken = request.data.fcmToken.trim().slice(0, 512);
  }

  if (typeof request.data?.approvalAcknowledged === 'boolean') {
    patch.approvalAcknowledged = request.data.approvalAcknowledged;
  }

  await userRef.update(patch);
  return { updated: true };
});
