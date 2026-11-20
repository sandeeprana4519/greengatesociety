import { FieldValue } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import {
  adminDb,
  claimIdempotencyKey,
  requireVerifiedSocietyMember,
} from '../security/authz';

export const createIndividualOrder = onCall(async (request) => {
  const member = await requireVerifiedSocietyMember(request);
  const rawItems = Array.isArray(request.data?.items) ? request.data.items : [];
  const idempotencyKey =
    typeof request.data?.idempotencyKey === 'string' ? request.data.idempotencyKey : undefined;

  if (rawItems.length === 0 || rawItems.length > 50) {
    throw new HttpsError('invalid-argument', 'Order must contain 1–50 items.');
  }

  const acquired = await claimIdempotencyKey(idempotencyKey, member.uid, 'create_order');
  if (!acquired) {
    return { created: true, deduplicated: true };
  }

  // Never trust client-submitted prices: fetch authoritative catalog prices server-side.
  const verifiedItems: Array<{
    productId: string;
    title: string;
    quantity: number;
    pricePaise: number;
    unitLabel: string;
  }> = [];
  let totalAmountPaise = 0;

  for (const item of rawItems) {
    const productId = String(item?.productId || '').trim();
    const quantity = Math.max(1, Math.min(25, Math.floor(Number(item?.quantity || 0))));
    if (!productId || quantity < 1) {
      throw new HttpsError('invalid-argument', 'Invalid order line item.');
    }
    const prodSnap = await adminDb.collection('products').doc(productId).get();
    if (!prodSnap.exists || prodSnap.data()?.active !== true) {
      throw new HttpsError('not-found', `Product ${productId} is unavailable.`);
    }
    const prod = prodSnap.data()!;
    const pricePaise = Number(prod.pricePaise);
    verifiedItems.push({
      productId,
      title: String(prod.title),
      quantity,
      pricePaise,
      unitLabel: String(prod.unitLabel || ''),
    });
    totalAmountPaise += pricePaise * quantity;
  }

  const orderRef = adminDb
    .collection('societies')
    .doc(member.societyId)
    .collection('orders')
    .doc();

  await orderRef.set({
    orderId: orderRef.id,
    uid: member.uid,
    societyId: member.societyId,
    flatId: member.flatId,
    tower: member.tower,
    items: verifiedItems,
    totalAmountPaise,
    paymentStatus: 'payment_integration_pending',
    orderStatus: 'placed',
    idempotencyKey: idempotencyKey ?? orderRef.id,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  return {
    orderId: orderRef.id,
    totalAmountPaise,
    paymentStatus: 'payment_integration_pending',
  };
});

export const createServiceBooking = onCall(async (request) => {
  const member = await requireVerifiedSocietyMember(request);
  const serviceId = String(request.data?.serviceId || '').trim();
  const serviceAddress = String(request.data?.serviceAddress || '').trim().slice(0, 300);
  const preferredDate = String(request.data?.preferredDate || '').trim().slice(0, 32);
  const timeSlot = String(request.data?.timeSlot || '').trim().slice(0, 64);
  const problemDescription = String(request.data?.problemDescription || '').trim().slice(0, 1000);
  const idempotencyKey =
    typeof request.data?.idempotencyKey === 'string' ? request.data.idempotencyKey : undefined;

  if (!serviceId || serviceAddress.length < 4 || !preferredDate || !timeSlot || problemDescription.length < 5) {
    throw new HttpsError('invalid-argument', 'All service booking fields are required.');
  }

  const acquired = await claimIdempotencyKey(idempotencyKey, member.uid, 'create_service_booking');
  if (!acquired) {
    return { created: true, deduplicated: true };
  }

  const serviceSnap = await adminDb.collection('services').doc(serviceId).get();
  if (!serviceSnap.exists || serviceSnap.data()?.available !== true) {
    throw new HttpsError('not-found', 'Selected service is unavailable.');
  }
  const service = serviceSnap.data()!;

  const bookingRef = adminDb
    .collection('societies')
    .doc(member.societyId)
    .collection('serviceBookings')
    .doc();

  await bookingRef.set({
    bookingId: bookingRef.id,
    uid: member.uid,
    societyId: member.societyId,
    serviceId,
    serviceTitle: String(service.title),
    category: String(service.category),
    flatId: member.flatId,
    tower: member.tower,
    serviceAddress,
    preferredDate,
    timeSlot,
    problemDescription,
    quotedPricePaise: Number(service.startingPricePaise || 0),
    status: 'requested',
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  return { bookingId: bookingRef.id, status: 'requested' };
});
