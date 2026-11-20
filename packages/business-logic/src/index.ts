import { PERMISSION_EQUIVALENTS } from '@society-marketplace/constants';
import type { AuthLifecycleState, UserProfile } from '@society-marketplace/shared-types';

/**
 * Formats integer paise to Indian Rupee (INR) display string (e.g., ₹499 or ₹1,250.50).
 * Using integer paise avoids IEEE-754 floating-point currency rounding bugs.
 */
export function formatINRFromPaise(paise: number): string {
  const safePaise = Number.isFinite(paise) ? Math.round(paise) : 0;
  const rupees = safePaise / 100;
  const hasFraction = safePaise % 100 !== 0;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: hasFraction ? 2 : 0,
  }).format(rupees);
}

export function calculateSavingsPaise(regularPaise: number, offerPaise: number): number {
  return Math.max(0, Math.round(regularPaise) - Math.round(offerPaise));
}

export function calculateSavingsPercent(regularPaise: number, offerPaise: number): number {
  if (regularPaise <= 0 || offerPaise >= regularPaise) return 0;
  return Math.round(((regularPaise - offerPaise) / regularPaise) * 100);
}

export function calculateTargetProgress(currentCount: number, minimumTarget: number): number {
  if (minimumTarget <= 0) return 0;
  return Math.min(100, Math.round((currentCount / minimumTarget) * 100));
}

export function resolveAuthLifecycleState(
  isAuthenticated: boolean,
  profile: UserProfile | null
): AuthLifecycleState {
  if (!isAuthenticated) {
    return 'unauthenticated';
  }
  if (!profile) {
    return 'otp_verified';
  }
  if (
    profile.accountStatus === 'suspended' ||
    profile.accountStatus === 'blocked' ||
    profile.membershipStatus === 'suspended'
  ) {
    return 'account_suspended';
  }
  switch (profile.membershipStatus) {
    case 'approved':
      if (!profile.societyId) return 'otp_verified';
      return profile.approvalAcknowledged === false
        ? 'verification_approved'
        : 'society_verified';
    case 'pending':
      return 'verification_pending';
    case 'rejected':
      return 'verification_rejected';
    case 'not_submitted':
    case 'unverified':
    default:
      return 'otp_verified';
  }
}

export function hasGranularPermission(
  grantedPermissions: string[],
  requiredPermission: string
): boolean {
  if (grantedPermissions.includes('*')) return true;
  if (grantedPermissions.includes(requiredPermission)) return true;
  const aliases = PERMISSION_EQUIVALENTS[requiredPermission] ?? [];
  return aliases.some((alias) => grantedPermissions.includes(alias));
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

export async function sha256HexBrowser(rawInput: string): Promise<string> {
  const normalized = rawInput.trim().toUpperCase();
  const encoder = new TextEncoder();
  const data = encoder.encode(normalized);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function formatReadableDate(isoOrDateString: string): string {
  const parsed = new Date(isoOrDateString);
  if (Number.isNaN(parsed.getTime())) {
    return isoOrDateString;
  }
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(parsed);
}
