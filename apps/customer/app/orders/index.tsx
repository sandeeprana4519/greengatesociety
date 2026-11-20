import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { useRouter } from 'expo-router';

export default function CustomerOrdersRoute() {
  const router = useRouter();
  return (
    <View style={{ flex: 1, padding: 20, justifyContent: 'center', backgroundColor: '#F8FAF9' }}>
      <Text style={{ fontSize: 18, fontWeight: '700' }}>My Orders & Notifications</Text>
      <Pressable onPress={() => router.back()} style={{ marginTop: 16 }}>
        <Text style={{ color: '#0F3D2E', fontWeight: '600' }}>Back</Text>
      </Pressable>
    </View>
  );
}
