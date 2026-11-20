import { FieldValue } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { adminDb, requireStaffPermission } from '../security/authz';

export interface AuditEntryInput {
  actorUid: string;
  actorEmail?: string;
  actorRole?: string;
  action: string;
  targetCollection: string;
  targetId: string;
  targetUid?: string;
  resourceType?: string;
  resourceId?: string;
  societyId?: string;
  status?: 'success' | 'denied' | 'error';
  reason?: string;
  details?: string;
  metadata?: Record<string, string | number | boolean>;
}

export async function writeAuditLog(input: AuditEntryInput): Promise<string> {
  const ref = adminDb.collection('auditLogs').doc();
  const payload: Record<string, unknown> = {
    logId: ref.id,
    actorUid: input.actorUid,
    actorEmail: input.actorEmail ?? '',
    actorRole: input.actorRole ?? '',
    action: input.action.slice(0, 100),
    targetCollection: input.targetCollection.slice(0, 100),
    targetId: input.targetId.slice(0, 128),
    targetUid: input.targetUid ?? '',
    resourceType: input.resourceType ?? input.targetCollection.slice(0, 64),
    resourceId: input.resourceId ?? input.targetId.slice(0, 128),
    societyId: input.societyId ?? '',
    status: input.status ?? 'success',
    reason: (input.reason ?? '').slice(0, 240),
    details: (input.details ?? '').slice(0, 500),
    timestamp: FieldValue.serverTimestamp(),
    createdAt: FieldValue.serverTimestamp(),
  };
  if (input.metadata) {
    payload.metadata = input.metadata;
  }
  await ref.set(payload);
  return ref.id;
}

export async function createSecurityAuditLog(input: AuditEntryInput): Promise<string> {
  return writeAuditLog(input);
}

export const createAuditLog = onCall(async (request) => {
  const caller = await requireStaffPermission(request, 'audit.view');
  const data = request.data as Partial<AuditEntryInput> | undefined;

  if (!data?.action || !data?.targetCollection || !data?.targetId) {
    throw new HttpsError('invalid-argument', 'action, targetCollection, and targetId are required.');
  }

  const logId = await writeAuditLog({
    actorUid: caller.uid,
    actorEmail: caller.email,
    actorRole: caller.roleId,
    action: String(data.action),
    targetCollection: String(data.targetCollection),
    targetId: String(data.targetId),
    targetUid: data.targetUid ? String(data.targetUid) : undefined,
    resourceType: data.resourceType ? String(data.resourceType) : undefined,
    resourceId: data.resourceId ? String(data.resourceId) : undefined,
    societyId: data.societyId ? String(data.societyId) : undefined,
    status: data.status ?? 'success',
    reason: data.reason ? String(data.reason) : undefined,
    details: data.details ? String(data.details) : undefined,
  });

  return { logId };
});
