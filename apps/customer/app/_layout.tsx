import React, { useEffect } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { CustomerAuthProvider, useCustomerAuth } from '../contexts/AuthContext';

function RootGate() {
  const { lifecycleState, loading, configError } = useCustomerAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (loading || configError) return;
    const inAuthGroup = segments[0] === '(auth)';

    if (lifecycleState === 'unauthenticated') {
      if (!inAuthGroup) router.replace('/(auth)/login');
      return;
    }

    if (
      lifecycleState === 'otp_verified' ||
      lifecycleState === 'verification_submitted' ||
      lifecycleState === 'verification_pending' ||
      lifecycleState === 'verification_rejected' ||
      lifecycleState === 'verification_approved' ||
      lifecycleState === 'account_suspended'
    ) {
      if (!inAuthGroup) router.replace('/(auth)/society-verification');
      return;
    }

    if (lifecycleState === 'society_verified' && inAuthGroup) {
      router.replace('/(tabs)');
    }
  }, [lifecycleState, loading, configError, segments, router]);

  if (configError) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', padding: 24, backgroundColor: '#F8FAF9' }}>
        <Text style={{ fontSize: 18, fontWeight: '700', color: '#991B1B', marginBottom: 8 }}>
          Firebase Configuration Pending
        </Text>
        <Text style={{ fontSize: 14, color: '#334155', lineHeight: 20 }}>{configError}</Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F8FAF9' }}>
        <ActivityIndicator size="large" color="#0F3D2E" />
      </View>
    );
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}

export default function RootLayout() {
  return (
    <CustomerAuthProvider>
      <RootGate />
    </CustomerAuthProvider>
  );
}
