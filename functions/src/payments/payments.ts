import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { requireVerifiedSocietyMember } from '../security/authz';

/**
 * Phase 1 Payment Boundary:
 * Do NOT implement simulated payment success.
 * Until a real Indian payment gateway (e.g., Razorpay / Cashfree) is configured with
 * server-side webhook signature verification, explicitly return failed-precondition.
 */
export const initiateOrderPayment = onCall(async (request) => {
  await requireVerifiedSocietyMember(request);
  throw new HttpsError(
    'failed-precondition',
    'Payment provider integration is pending for Phase 2. No charge was processed.'
  );
});
