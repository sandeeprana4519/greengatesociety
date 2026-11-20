import { onCall } from 'firebase-functions/v2/https';
import { adminDb, requireStaffPermission } from '../security/authz';

export const getAdminDashboard = onCall(async (request) => {
  await requireStaffPermission(request, 'society.view');

  const [
    societiesSnap,
    usersSnap,
    pendingMembersSnap,
    approvedMembersSnap,
    rejectedMembersSnap,
    suspendedMembersSnap,
    ordersSnap,
    bookingsSnap,
    auditSnap,
  ] = await Promise.all([
    adminDb.collection('societies').count().get(),
    adminDb.collection('users').count().get(),
    adminDb.collectionGroup('members').where('verificationStatus', '==', 'pending').count().get(),
    adminDb.collectionGroup('members').where('verificationStatus', '==', 'approved').count().get(),
    adminDb.collectionGroup('members').where('verificationStatus', '==', 'rejected').count().get(),
    adminDb.collectionGroup('members').where('verificationStatus', '==', 'suspended').count().get(),
    adminDb.collectionGroup('orders').count().get(),
    adminDb.collectionGroup('serviceBookings').count().get(),
    adminDb.collection('auditLogs').orderBy('createdAt', 'desc').limit(20).get(),
  ]);

  return {
    metrics: {
      societiesCount: societiesSnap.data().count,
      usersCount: usersSnap.data().count,
      pendingVerificationsCount: pendingMembersSnap.data().count,
      approvedResidentsCount: approvedMembersSnap.data().count,
      rejectedApplicationsCount: rejectedMembersSnap.data().count,
      suspendedAccountsCount: suspendedMembersSnap.data().count,
      ordersCount: ordersSnap.data().count,
      serviceBookingsCount: bookingsSnap.data().count,
    },
    recentAuditLogs: auditSnap.docs.map((d) => d.data()),
  };
});
