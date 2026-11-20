import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import type { ResidentType } from '@society-marketplace/shared-types';
import { validateSocietyVerificationInput } from '@society-marketplace/validation';
import { useCustomerAuth } from '../../contexts/AuthContext';
import { customerFunctions } from '../../services/firebase';

export default function SocietyVerificationScreen() {
  const { lifecycleState, profile, acknowledgeVerificationApproval, signOut } = useCustomerAuth();
  const router = useRouter();
  const [invitationCode, setInvitationCode] = useState('');
  const [verifiedSociety, setVerifiedSociety] = useState<{
    societyId: string;
    societyName: string;
    city?: string;
  } | null>(null);
  const [residentName, setResidentName] = useState(profile?.fullName ?? profile?.name ?? '');
  const [residentType, setResidentType] = useState<ResidentType>(profile?.residentType ?? 'Owner');
  const [tower, setTower] = useState('');
  const [flatNumber, setFlatNumber] = useState('');
  const [email, setEmail] = useState(profile?.email ?? '');
  const [alternateContact, setAlternateContact] = useState(profile?.alternateContact ?? '');
  const [addressConfirmed, setAddressConfirmed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (lifecycleState === 'account_suspended') {
    return (
      <View style={{ flex: 1, padding: 24, justifyContent: 'center', backgroundColor: '#F8FAF9' }}>
        <Text style={{ fontSize: 22, fontWeight: '700', color: '#991B1B', marginBottom: 8 }}>
          Account Suspended
        </Text>
        <Text style={{ fontSize: 15, color: '#475569', marginBottom: 12 }}>
          Your resident marketplace access has been suspended by society administration.
        </Text>
        {profile?.suspensionReason ? (
          <View style={{ backgroundColor: '#FEF2F2', borderWidth: 1, borderColor: '#FECACA', borderRadius: 12, padding: 12, marginBottom: 20 }}>
            <Text style={{ color: '#991B1B', fontSize: 13 }}>{profile.suspensionReason}</Text>
          </View>
        ) : null}
        <Pressable onPress={signOut} style={{ backgroundColor: '#0F172A', borderRadius: 12, padding: 14, alignItems: 'center' }}>
          <Text style={{ color: '#FFFFFF', fontWeight: '600' }}>Sign Out</Text>
        </Pressable>
      </View>
    );
  }

  if (lifecycleState === 'verification_approved') {
    return (
      <View style={{ flex: 1, padding: 24, justifyContent: 'center', backgroundColor: '#F8FAF9' }}>
        <Text style={{ fontSize: 13, fontWeight: '700', color: '#0F3D2E', marginBottom: 6 }}>
          Verification Approved
        </Text>
        <Text style={{ fontSize: 24, fontWeight: '700', color: '#0F172A', marginBottom: 10 }}>
          Welcome to Your Society Marketplace
        </Text>
        <Text style={{ fontSize: 15, color: '#475569', lineHeight: 22, marginBottom: 20 }}>
          Your flat ({profile?.tower} · {profile?.flatNumber || profile?.flatId}) has been verified. Explore society bulk offers, group buying batches, and vetted home services.
        </Text>
        <Pressable
          onPress={async () => {
            await acknowledgeVerificationApproval();
            router.replace('/(tabs)');
          }}
          style={{ backgroundColor: '#0F3D2E', borderRadius: 12, padding: 16, alignItems: 'center' }}
        >
          <Text style={{ color: '#FFFFFF', fontWeight: '600', fontSize: 15 }}>Enter Society Marketplace</Text>
        </Pressable>
      </View>
    );
  }

  if (lifecycleState === 'verification_pending') {
    return (
      <View style={{ flex: 1, padding: 24, justifyContent: 'center', backgroundColor: '#F8FAF9' }}>
        <Text style={{ fontSize: 22, fontWeight: '700', color: '#0F3D2E', marginBottom: 8 }}>
          Waiting for Society Admin Approval
        </Text>
        <Text style={{ fontSize: 15, color: '#475569', lineHeight: 22, marginBottom: 16 }}>
          Your flat details ({profile?.tower} / {profile?.flatNumber || profile?.flatId}) have been submitted for review.
          Marketplace access will unlock once an administrator approves your membership.
        </Text>
        {profile?.infoRequestNote ? (
          <View style={{ backgroundColor: '#FFFBEB', borderWidth: 1, borderColor: '#FDE68A', borderRadius: 12, padding: 12, marginBottom: 16 }}>
            <Text style={{ fontWeight: '700', color: '#92400E', fontSize: 13, marginBottom: 4 }}>
              Admin Information Request
            </Text>
            <Text style={{ color: '#92400E', fontSize: 13 }}>{profile.infoRequestNote}</Text>
          </View>
        ) : null}
        <Pressable onPress={signOut} style={{ borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 12, padding: 14, alignItems: 'center' }}>
          <Text style={{ color: '#0F172A', fontWeight: '600' }}>Sign Out</Text>
        </Pressable>
      </View>
    );
  }

  const handleValidateInvite = async () => {
    setError(null);
    setLoading(true);
    try {
      const res = await customerFunctions().httpsCallable('validateInvitationCode')({
        invitationCode: invitationCode.trim().toUpperCase(),
      });
      const data = res.data as { societyId: string; societyName: string; city?: string };
      setVerifiedSociety(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid society invitation code.');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmitVerification = async () => {
    setError(null);
    const check = validateSocietyVerificationInput({
      residentName,
      tower,
      flatId: flatNumber,
      invitationCode,
      residentType,
      email,
      alternateContact,
      addressConfirmed,
    });
    if (!check.valid) {
      setError(check.error ?? 'Invalid details.');
      return;
    }
    setLoading(true);
    try {
      await customerFunctions().httpsCallable('submitSocietyVerification')({
        invitationCode: invitationCode.trim().toUpperCase(),
        residentName: residentName.trim(),
        residentType,
        tower: tower.trim(),
        flatId: flatNumber.trim(),
        flatNumber: flatNumber.trim(),
        email: email.trim() || undefined,
        alternateContact: alternateContact.trim() || undefined,
        addressConfirmed,
        idempotencyKey: `ver_${Date.now()}`,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to submit verification.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={{ flexGrow: 1, padding: 24, justifyContent: 'center', backgroundColor: '#F8FAF9' }}>
      <Text style={{ fontSize: 24, fontWeight: '700', color: '#0F172A', marginBottom: 8 }}>
        {lifecycleState === 'verification_rejected' ? 'Resubmit Society Verification' : 'Verify Your Society'}
      </Text>

      {lifecycleState === 'verification_rejected' && profile?.rejectionReason ? (
        <View style={{ backgroundColor: '#FEF2F2', borderWidth: 1, borderColor: '#FECACA', borderRadius: 12, padding: 12, marginBottom: 16 }}>
          <Text style={{ color: '#991B1B', fontWeight: '700', fontSize: 13 }}>Rejection Reason</Text>
          <Text style={{ color: '#991B1B', fontSize: 13, marginTop: 4 }}>{profile.rejectionReason}</Text>
        </View>
      ) : null}

      <Text style={{ fontSize: 14, color: '#475569', marginBottom: 16 }}>
        Enter your residential society invitation code to verify your tower and flat.
      </Text>

      <TextInput
        value={invitationCode}
        onChangeText={(v) => setInvitationCode(v.toUpperCase())}
        placeholder="Invitation Code (e.g. PALMDEMO26)"
        autoCapitalize="characters"
        style={{ backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 12, padding: 14, marginBottom: 12 }}
      />

      {!verifiedSociety ? (
        <Pressable
          onPress={handleValidateInvite}
          disabled={loading}
          style={{ backgroundColor: '#0F3D2E', borderRadius: 12, padding: 16, alignItems: 'center', marginBottom: 12 }}
        >
          {loading ? <ActivityIndicator color="#FFFFFF" /> : <Text style={{ color: '#FFFFFF', fontWeight: '600' }}>Validate Invitation Code</Text>}
        </Pressable>
      ) : (
        <View style={{ gap: 12 }}>
          <Text style={{ fontSize: 14, fontWeight: '600', color: '#15803D' }}>
            Society Matched: {verifiedSociety.societyName}
            {verifiedSociety.city ? ` (${verifiedSociety.city})` : ''}
          </Text>
          <TextInput
            value={residentName}
            onChangeText={setResidentName}
            placeholder="Resident Full Name"
            style={{ backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 12, padding: 14 }}
          />
          <View style={{ flexDirection: 'row', gap: 10 }}>
            {(['Owner', 'Tenant'] as ResidentType[]).map((t) => (
              <Pressable
                key={t}
                onPress={() => setResidentType(t)}
                style={{
                  flex: 1,
                  borderWidth: 1,
                  borderColor: residentType === t ? '#0F3D2E' : '#CBD5E1',
                  backgroundColor: residentType === t ? '#0F3D2E' : '#FFFFFF',
                  borderRadius: 12,
                  paddingVertical: 12,
                  alignItems: 'center',
                }}
              >
                <Text style={{ color: residentType === t ? '#FFFFFF' : '#0F172A', fontWeight: '600' }}>
                  {t}
                </Text>
              </Pressable>
            ))}
          </View>
          <TextInput
            value={tower}
            onChangeText={setTower}
            placeholder="Tower / Block (e.g. Tower A)"
            style={{ backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 12, padding: 14 }}
          />
          <TextInput
            value={flatNumber}
            onChangeText={setFlatNumber}
            placeholder="Flat Number (e.g. A-402)"
            style={{ backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 12, padding: 14 }}
          />
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="Email Address (Optional)"
            keyboardType="email-address"
            style={{ backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 12, padding: 14 }}
          />
          <TextInput
            value={alternateContact}
            onChangeText={setAlternateContact}
            placeholder="Alternate Contact Number (Optional)"
            keyboardType="phone-pad"
            style={{ backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 12, padding: 14 }}
          />
          <Pressable
            onPress={() => setAddressConfirmed((v) => !v)}
            style={{
              backgroundColor: '#FFFFFF',
              borderWidth: 1,
              borderColor: addressConfirmed ? '#0F3D2E' : '#CBD5E1',
              borderRadius: 12,
              padding: 14,
            }}
          >
            <Text style={{ fontSize: 13, color: '#0F172A' }}>
              {addressConfirmed ? '[Confirmed] ' : '[Tap to Confirm] '}
              I confirm that my society, tower, and flat details are accurate for primary resident verification.
            </Text>
          </Pressable>
          <Pressable
            onPress={handleSubmitVerification}
            disabled={loading}
            style={{ backgroundColor: '#0F3D2E', borderRadius: 12, padding: 16, alignItems: 'center' }}
          >
            {loading ? <ActivityIndicator color="#FFFFFF" /> : <Text style={{ color: '#FFFFFF', fontWeight: '600' }}>Submit For Admin Approval</Text>}
          </Pressable>
        </View>
      )}

      {error ? <Text style={{ color: '#DC2626', fontSize: 13, marginTop: 12 }}>{error}</Text> : null}
    </ScrollView>
  );
}
