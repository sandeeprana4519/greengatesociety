# Society Marketplace — Phase 1 & Phase 2 Security Specification (Payload-First Security TDD)

## 1. Core Data Invariants
1. **Strict Tenant Isolation**: A verified member of Society A (`users/{uid}.societyId == 'society_a'` and `societies/society_a/members/{uid}.verificationStatus == 'approved'`) can NEVER read (`get` or `list`) or write any document under `/societies/society_b/**`.
2. **Verification Gate**: An authenticated user whose `membershipStatus != 'approved'` or `accountStatus != 'active'` cannot read or create campaigns, participations, orders, or service bookings in any society.
3. **Immutable Membership & Identity Fields**: Customers can NEVER modify `membershipStatus`, `accountStatus`, `accountType`, `societyId` (once pending/approved), `verifiedBy`, `verifiedAt`, or `verificationStatus` via client writes.
4. **Hashed Invitation Code Protection**:
   - Plaintext reusable invitation codes are NEVER readable or listable by ordinary customers.
   - `/invitationCodes/{codeId}` and `/invitations/{code}` are strictly restricted to authorized Admins/Staff.
   - Client verification uses SHA-256 hash lookups via Cloud Functions or get-only `/invitationLookups/{codeHash}` (list denied, no plaintext code, no PII).
5. **Single Primary Resident Lock Per Flat**:
   - Customers cannot register for a flat in `/societies/{societyId}/flats/{flatId}` whose status is already `Occupied`, `Active`, or `Verification Pending` under a different `primaryResidentUid`.
6. **Server-Authoritative Financial & Counter Integrity**:
   - Customers can NEVER modify `currentParticipants` or `currentQuantity` on campaigns directly.
   - Customers can NEVER set or update `paymentStatus` to `'paid'` or `'refunded'` on `/societies/{societyId}/orders/{orderId}` or `/payments/{paymentId}`.
7. **Privilege Escalation Prevention & Dual-Format RBAC**:
   - No client can create or modify `/staff/{staffId}` or `/roles/{roleId}` unless authenticated as verified Super Admin.
   - Users cannot inject ghost fields (`role`, `isAdmin`, `verified`) into `/users/{uid}` or `/societies/{societyId}/members/{uid}`.
   - Staff permissions support both Phase 2 granular dot keys (`society.view`, `customer.verify`, `invitation.create`, etc.) and Phase 1 colon aliases (`societies:read`, `customers:write`, etc.).
8. **Vendor & PII Isolation**:
   - A vendor can ONLY read/update `/workOrders/{workOrderId}` where `resource.data.vendorId` matches their vendor record, and can NEVER read `/payments/**`, `/refunds/**`, or `/settlements/**`.
   - `/users/{uid}` is readable ONLY by the owner or authorized Admins/Staff.
   - `/societies/{societyId}/verificationHistory/{historyId}` and `/auditLogs/{logId}` are append-only (`update, delete: if false`).

## 2. Adversarial Payloads (Must All Return `PERMISSION_DENIED`)
1. **Cross-Society Campaign Read**: User verified in `society_a` attempts `get` / `list` on `/societies/society_b/campaigns/camp_1`.
2. **Cross-Society Order Read**: User verified in `society_a` attempts `get` / `list` on `/societies/society_b/orders/ord_1`.
3. **Unverified Marketplace Access**: Authenticated user with `membershipStatus: 'pending'` or `'not_submitted'` attempts to read `/societies/society_a/campaigns` or create `/societies/society_a/orders/ord_2`.
4. **Self-Approved Membership**: User creates `/societies/society_a/members/{uid}` with `verificationStatus: 'approved'` instead of `'pending'`.
5. **Client-Side Society Switch**: Verified user of `society_a` attempts to update `/users/{uid}` changing `societyId: 'society_b'`.
6. **Self-Assigned Admin Staff**: Regular user creates `/staff/{uid}` with `roleId: 'super_admin'`, `status: 'active'`.
7. **Payment Status Spoofing**: Verified customer creates `/societies/society_a/orders/ord_3` with `paymentStatus: 'paid'`, or updates an existing order setting `paymentStatus: 'paid'`.
8. **Participation Counter Tampering**: Verified customer updates `/societies/society_a/campaigns/camp_1` setting `currentParticipants: 999`.
9. **Shadow / Ghost Field Injection**: User creates `/users/{uid}` with an unlisted ghost field `isAdmin: true`.
10. **Vendor Cross-Access & Financial Snooping**: Vendor A attempts to read Vendor B's `/workOrders/wo_b` or read `/settlements/settle_1` or `/payments/pay_1`.
11. **Unverified Email Admin Spoof**: Token with `email: 'sandeeprana4519@gmail.com'` and `email_verified: false` attempts to read `/auditLogs` or approve a member.
12. **Resource / ID Poisoning**: User attempts invalid IDs or >1000 char description fields.
13. **Invitation Directory Scraping**: Customer attempts `list` or `get` on `/invitationCodes` or `list` on `/invitationLookups` or `/invitations`.
14. **Duplicate Flat Takeover**: Customer B attempts to register `/societies/soc_a/flats/flat_tower_a_a_402` while it is already `Occupied` or `Verification Pending` by Customer A.
15. **Suspended Resident Bypass**: Suspended resident (`accountStatus: 'suspended'` or `membershipStatus: 'suspended'`) attempts to read campaigns, place orders, or edit profile fields.
