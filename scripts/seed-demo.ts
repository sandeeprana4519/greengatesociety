/**
 * Explicit Standalone Demo Catalog Seeder
 *
 * Never runs automatically in production. Requires --confirm-demo-seed flag
 * and clearly tags inserted records as demo data.
 *
 * Usage:
 *   FIREBASE_PROJECT_ID=applied-method-zmn89 \
 *   FIREBASE_DATABASE_ID=ai-studio-458e2b8b-ee9b-4552-86d0-7ed2461e7b9e \
 *   npx tsx scripts/seed-demo.ts --confirm-demo-seed
 */
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

async function main() {
  if (!process.argv.includes('--confirm-demo-seed')) {
    console.error('Refusing to seed without explicit --confirm-demo-seed flag.');
    process.exit(1);
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const databaseId = process.env.FIREBASE_DATABASE_ID;
  if (!projectId) {
    console.error('FIREBASE_PROJECT_ID is required.');
    process.exit(1);
  }

  const app = initializeApp({ credential: applicationDefault(), projectId });
  const db =
    databaseId && databaseId !== '(default)'
      ? getFirestore(app, databaseId)
      : getFirestore(app);

  const societyId = 'demo_palm_meadows';
  await db.collection('societies').doc(societyId).set({
    societyId,
    societyName: '[DEMO] Palm Meadows Residency',
    address: 'Whitefield Main Road, Bengaluru',
    city: 'Bengaluru',
    state: 'Karnataka',
    pincode: '560066',
    invitationCode: 'PALMDEMO26',
    status: 'active',
    isDemo: true,
    createdAt: FieldValue.serverTimestamp(),
  });

  await db.collection('invitations').doc('PALMDEMO26').set({
    code: 'PALMDEMO26',
    societyId,
    societyName: '[DEMO] Palm Meadows Residency',
    city: 'Bengaluru',
    active: true,
    createdAt: FieldValue.serverTimestamp(),
  });

  console.log('Explicit [DEMO] society and invitation PALMDEMO26 seeded.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
