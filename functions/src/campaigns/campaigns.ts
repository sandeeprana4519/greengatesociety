import { FieldValue } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import {
  adminDb,
  claimIdempotencyKey,
  requireVerifiedSocietyMember,
} from '../security/authz';

export const getSocietyCampaigns = onCall(async (request) => {
  const member = await requireVerifiedSocietyMember(
    request,
    typeof request.data?.societyId === 'string' ? request.data.societyId : undefined
  );

  const [bulkSnap, groupSnap] = await Promise.all([
    adminDb
      .collection('societies')
      .doc(member.societyId)
      .collection('campaigns')
      .where('status', 'in', ['active', 'target_met'])
      .get(),
    adminDb
      .collection('societies')
      .doc(member.societyId)
      .collection('groupCampaigns')
      .where('status', 'in', ['active', 'target_met'])
      .get(),
  ]);

  return {
    societyId: member.societyId,
    bulkOffers: bulkSnap.docs.map((d) => d.data()),
    groupCampaigns: groupSnap.docs.map((d) => d.data()),
  };
});

export const getCustomerDashboard = onCall(async (request) => {
  const member = await requireVerifiedSocietyMember(request);
  const societyRef = adminDb.collection('societies').doc(member.societyId);

  const [societySnap, bulkSnap, groupSnap, ordersSnap, bookingsSnap, participationsSnap] =
    await Promise.all([
      societyRef.get(),
      societyRef.collection('campaigns').where('status', 'in', ['active', 'target_met']).get(),
      societyRef.collection('groupCampaigns').where('status', 'in', ['active', 'target_met']).get(),
      societyRef.collection('orders').where('uid', '==', member.uid).limit(10).get(),
      societyRef.collection('serviceBookings').where('uid', '==', member.uid).limit(10).get(),
      societyRef.collection('participations').where('uid', '==', member.uid).limit(20).get(),
    ]);

  return {
    society: societySnap.exists ? societySnap.data() : null,
    bulkOffers: bulkSnap.docs.map((d) => d.data()),
    groupCampaigns: groupSnap.docs.map((d) => d.data()),
    orders: ordersSnap.docs.map((d) => d.data()),
    serviceBookings: bookingsSnap.docs.map((d) => d.data()),
    participations: participationsSnap.docs.map((d) => d.data()),
  };
});

export const joinSocietyCampaign = onCall(async (request) => {
  const member = await requireVerifiedSocietyMember(request);
  const campaignId = String(request.data?.campaignId || '').trim();
  const campaignType = request.data?.campaignType === 'group_buy' ? 'group_buy' : 'bulk_offer';
  const quantity = Math.max(1, Math.min(20, Number(request.data?.quantity || 1)));
  const idempotencyKey =
    typeof request.data?.idempotencyKey === 'string' ? request.data.idempotencyKey : undefined;

  if (!campaignId) {
    throw new HttpsError('invalid-argument', 'campaignId is required.');
  }

  const acquired = await claimIdempotencyKey(
    idempotencyKey,
    member.uid,
    `join_${campaignType}_${campaignId}`
  );
  if (!acquired) {
    return { joined: true, deduplicated: true };
  }

  const societyRef = adminDb.collection('societies').doc(member.societyId);
  const colName = campaignType === 'group_buy' ? 'groupCampaigns' : 'campaigns';
  const campRef = societyRef.collection(colName).doc(campaignId);
  const partRef = societyRef.collection('participations').doc();

  await adminDb.runTransaction(async (tx) => {
    const campSnap = await tx.get(campRef);
    if (!campSnap.exists) {
      throw new HttpsError('not-found', 'Campaign not found in your society.');
    }
    const camp = campSnap.data()!;
    if (!['active', 'target_met'].includes(String(camp.status))) {
      throw new HttpsError('failed-precondition', 'Campaign is no longer open for joining.');
    }

    const unitPricePaise =
      campaignType === 'group_buy' ? Number(camp.groupPricePaise) : Number(camp.offerPricePaise);
    const countField = campaignType === 'group_buy' ? 'currentQuantity' : 'currentParticipants';
    const nextCount = Number(camp[countField] || 0) + quantity;
    const minTarget =
      campaignType === 'group_buy'
        ? Number(camp.minimumGroupQuantity || 1)
        : Number(camp.minimumTarget || 1);

    tx.update(campRef, {
      [countField]: nextCount,
      status: nextCount >= minTarget ? 'target_met' : camp.status,
      updatedAt: FieldValue.serverTimestamp(),
    });

    tx.set(partRef, {
      participationId: partRef.id,
      uid: member.uid,
      societyId: member.societyId,
      campaignId,
      campaignType,
      campaignTitle: String(camp.title),
      quantity,
      unitPricePaise,
      flatId: member.flatId,
      tower: member.tower,
      status: 'joined',
      createdAt: FieldValue.serverTimestamp(),
    });
  });

  return { joined: true, participationId: partRef.id };
});
