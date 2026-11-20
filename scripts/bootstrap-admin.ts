/**
 * Protected Local Admin Bootstrap Script (Phase 1)
 *
 * Requirements:
 * - Requires an existing Firebase Auth UID via ADMIN_BOOTSTRAP_UID env var or --uid flag.
 * - Never creates a default password.
 * - Never embeds or commits service-account JSON credentials.
 * - Uses Google Application Default Credentials (GOOGLE_APPLICATION_CREDENTIALS or gcloud ADC).
 *
 * Usage:
 *   FIREBASE_PROJECT_ID=applied-method-zmn89 \
 *   FIREBASE_DATABASE_ID=ai-studio-458e2b8b-ee9b-4552-86d0-7ed2461e7b9e \
 *   ADMIN_BOOTSTRAP_UID=<existing_firebase_uid> \
 *   npx tsx scripts/bootstrap-admin.ts
 */
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

function getArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

async function main() {
  const projectId = process.env.FIREBASE_PROJECT_ID || getArg('--project');
  const databaseId = process.env.FIREBASE_DATABASE_ID || getArg('--database');
  const uid = process.env.ADMIN_BOOTSTRAP_UID || getArg('--uid');

  if (!projectId) {
    console.error('ERROR: FIREBASE_PROJECT_ID (or --project) is required.');
    process.exit(1);
  }
  if (!uid) {
    console.error(
      'ERROR: ADMIN_BOOTSTRAP_UID (or --uid) is required. Refusing to create a default administrator.'
    );
    process.exit(1);
  }

  const app = initializeApp({
    credential: applicationDefault(),
    projectId,
  });

  const auth = getAuth(app);
  const db =
    databaseId && databaseId !== '(default)'
      ? getFirestore(app, databaseId)
      : getFirestore(app);

  // Verify the target UID already exists in Firebase Authentication
  const userRecord = await auth.getUser(uid);
  const email = userRecord.email || process.env.ADMIN_BOOTSTRAP_EMAIL;
  const displayName = userRecord.displayName || process.env.ADMIN_BOOTSTRAP_NAME || 'Super Administrator';

  if (!email) {
    console.error('ERROR: Target Firebase Auth user must have a verified email address.');
    process.exit(1);
  }

  // Assign server-side custom claims
  await auth.setCustomUserClaims(uid, {
    ...(userRecord.customClaims ?? {}),
    role: 'super_admin',
    admin: true,
  });

  // Ensure super_admin role exists
  await db.collection('roles').doc('super_admin').set(
    {
      roleId: 'super_admin',
      name: 'Super Administrator',
      description: 'Full platform governance across all societies, RBAC, and audit logs.',
      permissions: ['*'],
      createdAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  // Upsert staff record
  await db.collection('staff').doc(uid).set(
    {
      staffId: uid,
      uid,
      name: displayName,
      email,
      roleId: 'super_admin',
      assignedSocietyIds: [],
      status: 'active',
      createdAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  // Write immutable audit trail
  const auditRef = db.collection('auditLogs').doc();
  await auditRef.set({
    logId: auditRef.id,
    actorUid: uid,
    actorEmail: email,
    action: 'BOOTSTRAP_SUPER_ADMIN',
    targetCollection: 'staff',
    targetId: uid,
    details: `Assigned super_admin role and custom claims to existing Auth UID ${uid}`,
    createdAt: FieldValue.serverTimestamp(),
  });

  console.log(`Super Admin bootstrapped successfully for UID=${uid} (${email}) on project=${projectId}.`);
}

main().catch((err) => {
  console.error('Bootstrap failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
