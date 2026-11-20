import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { FirebaseAuthTypes } from '@react-native-firebase/auth';
import type {
  AuthLifecycleState,
  ResidentType,
  SupportedLocale,
  UserProfile,
} from '@society-marketplace/shared-types';
import { OTP_SECURITY_CONFIG } from '@society-marketplace/constants';
import { resolveAuthLifecycleState } from '@society-marketplace/business-logic';
import { normalizeIndianPhone } from '@society-marketplace/validation';
import {
  customerAuth,
  customerFirestore,
  customerFunctions,
  getCustomerFirebaseStatus,
} from '../services/firebase';

interface AuthContextValue {
  firebaseUser: FirebaseAuthTypes.User | null;
  profile: UserProfile | null;
  lifecycleState: AuthLifecycleState;
  locale: SupportedLocale;
  setLocale: (loc: SupportedLocale) => void;
  loading: boolean;
  configError: string | null;
  otpCooldownSeconds: number;
  otpVerifyAttempts: number;
  otpLockedUntilMs: number | null;
  sendPhoneOtp: (rawPhone: string) => Promise<string>;
  confirmPhoneOtp: (code: string, fallbackVerificationId?: string) => Promise<void>;
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
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function mapNativePhoneAuthError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (raw.includes('auth/invalid-phone-number')) {
    return 'Invalid mobile number format. Enter a valid 10-digit Indian mobile number (+91).';
  }
  if (raw.includes('auth/invalid-verification-code')) {
    return 'Incorrect OTP code entered. Please verify and try again.';
  }
  if (raw.includes('auth/session-expired') || raw.includes('auth/code-expired')) {
    return 'OTP has expired. Tap Resend OTP to receive a fresh code.';
  }
  if (raw.includes('auth/too-many-requests')) {
    return 'Too many OTP requests detected. Please wait before trying again.';
  }
  if (raw.includes('auth/network-request-failed')) {
    return 'Network error while verifying phone OTP. Check connectivity and try again.';
  }
  return raw;
}

export function CustomerAuthProvider({ children }: { children: React.ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<FirebaseAuthTypes.User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [locale, setLocaleState] = useState<SupportedLocale>('en');
  const [loading, setLoading] = useState(true);
  const [configError, setConfigError] = useState<string | null>(null);

  const [otpCooldownSeconds, setOtpCooldownSeconds] = useState(0);
  const [otpVerifyAttempts, setOtpVerifyAttempts] = useState(0);
  const [otpLockedUntilMs, setOtpLockedUntilMs] = useState<number | null>(null);
  const confirmationRef = useRef<FirebaseAuthTypes.ConfirmationResult | null>(null);

  useEffect(() => {
    if (otpCooldownSeconds <= 0) return;
    const timer = setInterval(() => {
      setOtpCooldownSeconds((prev) => (prev > 1 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [otpCooldownSeconds]);

  useEffect(() => {
    const status = getCustomerFirebaseStatus();
    if (!status.configured) {
      setConfigError(status.error ?? 'Firebase configuration is pending.');
      setLoading(false);
      return;
    }

    let unsubProfile: (() => void) | undefined;
    const unsubAuth = customerAuth().onAuthStateChanged((user) => {
      setFirebaseUser(user);
      if (unsubProfile) unsubProfile();

      if (!user) {
        setProfile(null);
        setLoading(false);
        return;
      }

      unsubProfile = customerFirestore()
        .collection('users')
        .doc(user.uid)
        .onSnapshot(
          (snap) => {
            if (snap.exists) {
              const data = snap.data() as UserProfile;
              setProfile(data);
              if (data.preferredLocale === 'en' || data.preferredLocale === 'hi') {
                setLocaleState(data.preferredLocale);
              }
            } else {
              setProfile(null);
            }
            setLoading(false);
          },
          () => {
            setLoading(false);
          }
        );
    });

    return () => {
      unsubAuth();
      if (unsubProfile) unsubProfile();
    };
  }, []);

  const lifecycleState = resolveAuthLifecycleState(Boolean(firebaseUser), profile);

  const setLocale = (loc: SupportedLocale) => {
    setLocaleState(loc);
    if (firebaseUser && profile?.accountStatus === 'active') {
      customerFirestore()
        .collection('users')
        .doc(firebaseUser.uid)
        .update({
          preferredLocale: loc,
          updatedAt: customerFirestore.FieldValue.serverTimestamp(),
        })
        .catch(() => {});
    }
  };

  const sendPhoneOtp = async (rawPhone: string): Promise<string> => {
    if (otpCooldownSeconds > 0) {
      throw new Error(`Please wait ${otpCooldownSeconds} seconds before requesting another OTP.`);
    }
    const normalized = normalizeIndianPhone(rawPhone);
    try {
      const confirmation = await customerAuth().signInWithPhoneNumber(normalized);
      confirmationRef.current = confirmation;
      setOtpVerifyAttempts(0);
      setOtpLockedUntilMs(null);
      setOtpCooldownSeconds(OTP_SECURITY_CONFIG.RESEND_COOLDOWN_SECONDS);
      return confirmation.verificationId ?? '';
    } catch (err) {
      throw new Error(mapNativePhoneAuthError(err));
    }
  };

  const confirmPhoneOtp = async (code: string, fallbackVerificationId?: string) => {
    if (otpLockedUntilMs && Date.now() < otpLockedUntilMs) {
      const minsLeft = Math.ceil((otpLockedUntilMs - Date.now()) / 60000);
      throw new Error(`Too many failed OTP attempts. Please wait ${minsLeft} minute(s) and request a new OTP.`);
    }
    try {
      if (confirmationRef.current) {
        await confirmationRef.current.confirm(code.trim());
      } else if (fallbackVerificationId) {
        const credential = customerAuth.PhoneAuthProvider.credential(
          fallbackVerificationId,
          code.trim()
        );
        await customerAuth().signInWithCredential(credential);
      } else {
        throw new Error('OTP session expired. Request a new code.');
      }
      await customerFunctions().httpsCallable('syncAuthenticatedUserProfile')({});
      setOtpVerifyAttempts(0);
      setOtpLockedUntilMs(null);
      confirmationRef.current = null;
    } catch (err) {
      const next = otpVerifyAttempts + 1;
      setOtpVerifyAttempts(next);
      if (next >= OTP_SECURITY_CONFIG.MAX_VERIFY_ATTEMPTS) {
        setOtpLockedUntilMs(Date.now() + OTP_SECURITY_CONFIG.LOCKOUT_MINUTES * 60 * 1000);
      }
      throw new Error(mapNativePhoneAuthError(err));
    }
  };

  const acknowledgeVerificationApproval = async () => {
    if (!firebaseUser) return;
    await customerFirestore().collection('users').doc(firebaseUser.uid).update({
      approvalAcknowledged: true,
      updatedAt: customerFirestore.FieldValue.serverTimestamp(),
    });
  };

  const updateAllowedProfile = async (input: {
    fullName: string;
    email?: string;
    alternateContact?: string;
    preferredLocale: SupportedLocale;
  }) => {
    await customerFunctions().httpsCallable('updateCustomerProfile')({
      fullName: input.fullName.trim(),
      email: (input.email ?? '').trim(),
      alternateContact: input.alternateContact?.trim()
        ? normalizeIndianPhone(input.alternateContact)
        : '',
      preferredLocale: input.preferredLocale,
    });
  };

  const requestSocietyChange = async (input: {
    invitationCode: string;
    tower: string;
    flatNumber: string;
    residentType: ResidentType;
  }) => {
    await customerFunctions().httpsCallable('changeResidentSociety')({
      invitationCode: input.invitationCode.trim().toUpperCase(),
      tower: input.tower.trim(),
      flatNumber: input.flatNumber.trim(),
      residentType: input.residentType,
    });
  };

  return (
    <AuthContext.Provider
      value={{
        firebaseUser,
        profile,
        lifecycleState,
        locale,
        setLocale,
        loading,
        configError,
        otpCooldownSeconds,
        otpVerifyAttempts,
        otpLockedUntilMs,
        sendPhoneOtp,
        confirmPhoneOtp,
        acknowledgeVerificationApproval,
        updateAllowedProfile,
        requestSocietyChange,
        signOut: async () => {
          confirmationRef.current = null;
          setOtpVerifyAttempts(0);
          setOtpLockedUntilMs(null);
          await customerAuth().signOut();
        },
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useCustomerAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useCustomerAuth must be used inside CustomerAuthProvider');
  return ctx;
}
