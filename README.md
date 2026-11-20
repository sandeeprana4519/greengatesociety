# GreenGate Society Marketplace — Phase 1 & Phase 2

A production-oriented **Society-Based Group Buying & Hyperlocal Services Marketplace** built with strict residential society tenant isolation, Firebase Phone OTP & Google Authentication, SHA-256 Invitation Code Verification, Resident Approval Lifecycle, Cloud Firestore, Cloud Functions, Storage Rules, a React Native (Expo Router) Customer Application, and a Next.js Admin Dashboard.

---

## 1. Monorepo Architecture

```text
society-marketplace/
├── apps/
│   ├── customer/              # React Native + Expo Router mobile app (Phone OTP + Verification Gate + 3 Tabs)
│   └── admin/                 # Next.js App Router enterprise Admin Dashboard (20-module sidebar + 7 Society sub-modules)
├── functions/                 # Firebase Cloud Functions (Auth triggers, SHA-256 Invitations, Verification & RBAC)
├── packages/
│   ├── shared-types/          # Canonical TypeScript interfaces (Phase 1 + Phase 2)
│   ├── validation/            # Input validation synced with firebase-blueprint.json
│   ├── constants/             # OTP security config, dual RBAC permissions, Society sub-modules, EN/HI dictionary
│   └── business-logic/        # Integer paise INR formatting, Phase 2 lifecycle resolver, flat ID & SHA-256 helpers
├── firebase/
│   ├── firestore.rules        # Hardened tenant-isolated Firestore security rules
│   ├── firestore.indexes.json # Composite & collectionGroup indexes
│   └── storage.rules          # Firebase Storage security rules
├── scripts/
│   ├── bootstrap-admin.ts     # Protected local super-admin bootstrap (requires existing Auth UID)
│   ├── migrate-phase1-to-phase2.ts # Non-destructive Phase 1 -> Phase 2 backfill & invitation hash migration
│   └── seed-demo.ts           # Explicit standalone demo data seeder (--confirm-demo-seed)
├── src/                       # Live Web Portal running on port 3000 wired to Firebase
├── tests/                     # Pure unit tests for Phase 2 validation, RBAC, and verification state machine
├── firebase-blueprint.json    # Schema intermediate representation
├── firestore.rules            # Root synced rules deployed to Firebase
├── firestore.rules.test.ts    # Automated Firebase Emulator security tests
├── security_spec.md           # Security TDD invariants & adversarial payloads
└── .env.example               # Environment variables template (no secrets)
```

---

## 2. Phase 2 Security & Database Schema

- **`users/{uid}`** — Resident profile, `fullName`, `phoneNumber`, `email`, `alternateContact`, `accountType`, `membershipStatus` (`not_submitted | unverified | pending | approved | rejected | suspended`), `accountStatus` (`active | suspended | blocked`), `societyId`, `tower`, `flatNumber`, `residentType` (`Owner | Tenant`), `addressConfirmed`, `approvalAcknowledged`, `rejectionReason`, `suspensionReason`, `infoRequestNote`, `verifiedAt`, `verifiedBy`.
- **`invitationCodes/{codeId}`** — Admin-only invitation registry storing **SHA-256 `codeHash`**, `codePreview`, `status` (`active | inactive | revoked | expired`), `expiresAt`, `maxUses`, `usedCount`. Plaintext codes are revealed only once upon generation.
- **`invitationLookups/{codeHash}`** — Public-safe lookup projection keyed by SHA-256 digest (contains no plaintext code or PII; single-document `get` allowed only for verified auth users; `list` restricted to admins).
- **`societies/{societyId}/members/{uid}`** — Society membership request, occupancy type, audit fields, rejection/suspension/info notes.
- **`societies/{societyId}/flats/{flatDocId}`** — Tower/flat registry enforcing single primary resident locks (`Available | Verification Pending | Occupied | Active | Suspended`).
- **`societies/{societyId}/verificationHistory/{historyId}`** — Append-only audit log of every submission, approval, rejection, info request, suspension, and reactivation.
- **`notifications/{notificationId}`** — Deduplicated status notifications for residents.
- **`auditLogs/{logId}`** — Immutable platform & security audit log.

---

## 3. Firebase Phone Authentication & Mobile Setup (Phase 2)

> **Important**: Before shipping Phone OTP to residents, review and enable the required settings in your Firebase Console (`Authentication -> Sign-in method -> Phone`).

### A. Web Portal (Port 3000)
1. Enable **Phone** sign-in in Firebase Console (`Authentication -> Sign-in method -> Phone`).
2. Add your preview/hosting domains to **Authorized domains** (`Authentication -> Settings -> Authorized domains`).
3. Invisible reCAPTCHA (`RecaptchaVerifier`) runs automatically on mobile OTP send.
4. For automated testing without real SMS charges, configure **Phone numbers for testing** inside Firebase Console (`Authentication -> Sign-in method -> Phone`).

### B. Expo Mobile Development Build (`apps/customer`)
React Native Firebase Phone Auth **requires an Expo Development Build** (not Expo Go):
1. **Android**:
   - Register your Android package name in Firebase Console.
   - Add debug & release **SHA-1** and **SHA-256** fingerprints (`keytool -list -v` or `eas credentials`) so Play Integrity / SafetyNet SMS verification succeeds.
   - Download `google-services.json` and place it in `apps/customer/`.
2. **iOS**:
   - Register your iOS Bundle ID in Firebase Console.
   - Upload an **APNs Auth Key (`.p8`)** in Firebase Console (`Project Settings -> Cloud Messaging -> Apple app configuration`) for silent push verification (required for Phone Auth on real iOS devices).
   - Download `GoogleService-Info.plist` and place it in `apps/customer/`.
3. Build & run Dev Client:
   ```bash
   cd apps/customer
   npx expo prebuild
   npx expo run:android   # or: eas build --profile development --platform android
   npx expo run:ios       # or: eas build --profile development --platform ios
   ```

---

## 4. Admin Invitation & Verification Workflows

1. **Generate Invitation Code**: Admins create a society or open **Society Management -> Invitation Codes**, configure `maxUses` and optional expiry date, and generate a code. The system hashes the code using SHA-256 (`invitationCodes` + `invitationLookups`) and shows the plaintext code once for copy/distribution.
2. **Resident Registration & Approval**:
   - Resident verifies mobile via Firebase Phone OTP (60s resend cooldown, 5-attempt lockout).
   - Resident enters the invitation code (hashed client-side via SHA-256 before lookup).
   - Resident submits Full Name, Owner/Tenant type, Tower, Flat Number, optional Email/Alternate Contact, and explicit address confirmation.
   - Duplicate active/pending claims on the same flat are blocked by both Firestore Security Rules and Cloud Functions.
   - Admin reviews the full application and **Approves**, **Requests More Info**, **Rejects** (with reason, releasing flat lock), **Suspends**, or **Reactivates** — writing atomic updates across `members`, `users`, `flats`, `verificationHistory`, `notifications`, and `auditLogs`.

---

## 5. Cloud Functions, RBAC & Migration

### Deploy Backend Functions & Indexes
```bash
cd functions
npm install
npm run build
firebase deploy --only functions,firestore:rules,firestore:indexes,storage
```

### Protected Super-Admin Bootstrap
```bash
FIREBASE_PROJECT_ID=<your-project-id> \
FIREBASE_DATABASE_ID=<your-database-id> \
ADMIN_BOOTSTRAP_UID=<existing-firebase-auth-uid> \
npx tsx scripts/bootstrap-admin.ts
```

### Migrate Existing Phase 1 Data to Phase 2 (Idempotent)
```bash
# Dry run first
FIREBASE_PROJECT_ID=<your-project-id> \
FIREBASE_DATABASE_ID=<your-database-id> \
npx tsx scripts/migrate-phase1-to-phase2.ts --dry-run

# Execute migration
FIREBASE_PROJECT_ID=<your-project-id> \
FIREBASE_DATABASE_ID=<your-database-id> \
npx tsx scripts/migrate-phase1-to-phase2.ts
```

### Firebase App Check (Recommended for Production)
App Check verification support is pre-wired in `functions/src/security/authz.ts` (`APP_CHECK_CONFIG`). Register your Web (reCAPTCHA Enterprise), Android (Play Integrity), and iOS (App Attest / DeviceCheck) apps in Firebase App Check, then enforce `consumeAppCheckToken` once client providers are active.

---

## 6. Local Build & Security Verification

```bash
# Lint & build live Web Portal
npm run lint
npm run build

# Run Phase 2 pure logic & validation unit tests
npx tsx --test tests/phase2-logic.test.ts

# Lint Firestore security rules
npx eslint firestore.rules

# Run Firebase Emulator security test suite (requires Java 17+ for Firestore Emulator)
firebase emulators:exec --only firestore "npx tsx --test firestore.rules.test.ts"
```
