import { BLUEPRINT_LIMITS } from '@society-marketplace/constants';
import type { ResidentType } from '@society-marketplace/shared-types';

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export function sanitizeText(value: string, maxLength: number): string {
  return value.trim().slice(0, maxLength);
}

export function normalizeIndianPhone(raw: string): string {
  const cleaned = raw.replace(/[\s\-()]/g, '');
  if (/^[6-9]\d{9}$/.test(cleaned)) {
    return `+91${cleaned}`;
  }
  if (/^91[6-9]\d{9}$/.test(cleaned)) {
    return `+${cleaned}`;
  }
  return cleaned;
}

export function validateId(id: string, label = 'ID'): ValidationResult {
  if (!id || id.length > BLUEPRINT_LIMITS.ID_MAX || !BLUEPRINT_LIMITS.ID_PATTERN.test(id)) {
    return { valid: false, error: `${label} must be 1–128 alphanumeric, underscore, or hyphen characters.` };
  }
  return { valid: true };
}

export function validateIndianPhone(phone: string): ValidationResult {
  const normalized = normalizeIndianPhone(phone);
  if (!/^\+91[6-9]\d{9}$/.test(normalized)) {
    return { valid: false, error: 'Enter a valid Indian mobile number (+91 followed by 10 digits starting with 6–9).' };
  }
  return { valid: true };
}

export function validateEmailOptional(email: string): ValidationResult {
  const trimmed = email.trim();
  if (!trimmed) return { valid: true };
  if (trimmed.length > 160 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return { valid: false, error: 'Enter a valid email address.' };
  }
  return { valid: true };
}

export function validateInvitationCode(code: string): ValidationResult {
  const normalized = code.trim().toUpperCase();
  if (
    normalized.length < BLUEPRINT_LIMITS.INVITE_CODE_MIN ||
    normalized.length > BLUEPRINT_LIMITS.INVITE_CODE_MAX ||
    !BLUEPRINT_LIMITS.INVITE_PATTERN.test(normalized)
  ) {
    return { valid: false, error: 'Invitation code must be 4–32 uppercase alphanumeric, underscore, or hyphen characters.' };
  }
  return { valid: true };
}

export function validateSocietyVerificationInput(input: {
  residentName: string;
  tower: string;
  flatId: string;
  invitationCode: string;
  residentType?: ResidentType;
  email?: string;
  alternateContact?: string;
  addressConfirmed?: boolean;
}): ValidationResult {
  const name = input.residentName.trim();
  const tower = input.tower.trim();
  const flatId = input.flatId.trim();

  if (name.length < 2 || name.length > BLUEPRINT_LIMITS.NAME_MAX) {
    return { valid: false, error: 'Resident full name must be 2–100 characters.' };
  }
  if (tower.length < 1 || tower.length > BLUEPRINT_LIMITS.TOWER_MAX) {
    return { valid: false, error: 'Tower / Block is required (max 64 characters).' };
  }
  if (flatId.length < 1 || flatId.length > BLUEPRINT_LIMITS.FLAT_MAX) {
    return { valid: false, error: 'Flat / Unit number is required (max 64 characters).' };
  }
  if (input.residentType && input.residentType !== 'Owner' && input.residentType !== 'Tenant') {
    return { valid: false, error: 'Resident type must be Owner or Tenant.' };
  }
  if (input.email) {
    const emailCheck = validateEmailOptional(input.email);
    if (!emailCheck.valid) return emailCheck;
  }
  if (input.alternateContact && input.alternateContact.trim().length > 0) {
    const altCheck = validateIndianPhone(input.alternateContact);
    if (!altCheck.valid) {
      return { valid: false, error: 'Alternate contact must be a valid 10-digit Indian mobile number.' };
    }
  }
  if (input.addressConfirmed === false) {
    return { valid: false, error: 'Please confirm your tower, flat number, and society address before submitting.' };
  }
  return validateInvitationCode(input.invitationCode);
}

export function validateSocietyCreateInput(input: {
  societyName: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  invitationCode: string;
}): ValidationResult {
  if (input.societyName.trim().length < 2 || input.societyName.trim().length > 140) {
    return { valid: false, error: 'Society name must be 2–140 characters.' };
  }
  if (input.address.trim().length < 2 || input.address.trim().length > BLUEPRINT_LIMITS.ADDRESS_MAX) {
    return { valid: false, error: 'Address must be 2–300 characters.' };
  }
  if (input.city.trim().length < 2 || input.city.trim().length > 80) {
    return { valid: false, error: 'City must be 2–80 characters.' };
  }
  if (input.state.trim().length < 2 || input.state.trim().length > 80) {
    return { valid: false, error: 'State must be 2–80 characters.' };
  }
  if (!BLUEPRINT_LIMITS.PINCODE_PATTERN.test(input.pincode.trim())) {
    return { valid: false, error: 'Pincode must be a 6-digit Indian postal code.' };
  }
  return validateInvitationCode(input.invitationCode);
}

export function validateInvitationCreateInput(input: {
  societyId: string;
  maxUses: number;
  expiresAt?: string;
  customCode?: string;
}): ValidationResult {
  const idCheck = validateId(input.societyId, 'Society ID');
  if (!idCheck.valid) return idCheck;
  if (!Number.isInteger(input.maxUses) || input.maxUses < 1 || input.maxUses > 10000) {
    return { valid: false, error: 'Max uses must be an integer between 1 and 10,000.' };
  }
  if (input.expiresAt) {
    const parsed = Date.parse(input.expiresAt);
    if (Number.isNaN(parsed)) {
      return { valid: false, error: 'Expiration date is invalid.' };
    }
    if (parsed <= Date.now()) {
      return { valid: false, error: 'Expiration date must be in the future.' };
    }
  }
  if (input.customCode) {
    return validateInvitationCode(input.customCode);
  }
  return { valid: true };
}

export function validateFlatInput(input: {
  tower: string;
  flatNumber: string;
}): ValidationResult {
  if (input.tower.trim().length < 1 || input.tower.trim().length > BLUEPRINT_LIMITS.TOWER_MAX) {
    return { valid: false, error: 'Tower name must be 1–64 characters.' };
  }
  if (input.flatNumber.trim().length < 1 || input.flatNumber.trim().length > 32) {
    return { valid: false, error: 'Flat number must be 1–32 characters.' };
  }
  return { valid: true };
}

export function validateAdminReason(reason: string, actionLabel = 'action'): ValidationResult {
  const trimmed = reason.trim();
  if (trimmed.length < 5 || trimmed.length > 240) {
    return { valid: false, error: `Please provide a clear ${actionLabel} reason (5–240 characters).` };
  }
  return { valid: true };
}

export function validateServiceBookingInput(input: {
  serviceId: string;
  serviceAddress: string;
  preferredDate: string;
  timeSlot: string;
  problemDescription: string;
}): ValidationResult {
  if (!input.serviceId) {
    return { valid: false, error: 'Please select a valid service.' };
  }
  if (input.serviceAddress.trim().length < 4 || input.serviceAddress.trim().length > BLUEPRINT_LIMITS.ADDRESS_MAX) {
    return { valid: false, error: 'Service address must be 4–300 characters.' };
  }
  if (!input.preferredDate) {
    return { valid: false, error: 'Preferred service date is required.' };
  }
  if (!input.timeSlot) {
    return { valid: false, error: 'Preferred time slot is required.' };
  }
  if (input.problemDescription.trim().length < 5 || input.problemDescription.trim().length > BLUEPRINT_LIMITS.DESC_MAX) {
    return { valid: false, error: 'Problem description must be 5–1000 characters.' };
  }
  return { valid: true };
}
