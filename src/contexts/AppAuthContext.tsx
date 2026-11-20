import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import {
  GoogleAuthProvider,
  RecaptchaVerifier,
  onAuthStateChanged,
  signInWithPhoneNumber,
  signInWithPopup,
  signOut,
  type ConfirmationResult,
  type User,
} from 'firebase/auth';
import {
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import type {
  AuthLifecycleState,
  InvitationLookupProjection,
  ResidentType,
  RoleDefinition,
  StaffMember,
  SupportedLocale,
  UserProfile,
} from '@society-marketplace/shared-types';
import { OTP_SECURITY_CONFIG } from '@society-marketplace/constants';
import {
  normalizeFlatDocId,
  resolveAuthLifecycleState,
  sha256HexBrowser,
} from '@society-marketplace/business-logic';
import { normalizeIndianPhone } from '@society-marketplace/validation';
import {
  OperationType,
  auth,
  db,
  functions,
  handleFirestoreError,
  isFirebaseConfigured,
  testConnection,
} from '../lib/firebase';

const BOOTSTRAP_ADMIN_EMAIL = 'sandeeprana4519@gmail.com';

export interface ValidatedInviteResult {
  codeHash: string;
  codeId: string;
  societyId: string;
  societyName: string;
  city: string;
}

interface AppAuthContextValue {
  firebaseUser: User | null;
  profile: UserProfile | null;
  lifecycleState: AuthLifecycleState;
  staffProfile: StaffMember | null;
  staffRole: RoleDefinition | null;
  isAdminAuthorized: boolean;
  adminPermissions: string[];
  locale: SupportedLocale;
  setLocale: (loc: SupportedLocale) => void;
  loading: boolean;
  connectionStatus: 'checking' | 'connected' | 'error';
  connectionError: string | null;
  signInWithGoogle: () => Promise<void>;
  sendPhoneOtp: (phoneNumber: string, recaptchaElementId: string) => Promise<void>;
  confirmPhoneOtp: (code: string) => Promise<void>;
  otpSent: boolean;
  otpCooldownSeconds: number;
  otpVerifyAttempts: number;
  otpLockedUntilMs: number | null;
  resetOtpState: () => void;
  lookupInvitation: (code: string) => Promise<ValidatedInviteResult>;
  submitSocietyVerification: (input: {
    invitationCode: string;
    codeHash: string;
    codeId: string;
    societyId: string;
    residentName: string;
    residentType: ResidentType;
    tower: string;
    flatNumber: string;
    email?: string;
    alternateContact?: string;
    addressConfirmed: boolean;
  }) => Promise<void>;
  acknowledgeVerificationApproval: () => Promise<void>;
  updateAllowedProfile: (input: {
    fullName: string;
    email?: string;
    alternateContact?: string;
    preferredLocale: SupportedLocale;
  }) => Promise<void>;
  requestSocietyChange: (input: {
    invitationCode: string;
    tower: string;
    flatNumber: string;
    residentType: ResidentType;
  }) => Promise<void>;
  logout: () => Promise<void>;
}

const AppAuthContext = createContext<AppAuthContextValue | null>(null);

function mapPhoneAuthError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (raw.includes('auth/operation-not-allowed')) {
    return 'Phone OTP Authentication is not yet enabled in Firebase Console (Authentication -> Sign-in method -> Phone). Enable it there or use Google Sign-In.';
  }
  if (raw.includes('auth/invalid-phone-number')) {
    return 'Invalid mobile number format. Enter a 10-digit Indian mobile number (+91).';
  }
  if (raw.includes('auth/invalid-verification-code')) {
    return 'Incorrect OTP code entered. Please check the SMS and try again.';
  }
  if (raw.includes('auth/code-expired') || raw.includes('auth/session-expired')) {
    return 'This OTP code has expired. Tap Resend OTP to request a new code.';
  }
  if (raw.includes('auth/too-many-requests')) {
    return 'Too many OTP requests from this device or number. Wait a few minutes before retrying.';
  }
  if (raw.includes('auth/credential-already-in-use')) {
    return 'This phone number is already linked to another resident account.';
  }
  if (raw.includes('auth/network-request-failed')) {
    return 'Network error while contacting Firebase Authentication. Check your connection and retry.';
  }
  return raw;
}

export function AppAuthProvider({ children }: { children: React.ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [staffProfile, setStaffProfile] = useState<StaffMember | null>(null);
  const [staffRole, setStaffRole] = useState<RoleDefinition | null>(null);
  const [locale, setLocaleState] = useState<SupportedLocale>('en');
  const [loading, setLoading] = useState(true);
  const [connectionStatus, setConnectionStatus] = useState<'checking' | 'connected' | 'error'>('checking');
  const [connectionError, setConnectionError] = useState<string | null>(null);

  const [otpSent, setOtpSent] = useState(false);
  const [otpCooldownSeconds, setOtpCooldownSeconds] = useState(0);
  const [otpVerifyAttempts, setOtpVerifyAttempts] = useState(0);
  const [otpLockedUntilMs, setOtpLockedUntilMs] = useState<number | null>(null);

  const confirmationRef = useRef<ConfirmationResult | null>(null);
  const recaptchaRef = useRef<RecaptchaVerifier | null>(null);

  useEffect(() => {
    if (otpCooldownSeconds <= 0) return;
    const timer = setInterval(() => {
      setOtpCooldownSeconds((prev) => (prev > 1 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [otpCooldownSeconds]);

  useEffect(() => {
    testConnection().then((res) => {
      if (res.connected) {
        setConnectionStatus('connected');
        setConnectionError(null);
      } else {
        setConnectionStatus('error');
        setConnectionError(res.error ?? 'Firebase connection unavailable.');
      }
    });
  }, []);

  useEffect(() => {
    if (!isFirebaseConfigured || !auth || !db) {
      setLoading(false);
      return;
    }

    let unsubUserDoc: (() => void) | undefined;

    const unsubAuth = onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);
      if (unsubUserDoc) {
        unsubUserDoc();
        unsubUserDoc = undefined;
      }

      if (!user) {
        setProfile(null);
        setStaffProfile(null);
        setStaffRole(null);
        setLoading(false);
        return;
      }

      const userPath = `users/${user.uid}`;
      const userRef = doc(db, 'users', user.uid);

      try {
        const existingSnap = await getDoc(userRef);
        if (!existingSnap.exists()) {
          const fallbackName = (user.displayName || 'Resident').slice(0, 100);
          await setDoc(userRef, {
            uid: user.uid,
            name: fallbackName,
            fullName: fallbackName,
            phoneNumber: user.phoneNumber ?? '',
            email: user.email ?? '',
            accountType: 'customer',
            membershipStatus: 'not_submitted',
            accountStatus: 'active',
            preferredLocale: 'en',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, userPath);
      }

      unsubUserDoc = onSnapshot(
        userRef,
        (snap) => {
          if (snap.exists()) {
            const data = snap.data() as UserProfile;
            setProfile(data);
            if (data.preferredLocale === 'hi' || data.preferredLocale === 'en') {
              setLocaleState(data.preferredLocale);
            }
          } else {
            setProfile(null);
          }
          setLoading(false);
        },
        (err) => {
          handleFirestoreError(err, OperationType.GET, userPath);
        }
      );

      try {
        const staffSnap = await getDoc(doc(db, 'staff', user.uid));
        if (staffSnap.exists()) {
          const staffData = staffSnap.data() as StaffMember;
          setStaffProfile(staffData);
          if (staffData.status === 'active' && staffData.roleId) {
            const roleSnap = await getDoc(doc(db, 'roles', staffData.roleId));
            setStaffRole(roleSnap.exists() ? (roleSnap.data() as RoleDefinition) : null);
          } else {
            setStaffRole(null);
          }
        } else {
          setStaffProfile(null);
          setStaffRole(null);
        }
      } catch {
        setStaffProfile(null);
        setStaffRole(null);
      }
    });

    return () => {
      unsubAuth();
      if (unsubUserDoc) unsubUserDoc();
    };
  }, []);

  const isBootstrappedSuperAdmin = Boolean(
    firebaseUser?.emailVerified && firebaseUser.email === BOOTSTRAP_ADMIN_EMAIL
  );

  const isStaffAuthorized = Boolean(
    firebaseUser?.emailVerified &&
      staffProfile?.status === 'active' &&
      staffRole &&
      staffRole.permissions.length > 0
  );

  const isAdminAuthorized = isBootstrappedSuperAdmin || isStaffAuthorized;
  const adminPermissions = isBootstrappedSuperAdmin
    ? ['*']
    : staffRole?.permissions ?? [];

  const lifecycleState = resolveAuthLifecycleState(Boolean(firebaseUser), profile);

  const setLocale = (loc: SupportedLocale) => {
    setLocaleState(loc);
    if (firebaseUser && db && profile?.accountStatus === 'active') {
      updateDoc(doc(db, 'users', firebaseUser.uid), {
        preferredLocale: loc,
        updatedAt: serverTimestamp(),
      }).catch(() => {});
    }
  };

  const signInWithGoogle = async () => {
    if (!auth) throw new Error('Firebase Auth is not initialized.');
    await signInWithPopup(auth, new GoogleAuthProvider());
  };

  const sendPhoneOtp = async (phoneNumber: string, recaptchaElementId: string) => {
    if (!auth) throw new Error('Firebase Auth is not initialized.');
    if (otpCooldownSeconds > 0) {
      throw new Error(`Please wait ${otpCooldownSeconds} seconds before requesting another OTP.`);
    }

    const normalizedPhone = normalizeIndianPhone(phoneNumber);
    try {
      if (!recaptchaRef.current) {
        recaptchaRef.current = new RecaptchaVerifier(auth, recaptchaElementId, {
          size: 'invisible',
        });
      }
      confirmationRef.current = await signInWithPhoneNumber(
        auth,
        normalizedPhone,
        recaptchaRef.current
      );
      setOtpSent(true);
      setOtpVerifyAttempts(0);
      setOtpLockedUntilMs(null);
      setOtpCooldownSeconds(OTP_SECURITY_CONFIG.RESEND_COOLDOWN_SECONDS);
    } catch (err) {
      // Clear stale verifier so retry initializes cleanly
      if (recaptchaRef.current) {
        try {
          recaptchaRef.current.clear();
        } catch {
          // ignore
        }
        recaptchaRef.current = null;
      }
      throw new Error(mapPhoneAuthError(err));
    }
  };

  const confirmPhoneOtp = async (code: string) => {
    if (otpLockedUntilMs && Date.now() < otpLockedUntilMs) {
      const minsLeft = Math.ceil((otpLockedUntilMs - Date.now()) / 60000);
      throw new Error(`Maximum OTP attempts exceeded. Please wait ${minsLeft} minute(s) or request a fresh OTP.`);
    }
    if (!confirmationRef.current) {
      throw new Error('Request an OTP code before verifying.');
    }
    try {
      await confirmationRef.current.confirm(code.trim());
      setOtpSent(false);
      setOtpVerifyAttempts(0);
      setOtpLockedUntilMs(null);
      confirmationRef.current = null;
    } catch (err) {
      const nextAttempts = otpVerifyAttempts + 1;
      setOtpVerifyAttempts(nextAttempts);
      if (nextAttempts >= OTP_SECURITY_CONFIG.MAX_VERIFY_ATTEMPTS) {
        setOtpLockedUntilMs(Date.now() + OTP_SECURITY_CONFIG.LOCKOUT_MINUTES * 60 * 1000);
      }
      throw new Error(mapPhoneAuthError(err));
    }
  };

  const resetOtpState = () => {
    setOtpSent(false);
    setOtpVerifyAttempts(0);
    setOtpLockedUntilMs(null);
    confirmationRef.current = null;
  };

  const lookupInvitation = async (rawCode: string): Promise<ValidatedInviteResult> => {
    const normalized = rawCode.trim().toUpperCase();
    const codeHash = await sha256HexBrowser(normalized);
    const path = `invitationLookups/${codeHash}`;
    try {
      const snap = await getDoc(doc(db, 'invitationLookups', codeHash));
      if (!snap.exists()) {
        throw new Error('Invitation code is invalid. Ask your society administrator for an active code.');
      }
      const lookup = snap.data() as InvitationLookupProjection;
      if (lookup.status !== 'active') {
        throw new Error(`This invitation code is ${lookup.status}.`);
      }
      if (lookup.expiresAt && Date.parse(lookup.expiresAt) <= Date.now()) {
        throw new Error('This invitation code has expired. Request a new code from your society office.');
      }
      if (lookup.usedCount >= lookup.maxUses) {
        throw new Error('This invitation code has reached its maximum usage limit.');
      }
      return {
        codeHash,
        codeId: lookup.codeId,
        societyId: lookup.societyId,
        societyName: lookup.societyName,
        city: lookup.city,
      };
    } catch (err) {
      if (err instanceof Error && err.message.includes('Missing or insufficient permissions')) {
        handleFirestoreError(err, OperationType.GET, path);
      }
      throw err;
    }
  };

  const submitSocietyVerification = async (input: {
    invitationCode: string;
    codeHash: string;
    codeId: string;
    societyId: string;
    residentName: string;
    residentType: ResidentType;
    tower: string;
    flatNumber: string;
    email?: string;
    alternateContact?: string;
    addressConfirmed: boolean;
  }) => {
    if (!firebaseUser) throw new Error('Authentication required.');
    const uid = firebaseUser.uid;
    const cleanName = input.residentName.trim();
    const cleanTower = input.tower.trim();
    const cleanFlat = input.flatNumber.trim();
    const cleanEmail = (input.email ?? firebaseUser.email ?? profile?.email ?? '').trim();
    const cleanAlt = input.alternateContact ? normalizeIndianPhone(input.alternateContact) : '';
    const flatDocId = normalizeFlatDocId(cleanTower, cleanFlat);
    const isResubmit = profile?.membershipStatus === 'rejected';

    const batch = writeBatch(db);
    const memberRef = doc(db, 'societies', input.societyId, 'members', uid);
    const userRef = doc(db, 'users', uid);
    const flatRef = doc(db, 'societies', input.societyId, 'flats', flatDocId);
    const historyId = `hist_${Date.now()}_${uid.slice(0, 6)}`;
    const historyRef = doc(db, 'societies', input.societyId, 'verificationHistory', historyId);
    const auditRef = doc(db, 'auditLogs', `aud_${Date.now()}_${uid.slice(0, 6)}`);

    const existingMemberSnap = await getDoc(memberRef).catch(() => null);

    batch.set(
      flatRef,
      {
        flatId: flatDocId,
        societyId: input.societyId,
        tower: cleanTower,
        flatNumber: cleanFlat,
        occupied: false,
        status: 'Verification Pending',
        primaryResidentUid: uid,
        residentType: input.residentType,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    batch.set(
      memberRef,
      {
        uid,
        societyId: input.societyId,
        flatId: cleanFlat,
        flatNumber: cleanFlat,
        tower: cleanTower,
        residentName: cleanName,
        residentType: input.residentType,
        phoneNumber: firebaseUser.phoneNumber ?? profile?.phoneNumber ?? '',
        email: cleanEmail,
        alternateContact: cleanAlt,
        addressConfirmed: input.addressConfirmed,
        invitationCode: input.codeHash,
        invitationCodeId: input.codeId,
        verificationStatus: 'pending',
        rejectionReason: '',
        infoRequestNote: '',
        createdAt: existingMemberSnap?.exists()
          ? existingMemberSnap.data().createdAt
          : serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    batch.update(userRef, {
      name: cleanName,
      fullName: cleanName,
      email: cleanEmail,
      alternateContact: cleanAlt,
      societyId: input.societyId,
      flatId: cleanFlat,
      flatNumber: cleanFlat,
      tower: cleanTower,
      residentType: input.residentType,
      addressConfirmed: input.addressConfirmed,
      membershipStatus: 'pending',
      rejectionReason: '',
      infoRequestNote: '',
      updatedAt: serverTimestamp(),
    });

    batch.set(historyRef, {
      historyId,
      uid,
      societyId: input.societyId,
      flatId: cleanFlat,
      tower: cleanTower,
      action: isResubmit ? 'resubmitted' : 'submitted',
      previousStatus: profile?.membershipStatus ?? 'not_submitted',
      newStatus: 'pending',
      actorUid: uid,
      actorEmail: cleanEmail,
      note: `${input.residentType} verification submitted for ${cleanTower} · ${cleanFlat}`,
      createdAt: serverTimestamp(),
    });

    batch.set(auditRef, {
      logId: auditRef.id,
      actorUid: uid,
      actorEmail: cleanEmail,
      actorRole: 'customer',
      action: isResubmit ? 'RESUBMIT_SOCIETY_VERIFICATION' : 'SUBMIT_SOCIETY_VERIFICATION',
      targetCollection: `societies/${input.societyId}/members`,
      targetId: uid,
      targetUid: uid,
      resourceType: 'membership',
      resourceId: uid,
      societyId: input.societyId,
      status: 'success',
      details: `Submitted ${cleanTower} / ${cleanFlat} (${input.residentType}) for verification`,
      createdAt: serverTimestamp(),
    });

    try {
      await batch.commit();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('Missing or insufficient permissions')) {
        throw new Error(
          `Flat ${cleanTower} · ${cleanFlat} may already have an active or pending primary resident registration, or your invitation code is no longer valid.`
        );
      }
      throw err;
    }
  };

  const acknowledgeVerificationApproval = async () => {
    if (!firebaseUser || !db) return;
    const path = `users/${firebaseUser.uid}`;
    try {
      await updateDoc(doc(db, 'users', firebaseUser.uid), {
        approvalAcknowledged: true,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, path);
    }
  };

  const updateAllowedProfile = async (input: {
    fullName: string;
    email?: string;
    alternateContact?: string;
    preferredLocale: SupportedLocale;
  }) => {
    if (!firebaseUser || !db) throw new Error('Authentication required.');
    const cleanName = input.fullName.trim().slice(0, 100);
    if (cleanName.length < 2) {
      throw new Error('Full name must be at least 2 characters.');
    }
    const cleanEmail = (input.email ?? '').trim().slice(0, 160);
    const cleanAlt = input.alternateContact?.trim()
      ? normalizeIndianPhone(input.alternateContact)
      : '';
    const path = `users/${firebaseUser.uid}`;
    try {
      await updateDoc(doc(db, 'users', firebaseUser.uid), {
        name: cleanName,
        fullName: cleanName,
        email: cleanEmail,
        alternateContact: cleanAlt,
        preferredLocale: input.preferredLocale,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, path);
    }
  };

  const requestSocietyChange = async (input: {
    invitationCode: string;
    tower: string;
    flatNumber: string;
    residentType: ResidentType;
  }) => {
    if (!functions) {
      throw new Error('Firebase Functions client is not configured.');
    }
    const callable = httpsCallable(functions, 'changeResidentSociety');
    await callable({
      invitationCode: input.invitationCode.trim().toUpperCase(),
      tower: input.tower.trim(),
      flatNumber: input.flatNumber.trim(),
      residentType: input.residentType,
    });
  };

  const logout = async () => {
    if (!auth) return;
    resetOtpState();
    await signOut(auth);
  };

  return (
    <AppAuthContext.Provider
      value={{
        firebaseUser,
        profile,
        lifecycleState,
        staffProfile,
        staffRole,
        isAdminAuthorized,
        adminPermissions,
        locale,
        setLocale,
        loading,
        connectionStatus,
        connectionError,
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
      }}
    >
      {children}
    </AppAuthContext.Provider>
  );
}

export function useAppAuth() {
  const ctx = useContext(AppAuthContext);
  if (!ctx) throw new Error('useAppAuth must be used inside AppAuthProvider');
  return ctx;
}
