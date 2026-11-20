import { getMessaging } from 'firebase-admin/messaging';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../security/authz';

export type NotificationEventType =
  | 'verification_submitted'
  | 'verification_approved'
  | 'verification_rejected'
  | 'info_requested'
  | 'account_suspended'
  | 'account_reactivated'
  | 'general';

export async function sendSocietyUserNotification(params: {
  uid: string;
  societyId: string;
  title: string;
  body: string;
  type?: NotificationEventType;
  dedupeKey?: string;
}): Promise<string> {
  if (params.dedupeKey) {
    const existingSnap = await adminDb
      .collection('notifications')
      .where('uid', '==', params.uid)
      .where('dedupeKey', '==', params.dedupeKey)
      .limit(1)
      .get();
    if (!existingSnap.empty) {
      return existingSnap.docs[0].id;
    }
  }

  const notifRef = adminDb.collection('notifications').doc();
  await notifRef.set({
    notificationId: notifRef.id,
    uid: params.uid,
    societyId: params.societyId,
    type: params.type ?? 'general',
    title: params.title.slice(0, 140),
    body: params.body.slice(0, 500),
    read: false,
    dedupeKey: params.dedupeKey ?? '',
    createdAt: FieldValue.serverTimestamp(),
  });

  const userSnap = await adminDb.collection('users').doc(params.uid).get();
  const fcmToken = userSnap.data()?.fcmToken;
  if (typeof fcmToken === 'string' && fcmToken.length > 10) {
    try {
      await getMessaging().send({
        token: fcmToken,
        notification: {
          title: params.title,
          body: params.body,
        },
        data: {
          societyId: params.societyId,
          notificationId: notifRef.id,
          type: params.type ?? 'general',
        },
      });
    } catch {
      // Invalid or expired FCM tokens should not fail the primary write
    }
  }

  return notifRef.id;
}

export async function notifyMembershipSubmitted(params: {
  uid: string;
  societyId: string;
  societyName: string;
  tower: string;
  flatNumber: string;
  attemptStamp: string;
}): Promise<string> {
  return sendSocietyUserNotification({
    uid: params.uid,
    societyId: params.societyId,
    type: 'verification_submitted',
    title: 'Society Verification Submitted',
    body: `Your request for ${params.societyName} (${params.tower} · ${params.flatNumber}) is pending administrator review.`,
    dedupeKey: `ver_sub_${params.uid}_${params.societyId}_${params.attemptStamp}`,
  });
}

export async function notifyMembershipApproved(params: {
  uid: string;
  societyId: string;
  societyName: string;
  tower: string;
  flatNumber: string;
}): Promise<string> {
  return sendSocietyUserNotification({
    uid: params.uid,
    societyId: params.societyId,
    type: 'verification_approved',
    title: 'Society Verification Approved',
    body: `Welcome! Your flat (${params.tower} · ${params.flatNumber}) at ${params.societyName} is verified. Marketplace access is now unlocked.`,
    dedupeKey: `ver_app_${params.uid}_${params.societyId}_${params.flatNumber}`,
  });
}

export async function notifyMembershipRejected(params: {
  uid: string;
  societyId: string;
  reason: string;
  timestampKey: string;
}): Promise<string> {
  return sendSocietyUserNotification({
    uid: params.uid,
    societyId: params.societyId,
    type: 'verification_rejected',
    title: 'Verification Application Rejected',
    body: `Your flat verification was declined: ${params.reason}. You may review your details and resubmit.`,
    dedupeKey: `ver_rej_${params.uid}_${params.societyId}_${params.timestampKey}`,
  });
}

export async function notifyInfoRequested(params: {
  uid: string;
  societyId: string;
  note: string;
  timestampKey: string;
}): Promise<string> {
  return sendSocietyUserNotification({
    uid: params.uid,
    societyId: params.societyId,
    type: 'info_requested',
    title: 'Additional Verification Details Requested',
    body: `Society Admin requested clarification: ${params.note}`,
    dedupeKey: `ver_info_${params.uid}_${params.societyId}_${params.timestampKey}`,
  });
}

export async function notifyMembershipSuspended(params: {
  uid: string;
  societyId: string;
  reason: string;
  timestampKey: string;
}): Promise<string> {
  return sendSocietyUserNotification({
    uid: params.uid,
    societyId: params.societyId,
    type: 'account_suspended',
    title: 'Society Membership Suspended',
    body: `Your resident marketplace access was suspended: ${params.reason}. Contact society administration.`,
    dedupeKey: `ver_susp_${params.uid}_${params.societyId}_${params.timestampKey}`,
  });
}

export async function notifyMembershipReactivated(params: {
  uid: string;
  societyId: string;
  societyName: string;
  timestampKey: string;
}): Promise<string> {
  return sendSocietyUserNotification({
    uid: params.uid,
    societyId: params.societyId,
    type: 'account_reactivated',
    title: 'Membership Reactivated',
    body: `Your verified access for ${params.societyName} has been restored by society administration.`,
    dedupeKey: `ver_react_${params.uid}_${params.societyId}_${params.timestampKey}`,
  });
}
