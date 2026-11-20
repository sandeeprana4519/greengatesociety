import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useCustomerAuth } from '../../contexts/AuthContext';

export default function ProfileScreen() {
  const {
    profile,
    locale,
    setLocale,
    updateAllowedProfile,
    requestSocietyChange,
    signOut,
  } = useCustomerAuth();
  const router = useRouter();

  const [fullName, setFullName] = useState(profile?.fullName ?? profile?.name ?? '');
  const [email, setEmail] = useState(profile?.email ?? '');
  const [alternateContact, setAlternateContact] = useState(profile?.alternateContact ?? '');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const [showTransfer, setShowTransfer] = useState(false);
  const [newCode, setNewCode] = useState('');
  const [newTower, setNewTower] = useState('');
  const [newFlat, setNewFlat] = useState('');

  const handleSaveProfile = async () => {
    setMessage(null);
    setSaving(true);
    try {
      await updateAllowedProfile({
        fullName,
        email,
        alternateContact,
        preferredLocale: locale,
      });
      setMessage('Profile updated.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Unable to save profile.');
    } finally {
      setSaving(false);
    }
  };

  const handleRequestTransfer = async () => {
    setMessage(null);
    setSaving(true);
    try {
      await requestSocietyChange({
        invitationCode: newCode,
        tower: newTower,
        flatNumber: newFlat,
        residentType: profile?.residentType ?? 'Owner',
      });
      setShowTransfer(false);
      setMessage('Society transfer submitted for re-verification.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Society change failed.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={{ flexGrow: 1, backgroundColor: '#F8FAF9', padding: 20, gap: 16 }}>
      <Text style={{ fontSize: 22, fontWeight: '700', color: '#0F172A' }}>Resident Profile</Text>
      <View style={{ backgroundColor: '#FFFFFF', borderRadius: 16, padding: 16, gap: 10 }}>
        <Text style={{ fontSize: 12, color: '#64748B' }}>
          Verified Flat (Admin Locked): {profile?.societyId} · {profile?.tower} / {profile?.flatNumber || profile?.flatId}
        </Text>
        <TextInput
          value={fullName}
          onChangeText={setFullName}
          placeholder="Full Name"
          style={{ borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 10, padding: 12 }}
        />
        <TextInput
          value={email}
          onChangeText={setEmail}
          placeholder="Email Address"
          keyboardType="email-address"
          style={{ borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 10, padding: 12 }}
        />
        <TextInput
          value={alternateContact}
          onChangeText={setAlternateContact}
          placeholder="Alternate Contact (+91...)"
          keyboardType="phone-pad"
          style={{ borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 10, padding: 12 }}
        />
        <Pressable
          onPress={handleSaveProfile}
          disabled={saving}
          style={{ backgroundColor: '#0F3D2E', borderRadius: 12, padding: 14, alignItems: 'center' }}
        >
          {saving ? <ActivityIndicator color="#FFFFFF" /> : <Text style={{ color: '#FFFFFF', fontWeight: '600' }}>Save Profile Changes</Text>}
        </Pressable>
      </View>

      <Pressable
        onPress={() => setLocale(locale === 'en' ? 'hi' : 'en')}
        style={{ backgroundColor: '#FFFFFF', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#E2E8F0' }}
      >
        <Text style={{ fontWeight: '600', color: '#0F172A' }}>
          Language: {locale === 'en' ? 'English (Switch to हिन्दी)' : 'हिन्दी (Switch to English)'}
        </Text>
      </Pressable>

      <Pressable
        onPress={() => setShowTransfer((v) => !v)}
        style={{ backgroundColor: '#FFFFFF', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#E2E8F0' }}
      >
        <Text style={{ fontWeight: '600', color: '#0F3D2E' }}>
          Change / Transfer Society (Requires Re-verification)
        </Text>
      </Pressable>

      {showTransfer ? (
        <View style={{ backgroundColor: '#FFFFFF', borderRadius: 16, padding: 16, gap: 10 }}>
          <TextInput
            value={newCode}
            onChangeText={(v) => setNewCode(v.toUpperCase())}
            placeholder="New Society Invitation Code"
            style={{ borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 10, padding: 12 }}
          />
          <TextInput
            value={newTower}
            onChangeText={setNewTower}
            placeholder="New Tower / Block"
            style={{ borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 10, padding: 12 }}
          />
          <TextInput
            value={newFlat}
            onChangeText={setNewFlat}
            placeholder="New Flat Number"
            style={{ borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 10, padding: 12 }}
          />
          <Pressable
            onPress={handleRequestTransfer}
            disabled={saving}
            style={{ backgroundColor: '#0F3D2E', borderRadius: 12, padding: 14, alignItems: 'center' }}
          >
            <Text style={{ color: '#FFFFFF', fontWeight: '600' }}>Submit Society Transfer</Text>
          </Pressable>
        </View>
      ) : null}

      {message ? <Text style={{ color: '#0F3D2E', fontSize: 13 }}>{message}</Text> : null}

      <Pressable onPress={() => router.back()} style={{ padding: 12, alignItems: 'center' }}>
        <Text style={{ color: '#0F3D2E', fontWeight: '600' }}>Back to Marketplace</Text>
      </Pressable>

      <Pressable onPress={signOut} style={{ backgroundColor: '#0F172A', borderRadius: 12, padding: 14, alignItems: 'center' }}>
        <Text style={{ color: '#FFFFFF', fontWeight: '600' }}>Sign Out</Text>
      </Pressable>
    </ScrollView>
  );
}
