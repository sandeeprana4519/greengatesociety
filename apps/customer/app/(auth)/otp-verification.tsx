import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { OTP_SECURITY_CONFIG } from '@society-marketplace/constants';
import { useCustomerAuth } from '../../contexts/AuthContext';

export default function OtpVerificationScreen() {
  const { phone, verificationId } = useLocalSearchParams<{ phone: string; verificationId: string }>();
  const router = useRouter();
  const {
    confirmPhoneOtp,
    sendPhoneOtp,
    otpCooldownSeconds,
    otpVerifyAttempts,
    otpLockedUntilMs,
  } = useCustomerAuth();
  const [code, setCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isLocked = Boolean(otpLockedUntilMs && Date.now() < otpLockedUntilMs);

  const handleVerify = async () => {
    setError(null);
    if (code.trim().length !== 6) {
      setError('Enter the 6-digit OTP code.');
      return;
    }
    setVerifying(true);
    try {
      await confirmPhoneOtp(code, verificationId);
      router.replace('/(auth)/society-verification');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'OTP verification failed.');
    } finally {
      setVerifying(false);
    }
  };

  const handleResend = async () => {
    if (!phone || otpCooldownSeconds > 0) return;
    setError(null);
    try {
      await sendPhoneOtp(phone);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to resend OTP.');
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#F8FAF9', padding: 24, justifyContent: 'center' }}>
      <Text style={{ fontSize: 24, fontWeight: '700', color: '#0F172A', marginBottom: 8 }}>
        Verify Mobile OTP
      </Text>
      <Text style={{ fontSize: 14, color: '#475569', marginBottom: 20 }}>
        Code sent to {phone}
      </Text>

      <TextInput
        value={code}
        onChangeText={setCode}
        keyboardType="number-pad"
        maxLength={6}
        placeholder="6-digit OTP"
        style={{
          backgroundColor: '#FFFFFF',
          borderWidth: 1,
          borderColor: '#CBD5E1',
          borderRadius: 12,
          paddingHorizontal: 16,
          paddingVertical: 14,
          fontSize: 20,
          letterSpacing: 6,
          marginBottom: 12,
        }}
      />

      {otpVerifyAttempts > 0 ? (
        <Text style={{ color: '#B45309', fontSize: 12, marginBottom: 8 }}>
          Attempts used: {otpVerifyAttempts} / {OTP_SECURITY_CONFIG.MAX_VERIFY_ATTEMPTS}
        </Text>
      ) : null}

      {error ? <Text style={{ color: '#DC2626', fontSize: 13, marginBottom: 12 }}>{error}</Text> : null}

      <Pressable
        onPress={handleVerify}
        disabled={verifying || isLocked}
        style={{
          backgroundColor: isLocked ? '#64748B' : '#0F3D2E',
          borderRadius: 12,
          paddingVertical: 16,
          alignItems: 'center',
          marginBottom: 12,
        }}
      >
        {verifying ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <Text style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '600' }}>Verify &amp; Continue</Text>
        )}
      </Pressable>

      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Pressable onPress={() => router.replace('/(auth)/login')}>
          <Text style={{ color: '#475569', fontSize: 13, fontWeight: '600' }}>Change Number</Text>
        </Pressable>
        <Pressable onPress={handleResend} disabled={otpCooldownSeconds > 0}>
          <Text
            style={{
              color: otpCooldownSeconds > 0 ? '#94A3B8' : '#0F3D2E',
              fontSize: 13,
              fontWeight: '600',
            }}
          >
            {otpCooldownSeconds > 0 ? `Resend in ${otpCooldownSeconds}s` : 'Resend OTP'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
