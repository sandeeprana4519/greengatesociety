import crypto from 'node:crypto';
import { getApps, getApp, initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';

const app = getApps().length ? getApp() : initializeApp();

const databaseId = process.env.FIREBASE_DATABASE_ID;
export const adminDb =
  databaseId && databaseId !== '(default)'
    ? getFirestore(app, databaseId)
    : getFirestore(app);

export const adminAuth = getAuth(app);

export const APP_CHECK_CONFIG = {
  enforceAppCheck: process.env.ENFORCE_APP_CHECK === 'true',
};

const PERMISSION_ALIASES: Record<string, string[]> = {
  'society.view': ['societies:read'],
  'society.create': ['societies:write'],
  'society.update': ['societies:write'],
  'society.suspend': ['societies:write'],
  'customer.view': ['customers:read'],
  'customer.verify': ['customers:write'],
  'customer.reject': ['customers:write'],
  'customer.suspend': ['customers:write'],
  'invitation.create': ['societies:write'],
  'invitation.revoke': ['societies:write'],
  'flat.manage': ['societies:write'],
  'campaign.manage': ['campaigns:write', 'campaigns:read'],
  'group.manage': ['campaigns:write', 'campaigns:read'],
  'order.manage': ['orders:write', 'orders:read'],
  'payment.view': ['payments:read'],
  'vendor.manage': ['vendors:write', 'vendors:read'],
  'report.view': ['audit:read'],
  'audit.view': ['audit:read'],
  'societies:read': ['society.view'],
  'societies:write': [
    'society.create',
    'society.update',
    'society.suspend',
    'invitation.create',
    'invitation.revoke',
    'flat.manage',
  ],
  'customers:read': ['customer.view'],
  'customers:write': ['customer.verify', 'customer.reject', 'customer.suspend'],
  'audit:read': ['audit.view'],
};

export interface VerifiedCaller {
  uid: string;
  email?: string;
  phoneNumber?: string;
  roleId?: string;
  permissions: string[];
  assignedSocietyIds?: string[];
  isSuperAdmin: boolean;
}

export function sha256Hex(raw: string): string {
  return crypto.createHash('sha256').update(raw.trim().toUpperCase()).digest('hex');
}

export function normalizeFlatDocId(tower: string, flatNumber: string): string {
  const cleanTower = tower
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  const cleanFlat = flatNumber
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `flat_${cleanTower || 'main'}_${cleanFlat || 'unit'}`.slice(0, 64);
}

export function hasPermissionMatch(granted: string[], required: string): boolean {
  if (granted.includes('*')) return true;
  if (granted.includes(required)) return true;
  const aliases = PERMISSION_ALIASES[required] ?? [];
  return aliases.some((a) => granted.includes(a));
}

export function requireAuth(request: CallableRequest<unknown>): {
  uid: string;
  email?: string;
  phoneNumber?: string;
} {
  if (APP_CHECK_CONFIG.enforceAppCheck && !request.app) {
    throw new HttpsError('failed-precondition', 'Firebase App Check verification failed.');
  }
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Authentication is required.');
  }
  const { uid, token } = request.auth;
  return {
    uid,
    email: typeof token.email === 'string' ? token.email : undefined,
    phoneNumber: typeof token.phone_number === 'string' ? token.phone_number : undefined,
  };
}

export async function requireStaffPermission(
  request: CallableRequest<unknown>,
  requiredPermission: string,
  targetSocietyId?: string
): Promise<VerifiedCaller> {
  const caller = requireAuth(request);

  if (
    request.auth?.token.email_verified === true &&
    caller.email === process.env.ADMIN_BOOTSTRAP_EMAIL
  ) {
    return {
      ...caller,
      roleId: 'super_admin',
      permissions: ['*'],
      isSuperAdmin: true,
    };
  }

  const staffSnap = await adminDb.collection('staff').doc(caller.uid).get();
  if (!staffSnap.exists) {
    throw new HttpsError('permission-denied', 'Staff profile does not exist.');
  }

  const staffData = staffSnap.data()!;
  if (staffData.status !== 'active') {
    throw new HttpsError('permission-denied', 'Staff account is suspended.');
  }

  const roleId = String(staffData.roleId || '');
  const roleSnap = await adminDb.collection('roles').doc(roleId).get();
  if (!roleSnap.exists) {
    throw new HttpsError('permission-denied', 'Assigned staff role does not exist.');
  }

  const permissions = Array.isArray(roleSnap.data()?.permissions)
    ? (roleSnap.data()!.permissions as string[])
    : [];

  const isSuperAdmin = permissions.includes('*') || request.auth?.token.role === 'super_admin';
  if (!isSuperAdmin && !hasPermissionMatch(permissions, requiredPermission)) {
    throw new HttpsError(
      'permission-denied',
      `Missing required permission: ${requiredPermission}`
    );
  }

  const assignedSocietyIds = Array.isArray(staffData.assignedSocietyIds)
    ? (staffData.assignedSocietyIds as string[])
    : [];

  if (
    !isSuperAdmin &&
    targetSocietyId &&
    assignedSocietyIds.length > 0 &&
    !assignedSocietyIds.includes(targetSocietyId)
  ) {
    throw new HttpsError(
      'permission-denied',
      'Staff member is not assigned to the requested society.'
    );
  }

  return {
    ...caller,
    roleId,
    permissions,
    assignedSocietyIds,
    isSuperAdmin,
  };
}

export async function verifyStaffPermission(
  request: CallableRequest<unknown>,
  requiredPermission: string,
  targetSocietyId?: string
): Promise<VerifiedCaller> {
  return requireStaffPermission(request, requiredPermission, targetSocietyId);
}

export async function verifyAdminRole(
  request: CallableRequest<unknown>
): Promise<VerifiedCaller> {
  return requireStaffPermission(request, '*');
}

export async function verifyUserMembership(
  request: CallableRequest<unknown>
): Promise<{
  uid: string;
  societyId: string;
  flatId: string;
  tower: string;
  name: string;
  membershipStatus: string;
  accountStatus: string;
}> {
  return requireVerifiedSocietyMember(request);
}

export async function verifySocietyAccess(
  request: CallableRequest<unknown>,
  requestedSocietyId: string
): Promise<{
  uid: string;
  societyId: string;
  flatId: string;
  tower: string;
  name: string;
}> {
  return requireVerifiedSocietyMember(request, requestedSocietyId);
}

export async function requireVerifiedSocietyMember(
  request: CallableRequest<unknown>,
  requestedSocietyId?: string
): Promise<{
  uid: string;
  societyId: string;
  flatId: string;
  tower: string;
  name: string;
  membershipStatus: string;
  accountStatus: string;
}> {
  const caller = requireAuth(request);
  const userSnap = await adminDb.collection('users').doc(caller.uid).get();
  if (!userSnap.exists) {
    throw new HttpsError('failed-precondition', 'Customer profile not initialized.');
  }
  const user = userSnap.data()!;
  if (user.accountStatus === 'suspended' || user.accountStatus === 'blocked') {
    throw new HttpsError('permission-denied', 'Account is suspended or blocked.');
  }
  if (user.membershipStatus !== 'approved' || !user.societyId) {
    throw new HttpsError('permission-denied', 'Society verification is not approved.');
  }
  if (requestedSocietyId && requestedSocietyId !== user.societyId) {
    throw new HttpsError('permission-denied', 'Cross-society access is strictly prohibited.');
  }

  const memberSnap = await adminDb
    .collection('societies')
    .doc(user.societyId)
    .collection('members')
    .doc(caller.uid)
    .get();

  if (!memberSnap.exists || memberSnap.data()?.verificationStatus !== 'approved') {
    throw new HttpsError('permission-denied', 'Society membership record is not active.');
  }

  return {
    uid: caller.uid,
    societyId: String(user.societyId),
    flatId: String(user.flatId || memberSnap.data()!.flatId),
    tower: String(user.tower || memberSnap.data()!.tower),
    name: String(user.fullName || user.name || 'Resident'),
    membershipStatus: String(user.membershipStatus),
    accountStatus: String(user.accountStatus),
  };
}

/**
 * Sliding-window Firestore rate limiter for abusive endpoint throttling.
 */
export async function checkRateLimit(
  bucketKey: string,
  maxRequests: number,
  windowSeconds: number
): Promise<void> {
  const safeId = bucketKey.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
  const ref = adminDb.collection('rateLimits').doc(safeId);
  const nowMs = Date.now();
  const windowMs = windowSeconds * 1000;

  await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data()! : null;
    const windowStartMs = typeof data?.windowStartMs === 'number' ? data.windowStartMs : 0;
    const count = typeof data?.count === 'number' ? data.count : 0;

    if (!data || nowMs - windowStartMs > windowMs) {
      tx.set(ref, {
        bucketKey: safeId,
        windowStartMs: nowMs,
        count: 1,
        updatedAt: FieldValue.serverTimestamp(),
      });
      return;
    }

    if (count >= maxRequests) {
      throw new HttpsError(
        'resource-exhausted',
        'Too many attempts detected. Please wait a few minutes and try again.'
      );
    }

    tx.update(ref, {
      count: count + 1,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
}

/**
 * Ensures idempotent execution for retry-safe Cloud Function mutations.
 */
export async function claimIdempotencyKey(
  key: string | undefined,
  actorUid: string,
  operation: string
): Promise<boolean> {
  if (!key) return true;
  const docRef = adminDb.collection('idempotencyKeys').doc(`${operation}_${actorUid}_${key}`);
  const acquired = await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(docRef);
    if (snap.exists) {
      return false;
    }
    tx.set(docRef, {
      actorUid,
      operation,
      createdAt: FieldValue.serverTimestamp(),
    });
    return true;
  });
  return acquired;
}
