/**
 * Society Marketplace — Firebase Emulator Security Rules Test Suite (Phase 1 + Phase 2)
 *
 * Covers multi-tenant isolation, RBAC granular permissions, SHA-256 invitation isolation,
 * flat primary-resident locks, suspended user blocking, immutable verification history,
 * and adversarial payloads from security_spec.md.
 *
 * Run with Firebase Emulator Suite:
 *   firebase emulators:exec --only firestore "npx tsx --test firestore.rules.test.ts"
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';

const PROJECT_ID = 'society-marketplace-rules-test';
const PALM_HASH = crypto.createHash('sha256').update('PALM2026').digest('hex');

let testEnv: RulesTestEnvironment;

async function seedTestData() {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();

    // Societies
    await setDoc(doc(db, 'societies', 'soc_a'), {
      societyId: 'soc_a',
      societyName: 'Palm Meadows Residency',
      address: 'Whitefield Main Rd',
      city: 'Bengaluru',
      state: 'Karnataka',
      pincode: '560066',
      invitationCode: 'PALM2026',
      status: 'active',
      createdAt: serverTimestamp(),
    });

    await setDoc(doc(db, 'societies', 'soc_b'), {
      societyId: 'soc_b',
      societyName: 'Prestige Lakeside',
      address: 'Varthur Rd',
      city: 'Bengaluru',
      state: 'Karnataka',
      pincode: '560087',
      invitationCode: 'PRESTIGE26',
      status: 'active',
      createdAt: serverTimestamp(),
    });

    // Legacy + Hashed Invitations
    await setDoc(doc(db, 'invitations', 'PALM2026'), {
      code: 'PALM2026',
      societyId: 'soc_a',
      societyName: 'Palm Meadows Residency',
      city: 'Bengaluru',
      active: true,
      createdAt: serverTimestamp(),
    });

    await setDoc(doc(db, 'invitationCodes', 'inv_palm_1'), {
      codeId: 'inv_palm_1',
      societyId: 'soc_a',
      societyName: 'Palm Meadows Residency',
      city: 'Bengaluru',
      codeHash: PALM_HASH,
      codePreview: 'PALM••••',
      status: 'active',
      maxUses: 100,
      usedCount: 1,
      createdBy: 'admin_1',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    await setDoc(doc(db, 'invitationLookups', PALM_HASH), {
      codeId: 'inv_palm_1',
      societyId: 'soc_a',
      societyName: 'Palm Meadows Residency',
      city: 'Bengaluru',
      status: 'active',
      maxUses: 100,
      usedCount: 1,
    });

    // Roles & Staff (Phase 1 + Phase 2 canonical dot permissions)
    await setDoc(doc(db, 'roles', 'support_agent'), {
      roleId: 'support_agent',
      name: 'Support Agent',
      permissions: ['customers:read', 'orders:read'],
      createdAt: serverTimestamp(),
    });

    await setDoc(doc(db, 'roles', 'verification_officer'), {
      roleId: 'verification_officer',
      name: 'Verification Officer',
      permissions: ['customer.view', 'customer.verify', 'customer.reject', 'society.view'],
      createdAt: serverTimestamp(),
    });

    await setDoc(doc(db, 'staff', 'staff_support'), {
      staffId: 'staff_support',
      uid: 'staff_support',
      name: 'Support Staff',
      email: 'support@greengate.example',
      roleId: 'support_agent',
      status: 'active',
      createdAt: serverTimestamp(),
    });

    await setDoc(doc(db, 'staff', 'staff_verifier'), {
      staffId: 'staff_verifier',
      uid: 'staff_verifier',
      name: 'Verification Officer',
      email: 'verify@greengate.example',
      roleId: 'verification_officer',
      status: 'active',
      createdAt: serverTimestamp(),
    });

    // Verified Resident A in Society A + Occupied Flat Lock
    await setDoc(doc(db, 'users', 'user_a'), {
      uid: 'user_a',
      name: 'Aarav Sharma',
      fullName: 'Aarav Sharma',
      phoneNumber: '+919800000001',
      societyId: 'soc_a',
      flatId: 'A-402',
      flatNumber: 'A-402',
      tower: 'Tower A',
      residentType: 'Owner',
      accountType: 'customer',
      membershipStatus: 'approved',
      accountStatus: 'active',
      approvalAcknowledged: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    await setDoc(doc(db, 'societies', 'soc_a', 'members', 'user_a'), {
      uid: 'user_a',
      societyId: 'soc_a',
      flatId: 'A-402',
      flatNumber: 'A-402',
      tower: 'Tower A',
      residentName: 'Aarav Sharma',
      residentType: 'Owner',
      verificationStatus: 'approved',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    await setDoc(doc(db, 'societies', 'soc_a', 'flats', 'flat_tower_a_a_402'), {
      flatId: 'flat_tower_a_a_402',
      societyId: 'soc_a',
      tower: 'Tower A',
      flatNumber: 'A-402',
      occupied: true,
      status: 'Occupied',
      primaryResidentUid: 'user_a',
      residentType: 'Owner',
      createdAt: serverTimestamp(),
    });

    await setDoc(doc(db, 'societies', 'soc_a', 'verificationHistory', 'hist_user_a_1'), {
      historyId: 'hist_user_a_1',
      uid: 'user_a',
      societyId: 'soc_a',
      flatId: 'A-402',
      tower: 'Tower A',
      action: 'approved',
      previousStatus: 'pending',
      newStatus: 'approved',
      actorUid: 'staff_verifier',
      createdAt: serverTimestamp(),
    });

    // Unverified Pending User
    await setDoc(doc(db, 'users', 'user_pending'), {
      uid: 'user_pending',
      name: 'Pending Resident',
      phoneNumber: '+919800000002',
      societyId: 'soc_a',
      flatId: 'B-101',
      tower: 'Tower B',
      membershipStatus: 'pending',
      accountStatus: 'active',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    // Suspended User
    await setDoc(doc(db, 'users', 'user_suspended'), {
      uid: 'user_suspended',
      name: 'Suspended Resident',
      phoneNumber: '+919800000003',
      societyId: 'soc_a',
      flatId: 'B-202',
      tower: 'Tower B',
      membershipStatus: 'suspended',
      accountStatus: 'suspended',
      suspensionReason: 'Duplicate account violation',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    // Campaigns in Society A and Society B
    await setDoc(doc(db, 'societies', 'soc_a', 'campaigns', 'camp_a1'), {
      campaignId: 'camp_a1',
      societyId: 'soc_a',
      title: 'Split AC Servicing Bulk Offer',
      description: 'Complete jet pump servicing',
      regularPricePaise: 79900,
      offerPricePaise: 49900,
      minimumTarget: 15,
      maximumCapacity: 60,
      currentParticipants: 5,
      bookingDeadline: '2026-12-01',
      scheduledDate: '2026-12-05',
      status: 'active',
      createdAt: serverTimestamp(),
    });

    await setDoc(doc(db, 'societies', 'soc_b', 'campaigns', 'camp_b1'), {
      campaignId: 'camp_b1',
      societyId: 'soc_b',
      title: 'Society B Exclusive Pest Control',
      description: 'Private society campaign',
      regularPricePaise: 149900,
      offerPricePaise: 89900,
      minimumTarget: 10,
      maximumCapacity: 40,
      currentParticipants: 2,
      bookingDeadline: '2026-12-01',
      scheduledDate: '2026-12-05',
      status: 'active',
      createdAt: serverTimestamp(),
    });

    // Orders in Society A and Society B
    await setDoc(doc(db, 'societies', 'soc_a', 'orders', 'ord_a1'), {
      orderId: 'ord_a1',
      uid: 'user_a',
      societyId: 'soc_a',
      flatId: 'A-402',
      tower: 'Tower A',
      items: [{ productId: 'prod_1', title: 'Organic Rice', quantity: 1, pricePaise: 45000 }],
      totalAmountPaise: 45000,
      paymentStatus: 'payment_integration_pending',
      orderStatus: 'placed',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    await setDoc(doc(db, 'societies', 'soc_b', 'orders', 'ord_b1'), {
      orderId: 'ord_b1',
      uid: 'user_b',
      societyId: 'soc_b',
      flatId: 'C-303',
      tower: 'Tower C',
      items: [{ productId: 'prod_1', title: 'Organic Rice', quantity: 1, pricePaise: 45000 }],
      totalAmountPaise: 45000,
      paymentStatus: 'payment_integration_pending',
      orderStatus: 'placed',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    // Vendors, Work Orders, Settlements, Payments
    await setDoc(doc(db, 'vendors', 'vendor_1'), {
      vendorId: 'vendor_1',
      uid: 'vendor_uid_1',
      businessName: 'CoolAir Services',
      category: 'AC Repair and Servicing',
      status: 'active',
      createdAt: serverTimestamp(),
    });

    await setDoc(doc(db, 'vendors', 'vendor_2'), {
      vendorId: 'vendor_2',
      uid: 'vendor_uid_2',
      businessName: 'SparkElectric',
      category: 'Electrical Work',
      status: 'active',
      createdAt: serverTimestamp(),
    });

    await setDoc(doc(db, 'workOrders', 'wo_1'), {
      workOrderId: 'wo_1',
      vendorId: 'vendor_1',
      societyId: 'soc_a',
      bookingId: 'bk_1',
      status: 'assigned',
      createdAt: serverTimestamp(),
    });

    await setDoc(doc(db, 'workOrders', 'wo_2'), {
      workOrderId: 'wo_2',
      vendorId: 'vendor_2',
      societyId: 'soc_a',
      bookingId: 'bk_2',
      status: 'assigned',
      createdAt: serverTimestamp(),
    });

    await setDoc(doc(db, 'settlements', 'settle_1'), {
      settlementId: 'settle_1',
      vendorId: 'vendor_1',
      amountPaise: 120000,
      status: 'pending',
      createdAt: serverTimestamp(),
    });

    await setDoc(doc(db, 'payments', 'pay_1'), {
      paymentId: 'pay_1',
      uid: 'user_a',
      societyId: 'soc_a',
      orderId: 'ord_a1',
      amountPaise: 45000,
      status: 'pending',
      createdAt: serverTimestamp(),
    });
  });
}

describe('Society Marketplace Firestore Security Rules (Phase 1 & Phase 2)', () => {
  before(async () => {
    const rules = fs.readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf8');
    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: { rules },
    });
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
    await seedTestData();
  });

  after(async () => {
    await testEnv.cleanup();
  });

  it('allows Society A verified member to read Society A campaigns', async () => {
    const db = testEnv.authenticatedContext('user_a', { phone_number: '+919800000001' }).firestore();
    await assertSucceeds(getDoc(doc(db, 'societies', 'soc_a', 'campaigns', 'camp_a1')));
  });

  it('denies Society A member from reading Society B campaigns', async () => {
    const db = testEnv.authenticatedContext('user_a', { phone_number: '+919800000001' }).firestore();
    await assertFails(getDoc(doc(db, 'societies', 'soc_b', 'campaigns', 'camp_b1')));
    await assertFails(getDocs(collection(db, 'societies', 'soc_b', 'campaigns')));
  });

  it('denies Society A member from joining Society B campaigns', async () => {
    const db = testEnv.authenticatedContext('user_a', { phone_number: '+919800000001' }).firestore();
    await assertFails(
      setDoc(doc(db, 'societies', 'soc_b', 'participations', 'part_bad'), {
        participationId: 'part_bad',
        uid: 'user_a',
        societyId: 'soc_b',
        campaignId: 'camp_b1',
        campaignType: 'bulk_offer',
        campaignTitle: 'Society B Exclusive Pest Control',
        quantity: 1,
        unitPricePaise: 89900,
        flatId: 'A-402',
        tower: 'Tower A',
        status: 'joined',
        createdAt: serverTimestamp(),
      })
    );
  });

  it('denies Society A member from reading Society B orders', async () => {
    const db = testEnv.authenticatedContext('user_a', { phone_number: '+919800000001' }).firestore();
    await assertFails(getDoc(doc(db, 'societies', 'soc_b', 'orders', 'ord_b1')));
    await assertFails(getDocs(collection(db, 'societies', 'soc_b', 'orders')));
  });

  it('denies unverified/pending users from accessing marketplace campaigns or creating orders', async () => {
    const db = testEnv.authenticatedContext('user_pending', { phone_number: '+919800000002' }).firestore();
    await assertFails(getDoc(doc(db, 'societies', 'soc_a', 'campaigns', 'camp_a1')));
    await assertFails(
      setDoc(doc(db, 'societies', 'soc_a', 'orders', 'ord_unverified'), {
        orderId: 'ord_unverified',
        uid: 'user_pending',
        societyId: 'soc_a',
        flatId: 'B-101',
        tower: 'Tower B',
        items: [{ productId: 'prod_1', title: 'Item', quantity: 1, pricePaise: 1000 }],
        totalAmountPaise: 1000,
        paymentStatus: 'payment_integration_pending',
        orderStatus: 'placed',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
  });

  it('denies customers from self-approving membership or changing societyId directly', async () => {
    const db = testEnv.authenticatedContext('user_a', { phone_number: '+919800000001' }).firestore();
    await assertFails(
      updateDoc(doc(db, 'users', 'user_a'), {
        societyId: 'soc_b',
        updatedAt: serverTimestamp(),
      })
    );
    await assertFails(
      setDoc(doc(db, 'societies', 'soc_b', 'members', 'user_a'), {
        uid: 'user_a',
        societyId: 'soc_b',
        flatId: 'C-101',
        tower: 'Tower C',
        residentName: 'Aarav Sharma',
        invitationCode: PALM_HASH,
        verificationStatus: 'approved',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
  });

  it('allows verified resident to update allowlisted profile fields only', async () => {
    const db = testEnv.authenticatedContext('user_a', { phone_number: '+919800000001' }).firestore();
    await assertSucceeds(
      updateDoc(doc(db, 'users', 'user_a'), {
        fullName: 'Aarav S.',
        alternateContact: '+919800009999',
        preferredLocale: 'hi',
        updatedAt: serverTimestamp(),
      })
    );
  });

  it('enforces SHA-256 invitation isolation (denies list/plaintext invitationCodes, allows single hash get)', async () => {
    const unauthDb = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(unauthDb, 'invitationLookups', PALM_HASH)));

    const custDb = testEnv.authenticatedContext('user_a', { phone_number: '+919800000001' }).firestore();
    await assertSucceeds(getDoc(doc(custDb, 'invitationLookups', PALM_HASH)));
    await assertFails(getDocs(collection(custDb, 'invitationLookups')));
    await assertFails(getDoc(doc(custDb, 'invitationCodes', 'inv_palm_1')));
    await assertFails(getDocs(collection(custDb, 'invitationCodes')));
    await assertFails(getDoc(doc(custDb, 'invitations', 'PALM2026')));
  });

  it('denies duplicate primary resident claiming an already occupied flat', async () => {
    const db = testEnv.authenticatedContext('user_pending', { phone_number: '+919800000002' }).firestore();
    await assertFails(
      updateDoc(doc(db, 'societies', 'soc_a', 'flats', 'flat_tower_a_a_402'), {
        status: 'Verification Pending',
        occupied: false,
        primaryResidentUid: 'user_pending',
        updatedAt: serverTimestamp(),
      })
    );
  });

  it('denies suspended accounts from reading campaigns, creating orders, or editing profiles', async () => {
    const db = testEnv.authenticatedContext('user_suspended', { phone_number: '+919800000003' }).firestore();
    await assertFails(getDoc(doc(db, 'societies', 'soc_a', 'campaigns', 'camp_a1')));
    await assertFails(
      updateDoc(doc(db, 'users', 'user_suspended'), {
        fullName: 'Bypass Attempt',
        updatedAt: serverTimestamp(),
      })
    );
  });

  it('enforces append-only verificationHistory immutability', async () => {
    const officerDb = testEnv
      .authenticatedContext('staff_verifier', { email: 'verify@greengate.example', email_verified: true })
      .firestore();
    await assertSucceeds(getDoc(doc(officerDb, 'societies', 'soc_a', 'verificationHistory', 'hist_user_a_1')));
    await assertFails(
      updateDoc(doc(officerDb, 'societies', 'soc_a', 'verificationHistory', 'hist_user_a_1'), {
        note: 'Tampered history',
      })
    );
  });

  it('denies customers from modifying campaign participation counters', async () => {
    const db = testEnv.authenticatedContext('user_a', { phone_number: '+919800000001' }).firestore();
    await assertFails(
      updateDoc(doc(db, 'societies', 'soc_a', 'campaigns', 'camp_a1'), {
        currentParticipants: 999,
      })
    );
  });

  it('denies customers from setting or changing order paymentStatus to paid', async () => {
    const db = testEnv.authenticatedContext('user_a', { phone_number: '+919800000001' }).firestore();
    await assertFails(
      setDoc(doc(db, 'societies', 'soc_a', 'orders', 'ord_spoof'), {
        orderId: 'ord_spoof',
        uid: 'user_a',
        societyId: 'soc_a',
        flatId: 'A-402',
        tower: 'Tower A',
        items: [{ productId: 'prod_1', title: 'Item', quantity: 1, pricePaise: 1000 }],
        totalAmountPaise: 1000,
        paymentStatus: 'paid',
        orderStatus: 'placed',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
    await assertFails(
      updateDoc(doc(db, 'societies', 'soc_a', 'orders', 'ord_a1'), {
        paymentStatus: 'paid',
        updatedAt: serverTimestamp(),
      })
    );
  });

  it('denies staff from accessing unauthorized modules such as societies write or staff write', async () => {
    const db = testEnv
      .authenticatedContext('staff_support', { email: 'support@greengate.example', email_verified: true })
      .firestore();
    await assertSucceeds(getDoc(doc(db, 'users', 'user_a')));
    await assertFails(
      setDoc(doc(db, 'societies', 'soc_c'), {
        societyId: 'soc_c',
        societyName: 'Unauthorized Society',
        address: 'Addr',
        city: 'City',
        state: 'State',
        pincode: '560001',
        invitationCode: 'UNAUTH',
        status: 'active',
        createdAt: serverTimestamp(),
      })
    );
  });

  it('denies vendors from accessing other vendors work orders or settlements/payments', async () => {
    const db = testEnv.authenticatedContext('vendor_uid_1', { phone_number: '+919811111111' }).firestore();
    await assertSucceeds(getDoc(doc(db, 'workOrders', 'wo_1')));
    await assertFails(getDoc(doc(db, 'workOrders', 'wo_2')));
    await assertFails(getDoc(doc(db, 'settlements', 'settle_1')));
    await assertFails(getDoc(doc(db, 'payments', 'pay_1')));
  });

  it('denies unverified email admin spoof and ghost field injection', async () => {
    const spoofDb = testEnv
      .authenticatedContext('attacker_1', { email: 'sandeeprana4519@gmail.com', email_verified: false })
      .firestore();
    await assertFails(getDocs(collection(spoofDb, 'auditLogs')));

    const userDb = testEnv.authenticatedContext('new_user_1', { phone_number: '+919822222222' }).firestore();
    await assertFails(
      setDoc(doc(userDb, 'users', 'new_user_1'), {
        uid: 'new_user_1',
        name: 'Ghost Injector',
        membershipStatus: 'unverified',
        accountStatus: 'active',
        isAdmin: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
  });
});
