export type AuthLifecycleState =
  | 'unauthenticated'
  | 'otp_verified'
  | 'verification_submitted'
  | 'verification_pending'
  | 'verification_rejected'
  | 'verification_approved'
  | 'society_verified'
  | 'account_suspended';

export type MembershipStatus =
  | 'not_submitted'
  | 'unverified'
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'suspended';

export type AccountStatus = 'active' | 'suspended' | 'blocked';
export type AccountType = 'customer' | 'admin' | 'staff' | 'vendor';
export type ResidentType = 'Owner' | 'Tenant';
export type FlatStatus =
  | 'Available'
  | 'Occupied'
  | 'Verification Pending'
  | 'Active'
  | 'Suspended';

export type SupportedLocale = 'en' | 'hi';

export interface UserProfile {
  uid: string;
  name: string;
  fullName?: string;
  phoneNumber?: string;
  email?: string;
  alternateContact?: string;
  societyId?: string;
  flatId?: string;
  flatNumber?: string;
  tower?: string;
  residentType?: ResidentType;
  addressConfirmed?: boolean;
  accountType?: AccountType;
  membershipStatus: MembershipStatus;
  accountStatus: AccountStatus;
  rejectionReason?: string;
  suspensionReason?: string;
  infoRequestNote?: string;
  verifiedAt?: unknown;
  verifiedBy?: string;
  fcmToken?: string;
  preferredLocale?: SupportedLocale;
  approvalAcknowledged?: boolean;
  createdAt: unknown;
  updatedAt: unknown;
}

export interface Society {
  societyId: string;
  societyName: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  invitationCode: string;
  towers?: string[];
  totalFlats?: number;
  status: 'active' | 'inactive';
  isDemo?: boolean;
  createdAt: unknown;
  updatedAt?: unknown;
}

export interface SocietyInvitation {
  code: string;
  societyId: string;
  societyName: string;
  city: string;
  active: boolean;
  createdAt: unknown;
}

export interface InvitationCodeRecord {
  codeId: string;
  societyId: string;
  societyName: string;
  city: string;
  codeHash: string;
  codePreview?: string;
  status: 'active' | 'inactive' | 'revoked' | 'expired';
  expiresAt?: string;
  maxUses: number;
  usedCount: number;
  createdBy: string;
  createdAt: unknown;
  updatedAt: unknown;
}

export interface InvitationLookupProjection {
  codeId: string;
  societyId: string;
  societyName: string;
  city: string;
  status: 'active' | 'inactive' | 'revoked' | 'expired';
  expiresAt?: string;
  maxUses: number;
  usedCount: number;
}

export interface SocietyFlat {
  flatId: string;
  societyId: string;
  tower: string;
  flatNumber: string;
  occupied: boolean;
  status: FlatStatus;
  primaryResidentUid?: string;
  residentType?: ResidentType;
  createdAt: unknown;
  updatedAt?: unknown;
}

export interface SocietyMembership {
  uid: string;
  societyId: string;
  flatId: string;
  flatNumber?: string;
  tower: string;
  residentName: string;
  residentType?: ResidentType;
  phoneNumber?: string;
  email?: string;
  alternateContact?: string;
  addressConfirmed?: boolean;
  invitationCode?: string;
  invitationCodeId?: string;
  verificationStatus: 'pending' | 'approved' | 'rejected' | 'suspended';
  rejectionReason?: string;
  suspensionReason?: string;
  infoRequestNote?: string;
  verifiedBy?: string;
  verifiedAt?: unknown;
  createdAt: unknown;
  updatedAt: unknown;
}

export interface MembershipVerificationHistory {
  historyId: string;
  uid: string;
  societyId: string;
  flatId: string;
  tower: string;
  action:
    | 'submitted'
    | 'resubmitted'
    | 'approved'
    | 'rejected'
    | 'info_requested'
    | 'suspended'
    | 'reactivated'
    | 'society_change_requested';
  previousStatus?: string;
  newStatus: string;
  actorUid: string;
  actorEmail?: string;
  note?: string;
  createdAt: unknown;
}

export interface NotificationRecord {
  notificationId: string;
  uid: string;
  societyId?: string;
  type?:
    | 'verification_submitted'
    | 'verification_approved'
    | 'verification_rejected'
    | 'info_requested'
    | 'account_suspended'
    | 'account_reactivated'
    | 'general';
  title: string;
  body: string;
  read: boolean;
  dedupeKey?: string;
  createdAt: unknown;
}

export interface BulkOfferCampaign {
  campaignId: string;
  societyId: string;
  title: string;
  description: string;
  category?: string;
  imageUrl?: string;
  regularPricePaise: number;
  offerPricePaise: number;
  minimumTarget: number;
  maximumCapacity: number;
  currentParticipants: number;
  bookingDeadline: string;
  scheduledDate: string;
  status: 'draft' | 'active' | 'target_met' | 'closed' | 'cancelled';
  createdAt: unknown;
  updatedAt?: unknown;
}

export interface GroupBuyCampaign {
  campaignId: string;
  societyId: string;
  title: string;
  description: string;
  unitLabel?: string;
  imageUrl?: string;
  marketPricePaise: number;
  groupPricePaise: number;
  minimumGroupQuantity: number;
  maximumGroupQuantity?: number;
  currentQuantity: number;
  deadline: string;
  expectedDeliveryDate: string;
  status: 'draft' | 'active' | 'target_met' | 'closed' | 'cancelled';
  createdAt: unknown;
  updatedAt?: unknown;
}

export interface CampaignParticipation {
  participationId: string;
  uid: string;
  societyId: string;
  campaignId: string;
  campaignType: 'bulk_offer' | 'group_buy';
  campaignTitle: string;
  quantity: number;
  unitPricePaise: number;
  flatId: string;
  tower: string;
  status: 'joined' | 'confirmed' | 'cancelled';
  createdAt: unknown;
}

export interface OrderItem {
  productId: string;
  title: string;
  quantity: number;
  pricePaise: number;
  unitLabel?: string;
}

export interface Order {
  orderId: string;
  uid: string;
  societyId: string;
  flatId: string;
  tower: string;
  items: OrderItem[];
  totalAmountPaise: number;
  paymentStatus: 'payment_integration_pending' | 'pending' | 'paid' | 'failed' | 'refunded';
  orderStatus: 'placed' | 'confirmed' | 'packed' | 'out_for_delivery' | 'delivered' | 'cancelled';
  idempotencyKey?: string;
  createdAt: unknown;
  updatedAt: unknown;
}

export interface Product {
  productId: string;
  title: string;
  description: string;
  category: string;
  imageUrl?: string;
  mrpPaise: number;
  pricePaise: number;
  unitLabel: string;
  stockQuantity: number;
  active: boolean;
  createdAt: unknown;
}

export interface ServiceCatalogItem {
  serviceId: string;
  title: string;
  category: string;
  description: string;
  instructions?: string;
  imageUrl?: string;
  startingPricePaise: number;
  available: boolean;
  createdAt: unknown;
}

export interface ServiceBooking {
  bookingId: string;
  uid: string;
  societyId: string;
  serviceId: string;
  serviceTitle: string;
  category: string;
  flatId: string;
  tower: string;
  serviceAddress: string;
  preferredDate: string;
  timeSlot: string;
  problemDescription: string;
  quotedPricePaise?: number;
  status: 'requested' | 'assigned' | 'in_progress' | 'completed' | 'cancelled';
  assignedVendorId?: string;
  createdAt: unknown;
  updatedAt: unknown;
}

export interface StaffMember {
  staffId: string;
  uid: string;
  name: string;
  email: string;
  roleId: string;
  assignedSocietyIds?: string[];
  status: 'active' | 'suspended';
  createdAt: unknown;
}

export interface RoleDefinition {
  roleId: string;
  name: string;
  description?: string;
  permissions: string[];
  createdAt: unknown;
}

export interface AuditLog {
  logId: string;
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
  timestamp?: unknown;
  createdAt: unknown;
}
