/**
 * Phase 1 -> Phase 2 Non-Destructive Firestore Migration Script
 *
 * Safeties:
 * - Supports --dry-run to preview counts without writing to Firestore.
 * - Preserves all existing Phase 1 societies, campaigns, orders, and verified memberships.
 * - Backfills Phase 2 user fields (fullName, accountType, flatNumber, approvalAcknowledged=true
 *   for already-approved Phase 1 residents so they are not blocked by the Phase 2 welcome screen).
 * - Migrates legacy /invitations/{code} records into SHA-256 hashed /invitationCodes & /invitationLookups.
 * - Creates /societies/{societyId}/flats/{flatDocId} entries for existing pending/approved members.
 *
 * Usage:
 *   FIREBASE_PROJECT_ID=applied-method-zmn89 \
 *   FIREBASE_DATABASE_ID=ai-studio-458e2b8b-ee9b-4552-86d0-7ed2461e7b9e \
 *   npx tsx scripts/migrate-phase1-to-phase2.ts --dry-run
 */
import crypto from 'node:crypto';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

function getArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function sha256Hex(rawCode: string): string {
  return crypto.createHash('sha256').update(rawCode.trim().toUpperCase()).digest('hex');
}

function normalizeFlatDocId(tower: string, flatNumber: string): string {
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

async function main() {
  const projectId = process.env.FIREBASE_PROJECT_ID || getArg('--project');
  const databaseId = process.env.FIREBASE_DATABASE_ID || getArg('--database');
  const dryRun = hasFlag('--dry-run');
  const normalizeStatus = hasFlag('--normalize-status');

  if (!projectId) {
    console.error('ERROR: FIREBASE_PROJECT_ID (or --project) is required.');
    process.exit(1);
  }

  const app = initializeApp({
    credential: applicationDefault(),
    projectId,
  });

  const db =
    databaseId && databaseId !== '(default)'
      ? getFirestore(app, databaseId)
      : getFirestore(app);

  let usersUpdated = 0;
  let invitationsMigrated = 0;
  let flatsBackfilled = 0;

  // 1. Backfill Phase 2 fields on /users
  const usersSnap = await db.collection('users').get();
  for (const userDoc of usersSnap.docs) {
    const data = userDoc.data();
    const patch: Record<string, unknown> = {};

    if (!data.fullName && data.name) patch.fullName = data.name;
    if (!data.accountType) patch.accountType = 'customer';
    if (!data.flatNumber && data.flatId) patch.flatNumber = data.flatId;
    if (data.membershipStatus === 'approved' && data.approvalAcknowledged === undefined) {
      patch.approvalAcknowledged = true;
    }
    if (normalizeStatus && data.membershipStatus === 'unverified') {
      patch.membershipStatus = 'not_submitted';
    }

    if (Object.keys(patch).length > 0) {
      usersUpdated += 1;
      if (!dryRun) {
        await userDoc.ref.set(
          {
            ...patch,
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }
    }
  }

  // 2. Migrate legacy /invitations/{code} -> /invitationCodes & /invitationLookups
  const legacyInvitesSnap = await db.collection('invitations').get();
  for (const invDoc of legacyInvitesSnap.docs) {
    const data = invDoc.data();
    const rawCode = String(data.code || invDoc.id).trim().toUpperCase();
    const codeHash = sha256Hex(rawCode);
    const codeId = `inv_mig_${invDoc.id.toLowerCase().replace(/[^a-z0-9_-]/g, '_')}`;
    const lookupRef = db.collection('invitationLookups').doc(codeHash);
    const existingLookup = await lookupRef.get();

    if (!existingLookup.exists) {
      invitationsMigrated += 1;
      if (!dryRun) {
        const status = data.active === false ? 'inactive' : 'active';
        await db.collection('invitationCodes').doc(codeId).set(
          {
            codeId,
            societyId: data.societyId,
            societyName: data.societyName,
            city: data.city || '',
            codeHash,
            codePreview: `${rawCode.slice(0, 4)}••••`,
            status,
            maxUses: 500,
            usedCount: 0,
            createdBy: 'phase2_migration',
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
        await lookupRef.set(
          {
            codeId,
            societyId: data.societyId,
            societyName: data.societyName,
            city: data.city || '',
            status,
            maxUses: 500,
            usedCount: 0,
          },
          { merge: true }
        );
      }
    }
  }

  // 3. Backfill /societies/{societyId}/flats/{flatDocId} from existing members
  const membersSnap = await db.collectionGroup('members').get();
  for (const memberDoc of membersSnap.docs) {
    const m = memberDoc.data();
    if (!m.societyId || !m.tower || (!m.flatNumber && !m.flatId)) continue;
    const flatNum = String(m.flatNumber || m.flatId);
    const flatDocId = normalizeFlatDocId(String(m.tower), flatNum);
    const flatRef = db.collection('societies').doc(m.societyId).collection('flats').doc(flatDocId);
    const existingFlat = await flatRef.get();
    if (!existingFlat.exists) {
      flatsBackfilled += 1;
      if (!dryRun) {
        const status =
          m.verificationStatus === 'approved'
            ? 'Occupied'
            : m.verificationStatus === 'pending'
              ? 'Verification Pending'
              : m.verificationStatus === 'suspended'
                ? 'Suspended'
                : 'Available';
        await flatRef.set({
          flatId: flatDocId,
          societyId: m.societyId,
          tower: m.tower,
          flatNumber: flatNum,
          occupied: m.verificationStatus === 'approved',
          status,
          primaryResidentUid: m.verificationStatus === 'rejected' ? '' : m.uid,
          residentType: m.residentType || 'Owner',
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
    }
  }

  if (!dryRun) {
    const auditRef = db.collection('auditLogs').doc();
    await auditRef.set({
      logId: auditRef.id,
      actorUid: 'phase2_migration_script',
      actorRole: 'system',
      action: 'MIGRATE_PHASE1_TO_PHASE2',
      targetCollection: 'users,invitationCodes,flats',
      targetId: projectId,
      status: 'success',
      details: `Migrated users=${usersUpdated}, invitations=${invitationsMigrated}, flats=${flatsBackfilled}`,
      createdAt: FieldValue.serverTimestamp(),
    });
  }

  console.log(
    JSON.stringify(
      {
        dryRun,
        projectId,
        databaseId: databaseId || '(default)',
        usersUpdated,
        invitationsMigrated,
        flatsBackfilled,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error('Migration failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
