import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { normalizeIndianPhone, validateIndianPhone } from '@society-marketplace/validation';
import { useCustomerAuth } from '../../contexts/AuthContext';

export default function LoginScreen() {
  const router = useRouter();
  const { sendPhoneOtp, otpCooldownSeconds } = useCustomerAuth();
  const [phone, setPhone] = useState('+91');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSendOtp = async () => {
    setError(null);
    const check = validateIndianPhone(phone);
    if (!check.valid) {
      setError(check.error ?? 'Invalid mobile number.');
      return;
    }
    setSubmitting(true);
    try {
      const normalized = normalizeIndianPhone(phone);
      const verificationId = await sendPhoneOtp(normalized);
      router.push({
        pathname: '/(auth)/otp-verification',
        params: { phone: normalized, verificationId },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to send OTP.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#F8FAF9', padding: 24, justifyContent: 'center' }}>
      <Text style={{ fontSize: 13, fontWeight: '600', color: '#0F3D2E', marginBottom: 8 }}>
        GreenGate Society Marketplace
      </Text>
      <Text style={{ fontSize: 28, fontWeight: '700', color: '#0F172A', marginBottom: 8 }}>
        Resident Sign In
      </Text>
      <Text style={{ fontSize: 15, color: '#475569', marginBottom: 24 }}>
        Enter your Indian mobile number (+91) to verify via Firebase Phone OTP.
      </Text>

      <TextInput
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
        placeholder="+919876543210"
        style={{
          backgroundColor: '#FFFFFF',
          borderWidth: 1,
          borderColor: '#CBD5E1',
          borderRadius: 12,
          paddingHorizontal: 16,
          paddingVertical: 14,
          fontSize: 16,
          marginBottom: 12,
        }}
      />

      {error ? (
        <Text style={{ color: '#DC2626', fontSize: 13, marginBottom: 12 }}>{error}</Text>
      ) : null}

      <Pressable
        onPress={handleSendOtp}
        disabled={submitting || otpCooldownSeconds > 0}
        style={{
          backgroundColor: otpCooldownSeconds > 0 ? '#64748B' : '#0F3D2E',
          borderRadius: 12,
          paddingVertical: 16,
          alignItems: 'center',
        }}
      >
        {submitting ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <Text style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '600' }}>
            {otpCooldownSeconds > 0 ? `Wait ${otpCooldownSeconds}s` : 'Send OTP'}
          </Text>
        )}
      </Pressable>
    </View>
  );
}
