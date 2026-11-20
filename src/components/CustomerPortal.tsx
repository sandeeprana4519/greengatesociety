import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Bell,
  Building2,
  CheckCircle2,
  Clock,
  Home,
  Languages,
  MapPin,
  Phone,
  Search,
  ShieldCheck,
  ShoppingBag,
  ShoppingCart,
  User as UserIcon,
  Wrench,
  X,
} from 'lucide-react';
import {
  collection,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import type {
  BulkOfferCampaign,
  CampaignParticipation,
  GroupBuyCampaign,
  NotificationRecord,
  Order,
  Product,
  ResidentType,
  ServiceBooking,
  ServiceCatalogItem,
  Society,
} from '@society-marketplace/shared-types';
import {
  I18N_STRINGS,
  OTP_SECURITY_CONFIG,
  PRODUCT_CATEGORIES,
  SERVICE_CATEGORIES,
  SERVICE_TIME_SLOTS,
} from '@society-marketplace/constants';
import {
  calculateSavingsPaise,
  calculateSavingsPercent,
  calculateTargetProgress,
  formatINRFromPaise,
  formatReadableDate,
} from '@society-marketplace/business-logic';
import {
  validateEmailOptional,
  validateIndianPhone,
  validateInvitationCode,
  validateServiceBookingInput,
  validateSocietyVerificationInput,
} from '@society-marketplace/validation';
import { useAppAuth, type ValidatedInviteResult } from '../contexts/AppAuthContext';
import { OperationType, db, handleFirestoreError } from '../lib/firebase';
import { SafeImage } from './SafeImage';

type CustomerTab = 'home' | 'buy' | 'services';
type AuthEntryStep = 'welcome' | 'mobile';
type OnboardingStep = 'invite' | 'profile' | 'flat';

export function CustomerPortal({
  onSwitchToAdmin,
}: {
  onSwitchToAdmin: () => void;
}) {
  const {
    firebaseUser,
    profile,
    lifecycleState,
    locale,
    setLocale,
    loading,
    signInWithGoogle,
    sendPhoneOtp,
    confirmPhoneOtp,
    otpSent,
    otpCooldownSeconds,
    otpVerifyAttempts,
    otpLockedUntilMs,
    resetOtpState,
    lookupInvitation,
    submitSocietyVerification,
    acknowledgeVerificationApproval,
    updateAllowedProfile,
    requestSocietyChange,
    logout,
  } = useAppAuth();

  const t = I18N_STRINGS[locale];
  const [activeTab, setActiveTab] = useState<CustomerTab>('home');

  // Auth steps (Screens 2, 3, 4)
  const [authEntryStep, setAuthEntryStep] = useState<AuthEntryStep>('welcome');
  const [phoneInput, setPhoneInput] = useState('+91');
  const [otpInput, setOtpInput] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [authSubmitting, setAuthSubmitting] = useState(false);

  // Onboarding steps (Screens 5, 6, 7, 8, 10)
  const [onboardingStep, setOnboardingStep] = useState<OnboardingStep>('invite');
  const [resubmittingRejected, setResubmittingRejected] = useState(false);
  const [justSubmitted, setJustSubmitted] = useState(false);
  const [inviteCode, setInviteCode] = useState('');
  const [matchedSociety, setMatchedSociety] = useState<ValidatedInviteResult | null>(null);
  const [residentName, setResidentName] = useState('');
  const [residentType, setResidentType] = useState<ResidentType>('Owner');
  const [emailInput, setEmailInput] = useState('');
  const [altContactInput, setAltContactInput] = useState('');
  const [towerInput, setTowerInput] = useState('');
  const [flatInput, setFlatInput] = useState('');
  const [addressConfirmed, setAddressConfirmed] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [verifyLoading, setVerifyLoading] = useState(false);

  // Marketplace Firestore data (ONLY loaded when society_verified)
  const [society, setSociety] = useState<Society | null>(null);
  const [bulkOffers, setBulkOffers] = useState<BulkOfferCampaign[]>([]);
  const [groupOffers, setGroupOffers] = useState<GroupBuyCampaign[]>([]);
  const [participations, setParticipations] = useState<CampaignParticipation[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [bookings, setBookings] = useState<ServiceBooking[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [services, setServices] = useState<ServiceCatalogItem[]>([]);
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);

  // Drawers & Modals (including Screen 13 Profile & Society Change)
  const [showProfileDrawer, setShowProfileDrawer] = useState(false);
  const [showNotifDrawer, setShowNotifDrawer] = useState(false);
  const [editingProfile, setEditingProfile] = useState(false);
  const [profileNameEdit, setProfileNameEdit] = useState('');
  const [profileEmailEdit, setProfileEmailEdit] = useState('');
  const [profileAltEdit, setProfileAltEdit] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  const [showSocietyChangeModal, setShowSocietyChangeModal] = useState(false);
  const [changeSocCode, setChangeSocCode] = useState('');
  const [changeSocTower, setChangeSocTower] = useState('');
  const [changeSocFlat, setChangeSocFlat] = useState('');
  const [changeSocType, setChangeSocType] = useState<ResidentType>('Owner');
  const [changeSocError, setChangeSocError] = useState<string | null>(null);
  const [changeSocSaving, setChangeSocSaving] = useState(false);

  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [actionToast, setActionToast] = useState<string | null>(null);

  // Buy tab state
  const [productSearch, setProductSearch] = useState('');
  const [productCategory, setProductCategory] = useState<string>('All');
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [showCartDrawer, setShowCartDrawer] = useState(false);
  const [placingOrder, setPlacingOrder] = useState(false);

  // Services tab state
  const [selectedServiceCat, setSelectedServiceCat] = useState<string>('All');
  const [bookingService, setBookingService] = useState<ServiceCatalogItem | null>(null);
  const [serviceAddress, setServiceAddress] = useState('');
  const [preferredDate, setPreferredDate] = useState('2026-12-01');
  const [timeSlot, setTimeSlot] = useState<string>(SERVICE_TIME_SLOTS[0]);
  const [problemDesc, setProblemDesc] = useState('');
  const [bookingSubmitting, setBookingSubmitting] = useState(false);
  const [bookingError, setBookingError] = useState<string | null>(null);

  useEffect(() => {
    const bestName = profile?.fullName || profile?.name;
    if (bestName && !residentName) {
      setResidentName(bestName);
    }
    if (profile?.email && !emailInput) {
      setEmailInput(profile.email);
    }
    if (profile?.alternateContact && !altContactInput) {
      setAltContactInput(profile.alternateContact);
    }
    if (profile?.tower && (profile?.flatNumber || profile?.flatId) && !serviceAddress) {
      setServiceAddress(`${profile.tower}, Flat ${profile.flatNumber || profile.flatId}`);
    }
  }, [
    profile?.fullName,
    profile?.name,
    profile?.email,
    profile?.alternateContact,
    profile?.tower,
    profile?.flatNumber,
    profile?.flatId,
    residentName,
    emailInput,
    altContactInput,
    serviceAddress,
  ]);

  // Notifications subscription for authenticated customers (even during verification pending/rejected)
  useEffect(() => {
    if (!firebaseUser?.uid || !db) return;
    const unsubNotifs = onSnapshot(
      query(collection(db, 'notifications'), where('uid', '==', firebaseUser.uid)),
      (snap) => setNotifications(snap.docs.map((d) => d.data() as NotificationRecord)),
      () => {}
    );
    return () => unsubNotifs();
  }, [firebaseUser?.uid]);

  // Real-time Firestore subscriptions for verified society residents ONLY
  useEffect(() => {
    if (
      (lifecycleState !== 'society_verified' && lifecycleState !== 'verification_approved') ||
      !profile?.societyId ||
      !firebaseUser?.uid
    ) {
      return;
    }

    const societyId = profile.societyId;
    const uid = firebaseUser.uid;

    const unsubSoc = onSnapshot(
      doc(db, 'societies', societyId),
      (snap) => setSociety(snap.exists() ? (snap.data() as Society) : null),
      (err) => handleFirestoreError(err, OperationType.GET, `societies/${societyId}`)
    );

    const unsubBulk = onSnapshot(
      query(collection(db, 'societies', societyId, 'campaigns'), where('societyId', '==', societyId)),
      (snap) =>
        setBulkOffers(
          snap.docs
            .map((d) => d.data() as BulkOfferCampaign)
            .filter((c) => c.status === 'active' || c.status === 'target_met')
        ),
      (err) => handleFirestoreError(err, OperationType.LIST, `societies/${societyId}/campaigns`)
    );

    const unsubGroup = onSnapshot(
      query(
        collection(db, 'societies', societyId, 'groupCampaigns'),
        where('societyId', '==', societyId)
      ),
      (snap) =>
        setGroupOffers(
          snap.docs
            .map((d) => d.data() as GroupBuyCampaign)
            .filter((c) => c.status === 'active' || c.status === 'target_met')
        ),
      (err) =>
        handleFirestoreError(err, OperationType.LIST, `societies/${societyId}/groupCampaigns`)
    );

    const unsubParts = onSnapshot(
      query(
        collection(db, 'societies', societyId, 'participations'),
        where('societyId', '==', societyId),
        where('uid', '==', uid)
      ),
      (snap) => setParticipations(snap.docs.map((d) => d.data() as CampaignParticipation)),
      (err) =>
        handleFirestoreError(err, OperationType.LIST, `societies/${societyId}/participations`)
    );

    const unsubOrders = onSnapshot(
      query(
        collection(db, 'societies', societyId, 'orders'),
        where('societyId', '==', societyId),
        where('uid', '==', uid)
      ),
      (snap) => setOrders(snap.docs.map((d) => d.data() as Order)),
      (err) => handleFirestoreError(err, OperationType.LIST, `societies/${societyId}/orders`)
    );

    const unsubBookings = onSnapshot(
      query(
        collection(db, 'societies', societyId, 'serviceBookings'),
        where('societyId', '==', societyId),
        where('uid', '==', uid)
      ),
      (snap) => setBookings(snap.docs.map((d) => d.data() as ServiceBooking)),
      (err) =>
        handleFirestoreError(err, OperationType.LIST, `societies/${societyId}/serviceBookings`)
    );

    const unsubProducts = onSnapshot(
      collection(db, 'products'),
      (snap) => setProducts(snap.docs.map((d) => d.data() as Product).filter((p) => p.active)),
      (err) => handleFirestoreError(err, OperationType.LIST, 'products')
    );

    const unsubServices = onSnapshot(
      collection(db, 'services'),
      (snap) =>
        setServices(
          snap.docs.map((d) => d.data() as ServiceCatalogItem).filter((s) => s.available)
        ),
      (err) => handleFirestoreError(err, OperationType.LIST, 'services')
    );

    return () => {
      unsubSoc();
      unsubBulk();
      unsubGroup();
      unsubParts();
      unsubOrders();
      unsubBookings();
      unsubProducts();
      unsubServices();
    };
  }, [lifecycleState, profile?.societyId, firebaseUser?.uid]);

  const showToast = (msg: string) => {
    setActionToast(msg);
    setTimeout(() => setActionToast(null), 4500);
  };

  const unreadNotifCount = useMemo(
    () => notifications.filter((n) => !n.read).length,
    [notifications]
  );

  // Cart totals in integer paise
  const cartItems = useMemo(() => {
    return Object.entries(cart)
      .filter(([, qty]) => qty > 0)
      .map(([productId, quantity]) => {
        const product = products.find((p) => p.productId === productId);
        return product ? { product, quantity } : null;
      })
      .filter((item): item is { product: Product; quantity: number } => Boolean(item));
  }, [cart, products]);

  const cartTotalPaise = useMemo(
    () => cartItems.reduce((sum, item) => sum + item.product.pricePaise * item.quantity, 0),
    [cartItems]
  );

  const totalCartCount = useMemo(
    () => cartItems.reduce((sum, item) => sum + item.quantity, 0),
    [cartItems]
  );

  // Auth & Verification Handlers
  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    const check = validateIndianPhone(phoneInput);
    if (!check.valid) {
      setAuthError(check.error ?? 'Enter a valid +91 phone number.');
      return;
    }
    setAuthSubmitting(true);
    try {
      await sendPhoneOtp(phoneInput, 'recaptcha-container');
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Unable to send OTP.');
    } finally {
      setAuthSubmitting(false);
    }
  };

  const handleResendOtp = async () => {
    if (otpCooldownSeconds > 0) return;
    setAuthError(null);
    setAuthSubmitting(true);
    try {
      await sendPhoneOtp(phoneInput, 'recaptcha-container');
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Unable to resend OTP.');
    } finally {
      setAuthSubmitting(false);
    }
  };

  const handleConfirmOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    if (otpInput.trim().length !== 6) {
      setAuthError('Enter the 6-digit OTP code.');
      return;
    }
    setAuthSubmitting(true);
    try {
      await confirmPhoneOtp(otpInput);
      setOtpInput('');
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Invalid OTP code.');
    } finally {
      setAuthSubmitting(false);
    }
  };

  const handleValidateInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setVerifyError(null);
    const codeCheck = validateInvitationCode(inviteCode);
    if (!codeCheck.valid) {
      setVerifyError(codeCheck.error ?? 'Invalid invitation code format.');
      return;
    }
    setVerifyLoading(true);
    try {
      const invite = await lookupInvitation(inviteCode);
      setMatchedSociety(invite);
      setOnboardingStep('profile');
    } catch (err) {
      setVerifyError(err instanceof Error ? err.message : 'Invalid invitation code.');
    } finally {
      setVerifyLoading(false);
    }
  };

  const handleContinueToFlatStep = (e: React.FormEvent) => {
    e.preventDefault();
    setVerifyError(null);
    if (residentName.trim().length < 2) {
      setVerifyError('Resident full name must be at least 2 characters.');
      return;
    }
    const emailCheck = validateEmailOptional(emailInput);
    if (!emailCheck.valid) {
      setVerifyError(emailCheck.error ?? 'Enter a valid email.');
      return;
    }
    if (altContactInput.trim()) {
      const altCheck = validateIndianPhone(altContactInput);
      if (!altCheck.valid) {
        setVerifyError('Alternate contact must be a valid Indian +91 mobile number.');
        return;
      }
    }
    setOnboardingStep('flat');
  };

  const handleSubmitVerification = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!matchedSociety) return;
    setVerifyError(null);

    const check = validateSocietyVerificationInput({
      residentName,
      tower: towerInput,
      flatId: flatInput,
      invitationCode: inviteCode,
      residentType,
      email: emailInput,
      alternateContact: altContactInput,
      addressConfirmed,
    });
    if (!check.valid) {
      setVerifyError(check.error ?? 'Check your verification details.');
      return;
    }

    setVerifyLoading(true);
    try {
      await submitSocietyVerification({
        invitationCode: inviteCode,
        codeHash: matchedSociety.codeHash,
        codeId: matchedSociety.codeId,
        societyId: matchedSociety.societyId,
        residentName,
        residentType,
        tower: towerInput,
        flatNumber: flatInput,
        email: emailInput,
        alternateContact: altContactInput,
        addressConfirmed,
      });
      setResubmittingRejected(false);
      setJustSubmitted(true);
    } catch (err) {
      setVerifyError(err instanceof Error ? err.message : 'Unable to submit verification.');
    } finally {
      setVerifyLoading(false);
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileError(null);
    const emailCheck = validateEmailOptional(profileEmailEdit);
    if (!emailCheck.valid) {
      setProfileError(emailCheck.error ?? 'Invalid email');
      return;
    }
    if (profileAltEdit.trim()) {
      const altCheck = validateIndianPhone(profileAltEdit);
      if (!altCheck.valid) {
        setProfileError('Alternate contact must be a valid +91 mobile number.');
        return;
      }
    }
    setProfileSaving(true);
    try {
      await updateAllowedProfile({
        fullName: profileNameEdit,
        email: profileEmailEdit,
        alternateContact: profileAltEdit,
        preferredLocale: locale,
      });
      setEditingProfile(false);
      showToast('Resident profile updated.');
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : 'Could not update profile.');
    } finally {
      setProfileSaving(false);
    }
  };

  const handleSocietyChangeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setChangeSocError(null);
    if (!changeSocCode.trim() || !changeSocTower.trim() || !changeSocFlat.trim()) {
      setChangeSocError('Invitation code, tower, and flat number are required.');
      return;
    }
    setChangeSocSaving(true);
    try {
      await requestSocietyChange({
        invitationCode: changeSocCode,
        tower: changeSocTower,
        flatNumber: changeSocFlat,
        residentType: changeSocType,
      });
      setShowSocietyChangeModal(false);
      setShowProfileDrawer(false);
      showToast('Society change submitted for admin re-verification.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setChangeSocError(
        msg.includes('not-found') || msg.includes('internal') || msg.includes('Failed to fetch')
          ? 'Society transfer requires deployed Firebase Cloud Functions (changeResidentSociety) so your verified access moves safely into re-verification.'
          : msg
      );
    } finally {
      setChangeSocSaving(false);
    }
  };

  const handleMarkNotificationRead = async (notificationId: string) => {
    try {
      await updateDoc(doc(db, 'notifications', notificationId), { read: true });
    } catch {
      // ignore
    }
  };

  const handleJoinCampaign = async (
    campaignId: string,
    campaignType: 'bulk_offer' | 'group_buy',
    campaignTitle: string,
    unitPricePaise: number
  ) => {
    if (!profile?.societyId || !firebaseUser?.uid) return;
    setJoiningId(campaignId);
    const partId = `part_${firebaseUser.uid.slice(0, 8)}_${campaignId}_${Date.now()}`;
    const path = `societies/${profile.societyId}/participations/${partId}`;
    try {
      await setDoc(doc(db, 'societies', profile.societyId, 'participations', partId), {
        participationId: partId,
        uid: firebaseUser.uid,
        societyId: profile.societyId,
        campaignId,
        campaignType,
        campaignTitle,
        quantity: 1,
        unitPricePaise,
        flatId: profile.flatNumber || profile.flatId || 'N/A',
        tower: profile.tower || 'N/A',
        status: 'joined',
        createdAt: serverTimestamp(),
      });
      showToast(
        `Joined "${campaignTitle}". Participation recorded for ${profile.tower} ${profile.flatNumber || profile.flatId}.`
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, path);
    } finally {
      setJoiningId(null);
    }
  };

  const handlePlaceOrder = async () => {
    if (!profile?.societyId || !firebaseUser?.uid || cartItems.length === 0) return;
    setPlacingOrder(true);
    const orderId = `ord_${Date.now()}_${firebaseUser.uid.slice(0, 6)}`;
    const path = `societies/${profile.societyId}/orders/${orderId}`;
    try {
      await setDoc(doc(db, 'societies', profile.societyId, 'orders', orderId), {
        orderId,
        uid: firebaseUser.uid,
        societyId: profile.societyId,
        flatId: profile.flatNumber || profile.flatId || 'N/A',
        tower: profile.tower || 'N/A',
        items: cartItems.map((c) => ({
          productId: c.product.productId,
          title: c.product.title,
          quantity: c.quantity,
          pricePaise: c.product.pricePaise,
          unitLabel: c.product.unitLabel,
        })),
        totalAmountPaise: cartTotalPaise,
        paymentStatus: 'payment_integration_pending',
        orderStatus: 'placed',
        idempotencyKey: orderId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setCart({});
      setShowCartDrawer(false);
      showToast(`Order #${orderId.slice(-6)} placed with Payment Integration Pending status.`);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, path);
    } finally {
      setPlacingOrder(false);
    }
  };

  const handleCancelOrder = async (orderId: string) => {
    if (!profile?.societyId) return;
    const path = `societies/${profile.societyId}/orders/${orderId}`;
    try {
      await updateDoc(doc(db, 'societies', profile.societyId, 'orders', orderId), {
        orderStatus: 'cancelled',
        updatedAt: serverTimestamp(),
      });
      showToast('Order cancelled.');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, path);
    }
  };

  const handleSubmitServiceBooking = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bookingService || !profile?.societyId || !firebaseUser?.uid) return;
    setBookingError(null);

    const check = validateServiceBookingInput({
      serviceId: bookingService.serviceId,
      serviceAddress,
      preferredDate,
      timeSlot,
      problemDescription: problemDesc,
    });
    if (!check.valid) {
      setBookingError(check.error ?? 'Check booking details.');
      return;
    }

    setBookingSubmitting(true);
    const bookingId = `bk_${Date.now()}_${firebaseUser.uid.slice(0, 6)}`;
    const path = `societies/${profile.societyId}/serviceBookings/${bookingId}`;
    try {
      await setDoc(doc(db, 'societies', profile.societyId, 'serviceBookings', bookingId), {
        bookingId,
        uid: firebaseUser.uid,
        societyId: profile.societyId,
        serviceId: bookingService.serviceId,
        serviceTitle: bookingService.title,
        category: bookingService.category,
        flatId: profile.flatNumber || profile.flatId || 'N/A',
        tower: profile.tower || 'N/A',
        serviceAddress: serviceAddress.trim(),
        preferredDate,
        timeSlot,
        problemDescription: problemDesc.trim(),
        quotedPricePaise: bookingService.startingPricePaise,
        status: 'requested',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setBookingService(null);
      setProblemDesc('');
      showToast(`Service request submitted for ${bookingService.title}.`);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, path);
    } finally {
      setBookingSubmitting(false);
    }
  };

  // SCREEN 1: SPLASH / SESSION RESTORATION
  if (loading) {
    return (
      <div className="max-w-md mx-auto px-4 py-20 text-center">
        <div className="bg-white border border-slate-200 rounded-2xl p-8">
          <div className="w-12 h-12 rounded-2xl bg-[#0F3D2E] text-white font-bold text-lg mx-auto flex items-center justify-center">
            GG
          </div>
          <h1 className="mt-4 text-lg font-bold text-slate-900">GreenGate Society Marketplace</h1>
          <p className="mt-1.5 text-sm text-slate-600">
            Restoring encrypted Firebase Authentication & society verification session...
          </p>
        </div>
      </div>
    );
  }

  // SCREENS 2, 3, 4: LOGIN -> MOBILE ENTRY -> OTP VERIFICATION
  if (lifecycleState === 'unauthenticated') {
    const isOtpLocked = Boolean(otpLockedUntilMs && Date.now() < otpLockedUntilMs);
    return (
      <div className="max-w-5xl mx-auto px-4 py-10">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
          <div className="lg:col-span-6 rounded-2xl overflow-hidden border border-slate-200 bg-white flex flex-col">
            <SafeImage
              src="/src/assets/images/society_hero_courtyard_1795187599564.jpg"
              alt="Residential society courtyard"
              className="w-full h-64 lg:h-full object-cover"
            />
          </div>

          <div className="lg:col-span-6 bg-white border border-slate-200 rounded-2xl p-6 lg:p-8 flex flex-col justify-center">
            <div id="recaptcha-container" />

            {otpSent ? (
              /* SCREEN 4: OTP VERIFICATION */
              <div>
                <button
                  type="button"
                  onClick={() => {
                    resetOtpState();
                    setAuthError(null);
                  }}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Change Mobile Number</span>
                </button>
                <h1 className="mt-3 text-2xl font-bold text-slate-900">Verify 6-Digit OTP</h1>
                <p className="mt-1.5 text-sm text-slate-600">
                  Firebase Phone Authentication sent an SMS verification code to{' '}
                  <span className="font-mono font-semibold text-slate-900">{phoneInput}</span>.
                </p>

                <form onSubmit={handleConfirmOtp} className="mt-5 space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1.5">
                      6-Digit Verification Code
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={6}
                      value={otpInput}
                      onChange={(e) => setOtpInput(e.target.value.replace(/\D/g, ''))}
                      placeholder="••••••"
                      className="w-full px-4 py-3 text-lg font-mono tracking-[0.4em] text-center bg-white border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#0F3D2E]"
                    />
                  </div>

                  {otpVerifyAttempts > 0 ? (
                    <div className="text-xs text-slate-500 font-mono tabular-nums">
                      Attempts used: {otpVerifyAttempts} / {OTP_SECURITY_CONFIG.MAX_VERIFY_ATTEMPTS}
                    </div>
                  ) : null}

                  <button
                    type="submit"
                    disabled={authSubmitting || isOtpLocked}
                    className="w-full py-2.5 px-4 rounded-xl bg-[#0F3D2E] text-white text-sm font-semibold hover:bg-[#0B2E22] disabled:opacity-50"
                  >
                    {authSubmitting ? 'Verifying OTP...' : 'Verify & Continue'}
                  </button>
                </form>

                <div className="mt-4 flex items-center justify-between text-xs">
                  <button
                    type="button"
                    disabled={otpCooldownSeconds > 0 || authSubmitting}
                    onClick={handleResendOtp}
                    className="font-semibold text-[#0F3D2E] disabled:text-slate-400"
                  >
                    {otpCooldownSeconds > 0
                      ? `Resend OTP in ${otpCooldownSeconds}s`
                      : 'Resend OTP'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      resetOtpState();
                      setAuthEntryStep('mobile');
                    }}
                    className="text-slate-600 hover:underline"
                  >
                    Edit Number
                  </button>
                </div>
              </div>
            ) : authEntryStep === 'mobile' ? (
              /* SCREEN 3: MOBILE NUMBER ENTRY */
              <div>
                <button
                  type="button"
                  onClick={() => {
                    setAuthEntryStep('welcome');
                    setAuthError(null);
                  }}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Back</span>
                </button>
                <p className="mt-3 text-xs font-medium text-[#0F3D2E]">
                  Step 1 of 2 · Phone OTP Sign-In
                </p>
                <h1 className="mt-1 text-2xl font-bold text-slate-900">
                  Enter Your Indian Mobile Number
                </h1>
                <p className="mt-1.5 text-sm text-slate-600">
                  We use real Firebase Phone Authentication. Phone sign-in verifies your number only; society approval is required in the next step.
                </p>

                <form onSubmit={handleSendOtp} className="mt-6 space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1.5">
                      Mobile Number (+91)
                    </label>
                    <input
                      type="tel"
                      value={phoneInput}
                      onChange={(e) => setPhoneInput(e.target.value)}
                      placeholder="+919876543210"
                      className="w-full px-3.5 py-2.5 text-sm font-mono bg-white border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#0F3D2E]"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={authSubmitting || otpCooldownSeconds > 0}
                    className="w-full py-2.5 px-4 rounded-xl bg-[#0F3D2E] text-white text-sm font-semibold hover:bg-[#0B2E22] disabled:opacity-60"
                  >
                    {authSubmitting
                      ? 'Sending SMS OTP...'
                      : otpCooldownSeconds > 0
                      ? `Wait ${otpCooldownSeconds}s`
                      : 'Send Mobile OTP'}
                  </button>
                </form>
              </div>
            ) : (
              /* SCREEN 2: WELCOME / LOGIN ENTRY */
              <div>
                <p className="text-xs font-medium text-[#0F3D2E]">Resident Access Portal</p>
                <h1 className="mt-2 text-2xl lg:text-3xl font-bold text-slate-900 text-balance">
                  Group buying & trusted home services for your residential society
                </h1>
                <p className="mt-2 text-sm text-slate-600 leading-relaxed">
                  Every resident verifies their mobile number and residential society invitation code before marketplace deals unlock.
                </p>

                <div className="mt-6 space-y-3">
                  <button
                    type="button"
                    onClick={() => setAuthEntryStep('mobile')}
                    className="w-full py-3 px-4 rounded-xl bg-[#0F3D2E] text-white text-sm font-semibold hover:bg-[#0B2E22] flex items-center justify-center gap-2 transition-colors"
                  >
                    <Phone className="w-4 h-4" />
                    <span>Continue with Mobile Number (OTP)</span>
                  </button>

                  <div className="flex items-center gap-3 text-xs text-slate-400">
                    <div className="h-px flex-1 bg-slate-200" />
                    <span>or</span>
                    <div className="h-px flex-1 bg-slate-200" />
                  </div>

                  <button
                    type="button"
                    onClick={async () => {
                      setAuthError(null);
                      try {
                        await signInWithGoogle();
                      } catch (err) {
                        setAuthError(err instanceof Error ? err.message : 'Google Sign-In failed.');
                      }
                    }}
                    className="w-full py-2.5 px-4 rounded-xl border border-slate-300 bg-white text-slate-800 text-sm font-semibold hover:bg-slate-50 transition-colors"
                  >
                    Continue with Google Account
                  </button>
                </div>
              </div>
            )}

            {authError ? (
              <div className="mt-4 p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700 leading-relaxed">
                {authError}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  // SCREEN 11: ACCOUNT SUSPENDED / BLOCKED
  if (lifecycleState === 'account_suspended') {
    return (
      <div className="max-w-lg mx-auto px-4 py-16">
        <div className="bg-white border border-red-200 rounded-2xl p-7">
          <div className="flex items-center gap-2 text-red-700 text-xs font-semibold">
            <AlertTriangle className="w-4 h-4" />
            <span>Access Blocked</span>
          </div>
          <h1 className="mt-2 text-xl font-bold text-red-700">{t.accountSuspendedTitle}</h1>
          <p className="mt-2 text-sm text-slate-600 leading-relaxed">
            Your resident account has been suspended by society administration. Marketplace campaigns, Buy Now ordering, and service bookings are disabled.
          </p>
          {profile?.suspensionReason ? (
            <div className="mt-4 p-3.5 rounded-xl bg-red-50 border border-red-200 text-xs text-red-800">
              Reason: {profile.suspensionReason}
            </div>
          ) : null}
          <button
            onClick={logout}
            className="mt-6 px-4 py-2.5 rounded-xl bg-slate-900 text-white text-sm font-medium"
          >
            Sign Out
          </button>
        </div>
      </div>
    );
  }

  // SCREEN 8: VERIFICATION SUBMITTED CONFIRMATION (Immediate post-submit screen)
  if (justSubmitted && lifecycleState === 'verification_pending') {
    return (
      <div className="max-w-xl mx-auto px-4 py-14">
        <div className="bg-white border border-emerald-200 rounded-2xl p-8">
          <div className="w-11 h-11 rounded-full bg-emerald-50 text-[#0F3D2E] flex items-center justify-center">
            <CheckCircle2 className="w-6 h-6" />
          </div>
          <h1 className="mt-4 text-2xl font-bold text-slate-900">
            Society Verification Submitted
          </h1>
          <p className="mt-2 text-sm text-slate-600 leading-relaxed">
            Thank you, <span className="font-semibold text-slate-900">{residentName}</span>. Your{' '}
            <span className="font-semibold">{residentType}</span> registration for{' '}
            <span className="font-semibold text-slate-900">
              {matchedSociety?.societyName} · {towerInput} · Flat {flatInput}
            </span>{' '}
            has been sent to your society administrator.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <button
              onClick={() => setJustSubmitted(false)}
              className="px-4 py-2.5 rounded-xl bg-[#0F3D2E] text-white text-sm font-semibold hover:bg-[#0B2E22]"
            >
              View Live Verification Status
            </button>
            <button
              onClick={onSwitchToAdmin}
              className="px-4 py-2.5 rounded-xl border border-slate-300 text-sm font-medium text-slate-700"
            >
              Review in Admin Console
            </button>
          </div>
        </div>
      </div>
    );
  }

  // SCREEN 9: VERIFICATION PENDING
  if (lifecycleState === 'verification_pending') {
    return (
      <div className="max-w-xl mx-auto px-4 py-14">
        <div className="bg-white border border-slate-200 rounded-2xl p-8">
          <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-700">
            <Clock className="w-4 h-4" />
            <span>Verification Status · Pending Admin Review</span>
          </div>
          <h1 className="mt-2 text-2xl font-bold text-slate-900">
            {t.verificationPendingTitle}
          </h1>
          <p className="mt-2 text-sm text-slate-600 leading-relaxed">
            Your flat verification application for{' '}
            <span className="font-semibold text-slate-900">
              {profile?.tower} · Flat {profile?.flatNumber || profile?.flatId}
            </span>{' '}
            ({profile?.residentType || 'Resident'}) is queued for society office approval. Marketplace offers, Buy Now orders, and Services stay locked until approved.
          </p>

          {profile?.infoRequestNote ? (
            <div className="mt-4 p-4 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900">
              <div className="font-semibold">Admin Clarification Note:</div>
              <div className="mt-1">{profile.infoRequestNote}</div>
            </div>
          ) : null}

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button
              onClick={onSwitchToAdmin}
              className="px-4 py-2.5 rounded-xl bg-[#0F3D2E] text-white text-sm font-medium hover:bg-[#0B2E22]"
            >
              Review in Admin Console
            </button>
            <button
              onClick={logout}
              className="px-4 py-2.5 rounded-xl border border-slate-300 text-sm font-medium text-slate-700"
            >
              Sign Out
            </button>
          </div>
        </div>
      </div>
    );
  }

  // SCREEN 10: VERIFICATION REJECTED
  if (lifecycleState === 'verification_rejected' && !resubmittingRejected) {
    return (
      <div className="max-w-xl mx-auto px-4 py-14">
        <div className="bg-white border border-red-200 rounded-2xl p-8">
          <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-700">
            <AlertTriangle className="w-4 h-4" />
            <span>Verification Declined</span>
          </div>
          <h1 className="mt-2 text-2xl font-bold text-slate-900">{t.verificationRejectedTitle}</h1>
          <p className="mt-2 text-sm text-slate-600">
            Your application for {profile?.tower} · Flat {profile?.flatNumber || profile?.flatId} was not approved.
          </p>
          <div className="mt-4 p-4 rounded-xl bg-red-50 border border-red-200 text-xs text-red-800">
            <span className="font-semibold">Administrator Reason: </span>
            {profile?.rejectionReason || 'Flat details could not be matched with society records.'}
          </div>
          <div className="mt-6 flex flex-wrap gap-3">
            <button
              onClick={() => {
                setResubmittingRejected(true);
                setOnboardingStep('invite');
                setMatchedSociety(null);
              }}
              className="px-4 py-2.5 rounded-xl bg-[#0F3D2E] text-white text-sm font-semibold hover:bg-[#0B2E22]"
            >
              Correct Details & Resubmit
            </button>
            <button
              onClick={logout}
              className="px-4 py-2.5 rounded-xl border border-slate-300 text-sm font-medium text-slate-700"
            >
              Sign Out
            </button>
          </div>
        </div>
      </div>
    );
  }

  // SCREENS 5, 6, 7: SOCIETY INVITATION -> REGISTRATION -> TOWER & FLAT DETAILS
  if (lifecycleState === 'otp_verified' || (lifecycleState === 'verification_rejected' && resubmittingRejected)) {
    return (
      <div className="max-w-xl mx-auto px-4 py-12">
        <div className="bg-white border border-slate-200 rounded-2xl p-6 lg:p-8">
          <div className="flex items-center justify-between text-xs font-medium text-[#0F3D2E]">
            <span>
              {onboardingStep === 'invite'
                ? 'Step 1 of 3 · Society Invitation Code'
                : onboardingStep === 'profile'
                ? 'Step 2 of 3 · Resident Details'
                : 'Step 3 of 3 · Tower & Flat Confirmation'}
            </span>
            {onboardingStep !== 'invite' ? (
              <button
                type="button"
                onClick={() =>
                  setOnboardingStep(onboardingStep === 'flat' ? 'profile' : 'invite')
                }
                className="text-slate-600 hover:underline"
              >
                Back
              </button>
            ) : null}
          </div>

          <h1 className="mt-2 text-2xl font-bold text-slate-900">
            {lifecycleState === 'verification_rejected'
              ? 'Resubmit Society Verification'
              : 'Verify Your Residential Society'}
          </h1>

          {onboardingStep === 'invite' ? (
            /* SCREEN 5: INVITATION CODE */
            <form onSubmit={handleValidateInvite} className="mt-5 space-y-4">
              <p className="text-sm text-slate-600">
                Enter your residential society invitation code. Codes are verified via SHA-256 hash lookup without exposing any resident directory.
              </p>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Society Invitation Code
                </label>
                <input
                  type="text"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                  placeholder="Enter code (e.g. PALMDEMO26)"
                  className="w-full px-3.5 py-2.5 text-sm font-mono uppercase bg-white border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#0F3D2E]"
                />
              </div>
              <button
                type="submit"
                disabled={verifyLoading}
                className="w-full py-2.5 px-4 rounded-xl bg-[#0F3D2E] text-white text-sm font-semibold hover:bg-[#0B2E22]"
              >
                {verifyLoading ? 'Verifying Invitation...' : 'Verify Invitation Code'}
              </button>
              <p className="text-xs text-slate-500">
                Testing locally? Generate an invitation code or insert the labelled demo society (PALMDEMO26) in the Admin Console.
              </p>
            </form>
          ) : onboardingStep === 'profile' ? (
            /* SCREEN 6: SOCIETY REGISTRATION DETAILS */
            <form onSubmit={handleContinueToFlatStep} className="mt-5 space-y-4">
              {matchedSociety ? (
                <div className="p-3.5 rounded-xl bg-[#ECF3F0] border border-[#CBE0D6] flex items-center justify-between">
                  <div>
                    <div className="text-xs text-[#0F3D2E] font-medium">Matched Society</div>
                    <div className="text-sm font-bold text-slate-900">
                      {matchedSociety.societyName} · {matchedSociety.city}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setMatchedSociety(null);
                      setOnboardingStep('invite');
                    }}
                    className="text-xs font-medium text-[#0F3D2E] underline"
                  >
                    Change Code
                  </button>
                </div>
              ) : null}

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Resident Full Name
                </label>
                <input
                  type="text"
                  required
                  value={residentName}
                  onChange={(e) => setResidentName(e.target.value)}
                  placeholder="Aarav Sharma"
                  className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-xl"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Residency Type
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {(['Owner', 'Tenant'] as const).map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setResidentType(type)}
                      className={`py-2.5 rounded-xl text-sm font-semibold border transition-colors ${
                        residentType === type
                          ? 'bg-[#0F3D2E] text-white border-[#0F3D2E]'
                          : 'bg-white text-slate-700 border-slate-300'
                      }`}
                    >
                      {type}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Email (Optional)
                  </label>
                  <input
                    type="email"
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                    placeholder="resident@example.com"
                    className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-xl"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Alternate Contact (Optional)
                  </label>
                  <input
                    type="tel"
                    value={altContactInput}
                    onChange={(e) => setAltContactInput(e.target.value)}
                    placeholder="+919876543210"
                    className="w-full px-3.5 py-2.5 text-sm font-mono border border-slate-300 rounded-xl"
                  />
                </div>
              </div>

              <button
                type="submit"
                className="w-full py-2.5 px-4 rounded-xl bg-[#0F3D2E] text-white text-sm font-semibold hover:bg-[#0B2E22]"
              >
                Continue to Tower & Flat Details
              </button>
            </form>
          ) : (
            /* SCREEN 7: TOWER & FLAT DETAILS + ADDRESS CONFIRMATION */
            <form onSubmit={handleSubmitVerification} className="mt-5 space-y-4">
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-700">
                Applying as <span className="font-semibold text-slate-900">{residentName}</span> ({residentType}) for{' '}
                <span className="font-semibold text-slate-900">{matchedSociety?.societyName}</span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Tower / Block
                  </label>
                  <input
                    type="text"
                    required
                    value={towerInput}
                    onChange={(e) => setTowerInput(e.target.value)}
                    placeholder="Tower A"
                    className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-xl"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Flat / Unit Number
                  </label>
                  <input
                    type="text"
                    required
                    value={flatInput}
                    onChange={(e) => setFlatInput(e.target.value)}
                    placeholder="A-402"
                    className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-xl"
                  />
                </div>
              </div>

              <label className="flex items-start gap-2.5 p-3 rounded-xl border border-slate-200 bg-slate-50 text-xs text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={addressConfirmed}
                  onChange={(e) => setAddressConfirmed(e.target.checked)}
                  className="mt-0.5 rounded border-slate-300 text-[#0F3D2E]"
                />
                <span>
                  I confirm that I currently reside at this tower and flat as a verified {residentType.toLowerCase()}, and understand each flat allows one active primary resident registration.
                </span>
              </label>

              <button
                type="submit"
                disabled={verifyLoading}
                className="w-full py-2.5 px-4 rounded-xl bg-[#0F3D2E] text-white text-sm font-semibold hover:bg-[#0B2E22] disabled:opacity-60"
              >
                {verifyLoading ? 'Submitting Request...' : 'Submit for Admin Approval'}
              </button>
            </form>
          )}

          {verifyError ? (
            <div className="mt-4 p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700">
              {verifyError}
            </div>
          ) : null}

          <div className="mt-6 pt-4 border-t border-slate-100 flex justify-between items-center text-xs text-slate-500">
            <span>Signed in as {firebaseUser?.phoneNumber || firebaseUser?.email}</span>
            <button onClick={logout} className="font-medium text-slate-700 hover:underline">
              Sign Out
            </button>
          </div>
        </div>
      </div>
    );
  }

  // SCREEN 12: VERIFICATION APPROVED WELCOME SCREEN
  if (lifecycleState === 'verification_approved') {
    return (
      <div className="max-w-xl mx-auto px-4 py-14">
        <div className="bg-white border border-emerald-200 rounded-2xl p-8">
          <div className="w-12 h-12 rounded-2xl bg-[#ECF3F0] text-[#0F3D2E] flex items-center justify-center">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <div className="mt-4 text-xs font-semibold text-[#0F3D2E]">
            Verified Resident Access Unlocked
          </div>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">
            {t.verificationApprovedTitle}
          </h1>
          <p className="mt-2 text-sm text-slate-600 leading-relaxed">
            Welcome, <span className="font-semibold text-slate-900">{profile?.fullName || profile?.name}</span>. Your membership for{' '}
            <span className="font-semibold text-slate-900">
              {society?.societyName ?? profile?.societyId} · {profile?.tower} · Flat {profile?.flatNumber || profile?.flatId}
            </span>{' '}
            is now active.
          </p>
          <button
            onClick={acknowledgeVerificationApproval}
            className="mt-6 w-full py-3 px-4 rounded-xl bg-[#0F3D2E] text-white text-sm font-semibold hover:bg-[#0B2E22]"
          >
            Enter Society Marketplace
          </button>
        </div>
      </div>
    );
  }

  // =========================================================================
  // VERIFIED RESIDENT MARKETPLACE (EXACTLY 3 PRIMARY TABS: HOME, BUY, SERVICES)
  // =========================================================================

  const filteredProducts = products.filter((p) => {
    const matchesCat = productCategory === 'All' || p.category === productCategory;
    const matchesSearch =
      p.title.toLowerCase().includes(productSearch.toLowerCase()) ||
      p.description.toLowerCase().includes(productSearch.toLowerCase());
    return matchesCat && matchesSearch;
  });

  const filteredServices = services.filter(
    (s) => selectedServiceCat === 'All' || s.category === selectedServiceCat
  );

  return (
    <div className="max-w-6xl mx-auto px-4 pb-24 lg:pb-10 pt-4">
      {actionToast ? (
        <div className="mb-4 px-4 py-3 rounded-xl bg-[#0F3D2E] text-white text-sm font-medium flex items-center justify-between">
          <span>{actionToast}</span>
          <button onClick={() => setActionToast(null)} className="ml-4 opacity-80 hover:opacity-100">
            <X className="w-4 h-4" />
          </button>
        </div>
      ) : null}

      {/* A. Verified Customer Header */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 lg:p-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="text-xs text-slate-500">{t.welcomeBack}</div>
          <h1 className="text-xl lg:text-2xl font-bold text-slate-900">
            {profile?.fullName || profile?.name}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[#0F3D2E] font-medium">
            <MapPin className="w-3.5 h-3.5" />
            <span>{society?.societyName ?? profile?.societyId}</span>
            <span aria-hidden="true">·</span>
            <span>
              {profile?.tower} / {profile?.flatNumber || profile?.flatId}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Desktop 3-Tab Switcher (mirrors mobile bottom bar) */}
          <div className="hidden md:flex items-center gap-1 p-1 bg-slate-100 rounded-xl mr-2">
            {(
              [
                { id: 'home', label: t.tabHome },
                { id: 'buy', label: t.tabBuy },
                { id: 'services', label: t.tabServices },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                  activeTab === tab.id
                    ? 'bg-white text-[#0F3D2E] shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <button
            onClick={() => setLocale(locale === 'en' ? 'hi' : 'en')}
            aria-label="Toggle language"
            className="min-h-[40px] px-3 rounded-xl border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50 flex items-center gap-1.5"
          >
            <Languages className="w-4 h-4" />
            <span>{locale === 'en' ? 'EN' : 'हिन्दी'}</span>
          </button>

          {activeTab === 'buy' ? (
            <button
              onClick={() => setShowCartDrawer(true)}
              aria-label="Open cart"
              className="min-h-[40px] px-3 rounded-xl bg-[#0F3D2E] text-white text-xs font-semibold flex items-center gap-1.5"
            >
              <ShoppingCart className="w-4 h-4" />
              <span className="tabular-nums">{totalCartCount}</span>
            </button>
          ) : null}

          <button
            onClick={() => setShowNotifDrawer(true)}
            aria-label="Notifications"
            className="min-h-[40px] px-3 flex items-center justify-center gap-1 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50 text-xs font-semibold"
          >
            <Bell className="w-4 h-4" />
            {unreadNotifCount > 0 ? (
              <span className="font-mono tabular-nums text-[#0F3D2E]">{unreadNotifCount}</span>
            ) : null}
          </button>

          <button
            onClick={() => {
              setProfileNameEdit(profile?.fullName || profile?.name || '');
              setProfileEmailEdit(profile?.email || '');
              setProfileAltEdit(profile?.alternateContact || '');
              setEditingProfile(false);
              setShowProfileDrawer(true);
            }}
            aria-label="Resident profile"
            className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50"
          >
            <UserIcon className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* TAB 1: HOME */}
      {activeTab === 'home' ? (
        <div className="mt-6 space-y-8">
          <div className="relative rounded-2xl overflow-hidden border border-slate-200 bg-white">
            <SafeImage
              src="/src/assets/images/society_hero_courtyard_1795187599564.jpg"
              alt={society?.societyName ?? 'Verified residential society'}
              className="w-full h-52 lg:h-64 object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/35 to-transparent flex flex-col justify-end p-5 lg:p-7">
              <div className="text-xs font-medium text-emerald-200">
                {society?.city ?? 'Verified Community'} · {profile?.residentType || 'Verified Resident'}
              </div>
              <h2 className="mt-1 text-xl lg:text-2xl font-bold text-white">
                {society?.societyName ?? 'Your Society Marketplace'}
              </h2>
              <p className="mt-1 text-xs lg:text-sm text-white/85 max-w-xl">
                Neighbor-powered bulk discounts and verified apartment services, strictly isolated to your society.
              </p>
            </div>
          </div>

          {/* Bulk Vendor Offers */}
          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-slate-900">{t.bulkOffersTitle}</h2>
              <span className="text-xs text-slate-500 tabular-nums">
                {bulkOffers.length} active
              </span>
            </div>

            {bulkOffers.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center">
                <p className="text-sm font-medium text-slate-700">
                  No bulk vendor offers are scheduled for {society?.societyName ?? 'your society'} yet.
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Society administrators can publish bulk offers directly from the Admin Console.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                {bulkOffers.map((offer) => {
                  const savings = calculateSavingsPaise(
                    offer.regularPricePaise,
                    offer.offerPricePaise
                  );
                  const pctOff = calculateSavingsPercent(
                    offer.regularPricePaise,
                    offer.offerPricePaise
                  );
                  const liveJoins = Math.max(
                    offer.currentParticipants,
                    participations.filter((p) => p.campaignId === offer.campaignId).length
                  );
                  const progressPct = calculateTargetProgress(liveJoins, offer.minimumTarget);
                  const alreadyJoined = participations.some(
                    (p) => p.campaignId === offer.campaignId
                  );

                  return (
                    <article
                      key={offer.campaignId}
                      className="bg-white border border-slate-200 rounded-2xl overflow-hidden flex flex-col"
                    >
                      <SafeImage
                        src={
                          offer.imageUrl ||
                          '/src/assets/images/service_ac_maintenance_1795187598387.jpg'
                        }
                        alt={offer.title}
                        className="w-full h-44 object-cover"
                      />
                      <div className="p-5 flex-1 flex flex-col justify-between gap-4">
                        <div>
                          <div className="text-xs text-slate-500">
                            {offer.category || 'Bulk Service Offer'} · Save {pctOff}%
                          </div>
                          <h3 className="mt-1 text-base font-bold text-slate-900">{offer.title}</h3>
                          <div className="mt-2 flex items-baseline gap-2.5">
                            <span className="text-lg font-bold text-[#0F3D2E] font-mono tabular-nums">
                              {formatINRFromPaise(offer.offerPricePaise)}
                            </span>
                            <span className="text-xs text-slate-400 line-through font-mono tabular-nums">
                              {formatINRFromPaise(offer.regularPricePaise)}
                            </span>
                            <span className="text-xs font-medium text-emerald-700 font-mono tabular-nums">
                              Save {formatINRFromPaise(savings)}
                            </span>
                          </div>

                          <div className="mt-4">
                            <div className="flex justify-between text-xs text-slate-600 mb-1.5 tabular-nums">
                              <span>
                                {liveJoins} / {offer.minimumTarget} flats joined
                              </span>
                              <span>{progressPct}%</span>
                            </div>
                            <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-[#0F3D2E] rounded-full transition-all"
                                style={{ width: `${progressPct}%` }}
                              />
                            </div>
                          </div>

                          <div className="mt-3 text-xs text-slate-500 space-y-0.5 tabular-nums">
                            <div>Deadline: {formatReadableDate(offer.bookingDeadline)}</div>
                            <div>Scheduled Date: {formatReadableDate(offer.scheduledDate)}</div>
                          </div>
                        </div>

                        <button
                          onClick={() =>
                            handleJoinCampaign(
                              offer.campaignId,
                              'bulk_offer',
                              offer.title,
                              offer.offerPricePaise
                            )
                          }
                          disabled={alreadyJoined || joiningId === offer.campaignId}
                          className="w-full py-2.5 px-4 rounded-xl bg-[#0F3D2E] text-white text-sm font-semibold hover:bg-[#0B2E22] disabled:bg-slate-200 disabled:text-slate-600 transition-colors"
                        >
                          {alreadyJoined
                            ? 'Joined'
                            : joiningId === offer.campaignId
                            ? 'Joining...'
                            : t.joinOffer}
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          {/* Group Buying */}
          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-slate-900">{t.groupBuyingTitle}</h2>
              <span className="text-xs text-slate-500 tabular-nums">
                {groupOffers.length} active
              </span>
            </div>

            {groupOffers.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center">
                <p className="text-sm font-medium text-slate-700">
                  No active group buying batches for your society right now.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                {groupOffers.map((group) => {
                  const savings = calculateSavingsPaise(
                    group.marketPricePaise,
                    group.groupPricePaise
                  );
                  const liveQty = Math.max(
                    group.currentQuantity,
                    participations
                      .filter((p) => p.campaignId === group.campaignId)
                      .reduce((sum, p) => sum + p.quantity, 0)
                  );
                  const progressPct = calculateTargetProgress(
                    liveQty,
                    group.minimumGroupQuantity
                  );
                  const alreadyJoined = participations.some(
                    (p) => p.campaignId === group.campaignId
                  );

                  return (
                    <article
                      key={group.campaignId}
                      className="bg-white border border-slate-200 rounded-2xl overflow-hidden flex flex-col"
                    >
                      <SafeImage
                        src={
                          group.imageUrl ||
                          '/src/assets/images/group_buy_mangoes_1795187598328.jpg'
                        }
                        alt={group.title}
                        className="w-full h-44 object-cover"
                      />
                      <div className="p-5 flex-1 flex flex-col justify-between gap-4">
                        <div>
                          <div className="text-xs text-slate-500">
                            {group.unitLabel || 'Group Batch'}
                          </div>
                          <h3 className="mt-1 text-base font-bold text-slate-900">{group.title}</h3>
                          <div className="mt-2 flex items-baseline gap-2.5">
                            <span className="text-lg font-bold text-[#0F3D2E] font-mono tabular-nums">
                              {formatINRFromPaise(group.groupPricePaise)}
                            </span>
                            <span className="text-xs text-slate-400 line-through font-mono tabular-nums">
                              {formatINRFromPaise(group.marketPricePaise)}
                            </span>
                            <span className="text-xs font-medium text-emerald-700 font-mono tabular-nums">
                              Save {formatINRFromPaise(savings)}
                            </span>
                          </div>

                          <div className="mt-4">
                            <div className="flex justify-between text-xs text-slate-600 mb-1.5 tabular-nums">
                              <span>
                                {liveQty} / {group.minimumGroupQuantity} units
                              </span>
                              <span>{progressPct}%</span>
                            </div>
                            <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-emerald-700 rounded-full transition-all"
                                style={{ width: `${progressPct}%` }}
                              />
                            </div>
                          </div>

                          <div className="mt-3 text-xs text-slate-500 space-y-0.5 tabular-nums">
                            <div>Deadline: {formatReadableDate(group.deadline)}</div>
                            <div>Delivery: {formatReadableDate(group.expectedDeliveryDate)}</div>
                          </div>
                        </div>

                        <button
                          onClick={() =>
                            handleJoinCampaign(
                              group.campaignId,
                              'group_buy',
                              group.title,
                              group.groupPricePaise
                            )
                          }
                          disabled={alreadyJoined || joiningId === group.campaignId}
                          className="w-full py-2.5 px-4 rounded-xl bg-[#0F3D2E] text-white text-sm font-semibold hover:bg-[#0B2E22] disabled:bg-slate-200 disabled:text-slate-600 transition-colors"
                        >
                          {alreadyJoined
                            ? 'Joined Group'
                            : joiningId === group.campaignId
                            ? 'Joining...'
                            : t.joinGroup}
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          {/* My Activities */}
          <section>
            <h2 className="text-lg font-bold text-slate-900 mb-4">{t.myActivitiesTitle}</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-white border border-slate-200 rounded-2xl p-5">
                <div className="text-xs font-medium text-slate-500">{t.myOrders}</div>
                <div className="mt-1 text-2xl font-bold font-mono tabular-nums text-slate-900">
                  {orders.length}
                </div>
                <button
                  onClick={() => setActiveTab('buy')}
                  className="mt-3 text-xs font-semibold text-[#0F3D2E] hover:underline"
                >
                  View Orders
                </button>
              </div>
              <div className="bg-white border border-slate-200 rounded-2xl p-5">
                <div className="text-xs font-medium text-slate-500">{t.myGroups}</div>
                <div className="mt-1 text-2xl font-bold font-mono tabular-nums text-slate-900">
                  {participations.length}
                </div>
                <div className="mt-3 text-xs text-slate-500 truncate">
                  {participations[0]?.campaignTitle ?? 'No active groups yet'}
                </div>
              </div>
              <div className="bg-white border border-slate-200 rounded-2xl p-5">
                <div className="text-xs font-medium text-slate-500">{t.myBookings}</div>
                <div className="mt-1 text-2xl font-bold font-mono tabular-nums text-slate-900">
                  {bookings.length}
                </div>
                <button
                  onClick={() => setActiveTab('services')}
                  className="mt-3 text-xs font-semibold text-[#0F3D2E] hover:underline"
                >
                  Book Service
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {/* TAB 2: BUY */}
      {activeTab === 'buy' ? (
        <div className="mt-6 space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="relative flex-1 min-w-[240px]">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
                placeholder="Search daily essentials, staples, dairy..."
                className="w-full pl-10 pr-4 py-2.5 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#0F3D2E]"
              />
            </div>

            <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-xl">
              {PRODUCT_CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setProductCategory(cat)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                    productCategory === cat
                      ? 'bg-white text-[#0F3D2E] shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          {filteredProducts.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center text-sm text-slate-500">
              No active products available in this category yet.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {filteredProducts.map((prod) => (
                <article
                  key={prod.productId}
                  className="bg-white border border-slate-200 rounded-2xl overflow-hidden flex flex-col"
                >
                  <button
                    onClick={() => setSelectedProduct(prod)}
                    className="text-left focus:outline-none"
                  >
                    <SafeImage
                      src={
                        prod.imageUrl ||
                        '/src/assets/images/group_buy_mangoes_1795187598328.jpg'
                      }
                      alt={prod.title}
                      className="w-full h-44 object-cover"
                    />
                  </button>
                  <div className="p-5 flex-1 flex flex-col justify-between gap-4">
                    <div>
                      <div className="text-xs text-slate-500">
                        {prod.category} · {prod.unitLabel}
                      </div>
                      <h3 className="mt-1 text-base font-bold text-slate-900">{prod.title}</h3>
                      <p className="mt-1 text-xs text-slate-600 line-clamp-2">{prod.description}</p>
                      <div className="mt-3 flex items-baseline gap-2">
                        <span className="text-lg font-bold text-[#0F3D2E] font-mono tabular-nums">
                          {formatINRFromPaise(prod.pricePaise)}
                        </span>
                        <span className="text-xs text-slate-400 line-through font-mono tabular-nums">
                          {formatINRFromPaise(prod.mrpPaise)}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() =>
                          setCart((prev) => ({
                            ...prev,
                            [prod.productId]: (prev[prod.productId] || 0) + 1,
                          }))
                        }
                        className="flex-1 py-2.5 px-4 rounded-xl bg-[#0F3D2E] text-white text-sm font-semibold hover:bg-[#0B2E22]"
                      >
                        Add to Cart {cart[prod.productId] ? `(${cart[prod.productId]})` : ''}
                      </button>
                      <button
                        onClick={() => setSelectedProduct(prod)}
                        className="py-2.5 px-3 rounded-xl border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      >
                        Details
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}

          {/* Order History & Tracking */}
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h2 className="text-base font-bold text-slate-900">Your Order History</h2>
              <span className="text-xs text-slate-500 tabular-nums">{orders.length} orders</span>
            </div>
            {orders.length === 0 ? (
              <div className="p-6 text-sm text-slate-500">You have not placed any individual orders yet.</div>
            ) : (
              <div className="divide-y divide-slate-100">
                {orders.map((ord) => (
                  <div
                    key={ord.orderId}
                    className="p-5 flex flex-wrap items-center justify-between gap-4"
                  >
                    <div>
                      <div className="text-sm font-bold text-slate-900 font-mono">
                        #{ord.orderId.slice(-8)} · {formatINRFromPaise(ord.totalAmountPaise)}
                      </div>
                      <div className="mt-1 text-xs text-slate-600">
                        {ord.items.map((i) => `${i.title} x${i.quantity}`).join(', ')}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        Order Status: <span className="font-semibold text-slate-800">{ord.orderStatus}</span>
                        <span aria-hidden="true"> · </span>
                        Payment: <span className="font-semibold text-amber-700">{ord.paymentStatus}</span>
                      </div>
                    </div>
                    {ord.orderStatus === 'placed' ? (
                      <button
                        onClick={() => handleCancelOrder(ord.orderId)}
                        className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      >
                        Cancel Order
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}

      {/* TAB 3: SERVICES */}
      {activeTab === 'services' ? (
        <div className="mt-6 space-y-6">
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setSelectedServiceCat('All')}
              className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition-colors ${
                selectedServiceCat === 'All'
                  ? 'bg-[#0F3D2E] text-white'
                  : 'bg-white border border-slate-200 text-slate-700'
              }`}
            >
              All Services
            </button>
            {SERVICE_CATEGORIES.map((cat) => (
              <button
                key={cat}
                onClick={() => setSelectedServiceCat(cat)}
                className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition-colors ${
                  selectedServiceCat === cat
                    ? 'bg-[#0F3D2E] text-white'
                    : 'bg-white border border-slate-200 text-slate-700'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          {filteredServices.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center text-sm text-slate-500">
              No services published in this category yet.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {filteredServices.map((svc) => (
                <article
                  key={svc.serviceId}
                  className="bg-white border border-slate-200 rounded-2xl overflow-hidden flex flex-col"
                >
                  <SafeImage
                    src={
                      svc.imageUrl ||
                      (svc.category.includes('Cleaning')
                        ? '/src/assets/images/service_deep_cleaning_1795187599857.jpg'
                        : '/src/assets/images/service_ac_maintenance_1795187598387.jpg')
                    }
                    alt={svc.title}
                    className="w-full h-44 object-cover"
                  />
                  <div className="p-5 flex-1 flex flex-col justify-between gap-4">
                    <div>
                      <div className="text-xs text-slate-500">{svc.category}</div>
                      <h3 className="mt-1 text-base font-bold text-slate-900">{svc.title}</h3>
                      <p className="mt-1.5 text-xs text-slate-600 leading-relaxed">
                        {svc.description}
                      </p>
                      {svc.instructions ? (
                        <p className="mt-2 text-xs text-slate-500">Note: {svc.instructions}</p>
                      ) : null}
                      <div className="mt-3 text-sm font-bold text-[#0F3D2E] font-mono tabular-nums">
                        Starts at {formatINRFromPaise(svc.startingPricePaise)}
                      </div>
                    </div>

                    <button
                      onClick={() => setBookingService(svc)}
                      className="w-full py-2.5 px-4 rounded-xl bg-[#0F3D2E] text-white text-sm font-semibold hover:bg-[#0B2E22]"
                    >
                      {t.bookService}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}

          {/* My Service Bookings */}
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h2 className="text-base font-bold text-slate-900">{t.myBookings}</h2>
              <span className="text-xs text-slate-500 tabular-nums">{bookings.length} bookings</span>
            </div>
            {bookings.length === 0 ? (
              <div className="p-6 text-sm text-slate-500">No service bookings submitted yet.</div>
            ) : (
              <div className="divide-y divide-slate-100">
                {bookings.map((bk) => (
                  <div key={bk.bookingId} className="p-5 flex flex-wrap justify-between gap-4">
                    <div>
                      <div className="text-sm font-bold text-slate-900">{bk.serviceTitle}</div>
                      <div className="mt-1 text-xs text-slate-600">
                        {bk.preferredDate} · {bk.timeSlot} · {bk.serviceAddress}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">{bk.problemDescription}</div>
                    </div>
                    <div className="text-xs font-semibold text-[#0F3D2E]">Status: {bk.status}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}

      {/* EXACTLY THREE PRIMARY MOBILE BOTTOM NAVIGATION TABS */}
      <nav
        aria-label="Customer primary navigation"
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200 grid grid-cols-3 h-16"
      >
        <button
          onClick={() => setActiveTab('home')}
          className={`flex flex-col items-center justify-center gap-1 text-[11px] font-semibold ${
            activeTab === 'home' ? 'text-[#0F3D2E]' : 'text-slate-500'
          }`}
        >
          <Home className="w-5 h-5" />
          <span>{t.tabHome}</span>
        </button>
        <button
          onClick={() => setActiveTab('buy')}
          className={`flex flex-col items-center justify-center gap-1 text-[11px] font-semibold ${
            activeTab === 'buy' ? 'text-[#0F3D2E]' : 'text-slate-500'
          }`}
        >
          <ShoppingBag className="w-5 h-5" />
          <span>{t.tabBuy}</span>
        </button>
        <button
          onClick={() => setActiveTab('services')}
          className={`flex flex-col items-center justify-center gap-1 text-[11px] font-semibold ${
            activeTab === 'services' ? 'text-[#0F3D2E]' : 'text-slate-500'
          }`}
        >
          <Wrench className="w-5 h-5" />
          <span>{t.tabServices}</span>
        </button>
      </nav>

      {/* Product Details Modal */}
      {selectedProduct ? (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-white rounded-2xl overflow-hidden border border-slate-200">
            <SafeImage
              src={
                selectedProduct.imageUrl ||
                '/src/assets/images/group_buy_mangoes_1795187598328.jpg'
              }
              alt={selectedProduct.title}
              className="w-full h-52 object-cover"
            />
            <div className="p-6">
              <div className="text-xs text-slate-500">
                {selectedProduct.category} · {selectedProduct.unitLabel}
              </div>
              <h3 className="mt-1 text-lg font-bold text-slate-900">{selectedProduct.title}</h3>
              <p className="mt-2 text-sm text-slate-600">{selectedProduct.description}</p>
              <div className="mt-4 text-lg font-bold text-[#0F3D2E] font-mono tabular-nums">
                {formatINRFromPaise(selectedProduct.pricePaise)}
              </div>
              <div className="mt-5 flex gap-2">
                <button
                  onClick={() => {
                    setCart((prev) => ({
                      ...prev,
                      [selectedProduct.productId]: (prev[selectedProduct.productId] || 0) + 1,
                    }));
                    setSelectedProduct(null);
                    setShowCartDrawer(true);
                  }}
                  className="flex-1 py-2.5 px-4 rounded-xl bg-[#0F3D2E] text-white text-sm font-semibold"
                >
                  Add to Cart
                </button>
                <button
                  onClick={() => setSelectedProduct(null)}
                  className="py-2.5 px-4 rounded-xl border border-slate-200 text-sm font-medium text-slate-700"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* Cart & Checkout Drawer */}
      {showCartDrawer ? (
        <div className="fixed inset-0 z-50 bg-black/50 flex justify-end">
          <div className="w-full max-w-md bg-white h-full p-6 flex flex-col justify-between overflow-y-auto">
            <div>
              <div className="flex items-center justify-between pb-4 border-b border-slate-200">
                <h3 className="text-lg font-bold text-slate-900">Your Society Cart</h3>
                <button onClick={() => setShowCartDrawer(false)}>
                  <X className="w-5 h-5 text-slate-500" />
                </button>
              </div>

              {cartItems.length === 0 ? (
                <p className="mt-6 text-sm text-slate-500">Your cart is empty.</p>
              ) : (
                <div className="mt-4 divide-y divide-slate-100">
                  {cartItems.map(({ product, quantity }) => (
                    <div key={product.productId} className="py-3 flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-slate-900">{product.title}</div>
                        <div className="text-xs text-slate-500 font-mono tabular-nums">
                          {formatINRFromPaise(product.pricePaise)} x {quantity}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() =>
                            setCart((p) => ({
                              ...p,
                              [product.productId]: Math.max(0, (p[product.productId] || 0) - 1),
                            }))
                          }
                          className="w-7 h-7 rounded-lg border border-slate-300 text-sm font-bold"
                        >
                          -
                        </button>
                        <span className="text-sm font-mono tabular-nums">{quantity}</span>
                        <button
                          onClick={() =>
                            setCart((p) => ({
                              ...p,
                              [product.productId]: (p[product.productId] || 0) + 1,
                            }))
                          }
                          className="w-7 h-7 rounded-lg border border-slate-300 text-sm font-bold"
                        >
                          +
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {cartItems.length > 0 ? (
              <div className="pt-4 border-t border-slate-200 space-y-3">
                <div className="flex justify-between text-base font-bold text-slate-900">
                  <span>Order Total</span>
                  <span className="font-mono tabular-nums">
                    {formatINRFromPaise(cartTotalPaise)}
                  </span>
                </div>
                <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800">
                  {t.paymentPendingNotice}
                </div>
                <button
                  onClick={handlePlaceOrder}
                  disabled={placingOrder}
                  className="w-full py-3 px-4 rounded-xl bg-[#0F3D2E] text-white text-sm font-semibold hover:bg-[#0B2E22]"
                >
                  {placingOrder ? 'Creating Order...' : 'Place Order (Payment Integration Pending)'}
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* Service Booking Modal */}
      {bookingService ? (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <form
            onSubmit={handleSubmitServiceBooking}
            className="max-w-lg w-full bg-white rounded-2xl p-6 border border-slate-200 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-900">Book {bookingService.title}</h3>
              <button type="button" onClick={() => setBookingService(null)}>
                <X className="w-5 h-5 text-slate-500" />
              </button>
            </div>

            <div className="p-3 rounded-xl bg-[#ECF3F0] text-xs text-[#0F3D2E] font-medium">
              Verified Society: {society?.societyName ?? profile?.societyId} · Flat {profile?.tower} /{' '}
              {profile?.flatNumber || profile?.flatId}
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Service Address</label>
              <input
                type="text"
                value={serviceAddress}
                onChange={(e) => setServiceAddress(e.target.value)}
                className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-xl"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Preferred Date
                </label>
                <input
                  type="date"
                  value={preferredDate}
                  onChange={(e) => setPreferredDate(e.target.value)}
                  className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-xl"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Time Slot</label>
                <select
                  value={timeSlot}
                  onChange={(e) => setTimeSlot(e.target.value)}
                  className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-xl bg-white"
                >
                  {SERVICE_TIME_SLOTS.map((slot) => (
                    <option key={slot} value={slot}>
                      {slot}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Problem Description
              </label>
              <textarea
                rows={3}
                value={problemDesc}
                onChange={(e) => setProblemDesc(e.target.value)}
                placeholder="Describe the issue or specific requirements..."
                className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-xl"
              />
            </div>

            {bookingError ? (
              <div className="text-xs text-red-600">{bookingError}</div>
            ) : null}

            <button
              type="submit"
              disabled={bookingSubmitting}
              className="w-full py-2.5 px-4 rounded-xl bg-[#0F3D2E] text-white text-sm font-semibold hover:bg-[#0B2E22]"
            >
              {bookingSubmitting ? 'Submitting Booking...' : 'Confirm Service Booking'}
            </button>
          </form>
        </div>
      ) : null}

      {/* Notifications Drawer */}
      {showNotifDrawer ? (
        <div className="fixed inset-0 z-50 bg-black/50 flex justify-end">
          <div className="w-full max-w-sm bg-white h-full p-6 overflow-y-auto">
            <div className="flex items-center justify-between pb-4 border-b border-slate-200">
              <h3 className="text-base font-bold text-slate-900">Notifications</h3>
              <button onClick={() => setShowNotifDrawer(false)}>
                <X className="w-5 h-5 text-slate-500" />
              </button>
            </div>
            {notifications.length === 0 ? (
              <p className="mt-6 text-sm text-slate-500">No notifications yet.</p>
            ) : (
              <div className="mt-4 space-y-3">
                {notifications.map((n) => (
                  <div
                    key={n.notificationId}
                    className={`p-3 rounded-xl border ${
                      n.read ? 'border-slate-200 bg-white' : 'border-emerald-200 bg-[#ECF3F0]/50'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-sm font-semibold text-slate-900">{n.title}</div>
                      {!n.read ? (
                        <button
                          onClick={() => handleMarkNotificationRead(n.notificationId)}
                          className="text-[11px] font-semibold text-[#0F3D2E] hover:underline shrink-0"
                        >
                          Mark read
                        </button>
                      ) : null}
                    </div>
                    <div className="mt-1 text-xs text-slate-600">{n.body}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}

      {/* SCREEN 13: PROFILE DRAWER (Editable Allowed Fields + Society Change Request + Sign Out) */}
      {showProfileDrawer ? (
        <div className="fixed inset-0 z-50 bg-black/50 flex justify-end">
          <div className="w-full max-w-md bg-white h-full p-6 flex flex-col justify-between overflow-y-auto">
            <div>
              <div className="flex items-center justify-between pb-4 border-b border-slate-200">
                <h3 className="text-base font-bold text-slate-900">Resident Profile</h3>
                <button onClick={() => setShowProfileDrawer(false)}>
                  <X className="w-5 h-5 text-slate-500" />
                </button>
              </div>

              <div className="mt-5 space-y-4 text-sm">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-emerald-700 font-semibold">
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Verified Society Resident</span>
                  </div>
                  {!editingProfile ? (
                    <button
                      onClick={() => setEditingProfile(true)}
                      className="text-xs font-semibold text-[#0F3D2E] hover:underline"
                    >
                      Edit Profile
                    </button>
                  ) : null}
                </div>

                {!editingProfile ? (
                  <div className="space-y-3">
                    <div>
                      <div className="text-xs text-slate-500">Full Name</div>
                      <div className="font-semibold text-slate-900">
                        {profile?.fullName || profile?.name}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-500">Society & Residency</div>
                      <div className="font-semibold text-slate-900">
                        {society?.societyName ?? profile?.societyId} · {profile?.residentType || 'Owner'}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-500">Tower & Flat (Admin Verified)</div>
                      <div className="font-semibold text-slate-900">
                        {profile?.tower} / {profile?.flatNumber || profile?.flatId}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-500">Verified Mobile / Account</div>
                      <div className="font-mono text-xs text-slate-700">
                        {profile?.phoneNumber || profile?.email}
                      </div>
                    </div>
                    {profile?.alternateContact ? (
                      <div>
                        <div className="text-xs text-slate-500">Alternate Contact</div>
                        <div className="font-mono text-xs text-slate-700">
                          {profile.alternateContact}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <form onSubmit={handleSaveProfile} className="space-y-3 bg-slate-50 p-4 rounded-xl border border-slate-200">
                    <div className="text-xs font-semibold text-slate-700">
                      Update Profile (Society & Flat remain admin-locked)
                    </div>
                    <div>
                      <label className="block text-xs text-slate-600 mb-1">Full Name</label>
                      <input
                        value={profileNameEdit}
                        onChange={(e) => setProfileNameEdit(e.target.value)}
                        className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-600 mb-1">Email</label>
                      <input
                        type="email"
                        value={profileEmailEdit}
                        onChange={(e) => setProfileEmailEdit(e.target.value)}
                        className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-600 mb-1">Alternate Contact (+91)</label>
                      <input
                        type="tel"
                        value={profileAltEdit}
                        onChange={(e) => setProfileAltEdit(e.target.value)}
                        className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-lg"
                      />
                    </div>
                    {profileError ? (
                      <div className="text-xs text-red-600">{profileError}</div>
                    ) : null}
                    <div className="flex gap-2">
                      <button
                        type="submit"
                        disabled={profileSaving}
                        className="flex-1 py-2 rounded-lg bg-[#0F3D2E] text-white text-xs font-semibold"
                      >
                        {profileSaving ? 'Saving...' : 'Save Changes'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingProfile(false)}
                        className="px-3 py-2 rounded-lg border border-slate-300 text-xs text-slate-700 bg-white"
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                )}

                <div className="pt-3 border-t border-slate-200">
                  <button
                    type="button"
                    onClick={() => {
                      setChangeSocError(null);
                      setShowSocietyChangeModal(true);
                    }}
                    className="w-full py-2.5 px-3 rounded-xl border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center justify-center gap-1.5"
                  >
                    <Building2 className="w-3.5 h-3.5" />
                    <span>Request Society or Flat Transfer</span>
                  </button>
                </div>
              </div>
            </div>

            <button
              onClick={logout}
              className="mt-6 w-full py-2.5 px-4 rounded-xl bg-slate-900 text-white text-sm font-semibold"
            >
              Sign Out Securely
            </button>
          </div>
        </div>
      ) : null}

      {/* Society Change Request Modal */}
      {showSocietyChangeModal ? (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <form
            onSubmit={handleSocietyChangeSubmit}
            className="max-w-md w-full bg-white rounded-2xl p-6 border border-slate-200 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900">Request Society Transfer</h3>
              <button type="button" onClick={() => setShowSocietyChangeModal(false)}>
                <X className="w-5 h-5 text-slate-500" />
              </button>
            </div>
            <p className="text-xs text-slate-600">
              Moving to another society or flat moves your account back into Pending Review until an administrator verifies your new residence.
            </p>
            <input
              value={changeSocCode}
              onChange={(e) => setChangeSocCode(e.target.value.toUpperCase())}
              placeholder="New Society Invitation Code"
              className="w-full px-3.5 py-2 text-sm font-mono uppercase border border-slate-300 rounded-xl"
            />
            <div className="grid grid-cols-2 gap-3">
              <input
                value={changeSocTower}
                onChange={(e) => setChangeSocTower(e.target.value)}
                placeholder="New Tower"
                className="px-3.5 py-2 text-sm border border-slate-300 rounded-xl"
              />
              <input
                value={changeSocFlat}
                onChange={(e) => setChangeSocFlat(e.target.value)}
                placeholder="New Flat No."
                className="px-3.5 py-2 text-sm border border-slate-300 rounded-xl"
              />
            </div>
            <select
              value={changeSocType}
              onChange={(e) => setChangeSocType(e.target.value as ResidentType)}
              className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-xl bg-white"
            >
              <option value="Owner">Owner</option>
              <option value="Tenant">Tenant</option>
            </select>
            {changeSocError ? (
              <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700">
                {changeSocError}
              </div>
            ) : null}
            <button
              type="submit"
              disabled={changeSocSaving}
              className="w-full py-2.5 px-4 rounded-xl bg-[#0F3D2E] text-white text-sm font-semibold"
            >
              {changeSocSaving ? 'Submitting Transfer...' : 'Submit Transfer Request'}
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
