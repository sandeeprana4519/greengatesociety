import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { describe, it } from 'node:test';
import type { UserProfile } from '../packages/shared-types/src/index.ts';
import {
  hasGranularPermission,
  normalizeFlatDocId,
  resolveAuthLifecycleState,
  sha256HexBrowser,
} from '../packages/business-logic/src/index.ts';
import {
  normalizeIndianPhone,
  validateAdminReason,
  validateInvitationCreateInput,
  validateSocietyVerificationInput,
} from '../packages/validation/src/index.ts';

function makeProfile(overrides: Partial<UserProfile>): UserProfile {
  return {
    uid: 'uid_test_1',
    name: 'Test Resident',
    membershipStatus: 'not_submitted',
    accountStatus: 'active',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('Phase 2 Verification State Machine & Validation Logic', () => {
  it('resolves all auth lifecycle states deterministically', () => {
    assert.equal(resolveAuthLifecycleState(false, null), 'unauthenticated');
    assert.equal(resolveAuthLifecycleState(true, null), 'otp_verified');
    assert.equal(
      resolveAuthLifecycleState(true, makeProfile({ membershipStatus: 'not_submitted' })),
      'otp_verified'
    );
    assert.equal(
      resolveAuthLifecycleState(true, makeProfile({ membershipStatus: 'pending' })),
      'verification_pending'
    );
    assert.equal(
      resolveAuthLifecycleState(true, makeProfile({ membershipStatus: 'rejected' })),
      'verification_rejected'
    );
    assert.equal(
      resolveAuthLifecycleState(
        true,
        makeProfile({
          membershipStatus: 'approved',
          societyId: 'soc_1',
          approvalAcknowledged: false,
        })
      ),
      'verification_approved'
    );
    assert.equal(
      resolveAuthLifecycleState(
        true,
        makeProfile({
          membershipStatus: 'approved',
          societyId: 'soc_1',
          approvalAcknowledged: true,
        })
      ),
      'society_verified'
    );
    assert.equal(
      resolveAuthLifecycleState(
        true,
        makeProfile({ membershipStatus: 'approved', accountStatus: 'suspended' })
      ),
      'account_suspended'
    );
    assert.equal(
      resolveAuthLifecycleState(
        true,
        makeProfile({ membershipStatus: 'suspended', accountStatus: 'active' })
      ),
      'account_suspended'
    );
  });

  it('normalizes Indian mobile numbers cleanly', () => {
    assert.equal(normalizeIndianPhone('9876543210'), '+919876543210');
    assert.equal(normalizeIndianPhone('91 98765-43210'), '+919876543210');
    assert.equal(normalizeIndianPhone('+919876543210'), '+919876543210');
  });

  it('validates Phase 2 resident verification fields strictly', () => {
    assert.equal(
      validateSocietyVerificationInput({
        residentName: 'Ananya Rao',
        tower: 'Tower B',
        flatId: 'B-504',
        invitationCode: 'PALM2026',
        residentType: 'Owner',
        email: 'ananya@example.com',
        alternateContact: '9876543211',
        addressConfirmed: true,
      }).valid,
      true
    );

    assert.equal(
      validateSocietyVerificationInput({
        residentName: 'Ananya Rao',
        tower: 'Tower B',
        flatId: 'B-504',
        invitationCode: 'PALM2026',
        residentType: 'Owner',
        addressConfirmed: false,
      }).valid,
      false
    );
  });

  it('validates invitation creation and admin reasons', () => {
    assert.equal(
      validateInvitationCreateInput({
        societyId: 'soc_1',
        maxUses: 100,
        customCode: 'PALM-NEW-26',
      }).valid,
      true
    );
    assert.equal(
      validateInvitationCreateInput({
        societyId: 'soc_1',
        maxUses: 0,
      }).valid,
      false
    );
    assert.equal(validateAdminReason('Bad', 'rejection').valid, false);
    assert.equal(validateAdminReason('Flat number belongs to another resident', 'rejection').valid, true);
  });

  it('supports dual-format RBAC granular permissions and deterministic flat IDs', () => {
    assert.equal(hasGranularPermission(['customer.verify'], 'customers:write'), true);
    assert.equal(hasGranularPermission(['customers:write'], 'customer.reject'), true);
    assert.equal(hasGranularPermission(['customer.view'], 'customer.suspend'), false);
    assert.equal(hasGranularPermission(['*'], 'society.suspend'), true);

    assert.equal(normalizeFlatDocId('Tower A', 'A-402'), 'flat_tower_a_a_402');
  });

  it('produces identical SHA-256 digests in browser helper and Node crypto', async () => {
    const browserDigest = await sha256HexBrowser(' palmdemo26 ');
    const nodeDigest = crypto.createHash('sha256').update('PALMDEMO26').digest('hex');
    assert.equal(browserDigest, nodeDigest);
  });
});
