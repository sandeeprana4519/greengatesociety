import { FieldValue } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { adminDb, requireAuth } from '../security/authz';

/**
 * Verifies that the authenticated Firebase Phone Auth session is initialized
 * in Firestore `users/{uid}` without ever trusting client-submitted roles or societyId.
 */
export const syncAuthenticatedUserProfile = onCall(async (request) => {
  const caller = requireAuth(request);
  const userRef = adminDb.collection('users').doc(caller.uid);

  const result = await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(userRef);
    if (snap.exists) {
      return snap.data()!;
    }

    const displayName =
      typeof request.data?.name === 'string' && request.data.name.trim().length > 0
        ? request.data.name.trim().slice(0, 100)
        : 'Resident';

    const initialProfile = {
      uid: caller.uid,
      name: displayName,
      fullName: displayName,
      phoneNumber: caller.phoneNumber ?? '',
      email: caller.email ?? '',
      accountType: 'customer',
      membershipStatus: 'not_submitted',
      accountStatus: 'active',
      preferredLocale: 'en',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };
    tx.set(userRef, initialProfile);
    return initialProfile;
  });

  return { profile: result };
});

export const verifyOtpSession = onCall(async (request) => {
  const caller = requireAuth(request);
  if (!caller.phoneNumber && !request.auth?.token.email_verified) {
    throw new HttpsError(
      'failed-precondition',
      'Phone OTP or verified email authentication is required.'
    );
  }
  return {
    verified: true,
    uid: caller.uid,
    phoneNumber: caller.phoneNumber ?? null,
  };
});
