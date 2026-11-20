import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable, Image, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { Bell, User } from 'lucide-react-native';
import type {
  BulkOfferCampaign,
  GroupBuyCampaign,
  Order,
  ServiceBooking,
  CampaignParticipation,
  Society,
} from '@society-marketplace/shared-types';
import {
  formatINRFromPaise,
  calculateSavingsPaise,
  calculateTargetProgress,
} from '@society-marketplace/business-logic';
import { I18N_STRINGS } from '@society-marketplace/constants';
import { useCustomerAuth } from '../../contexts/AuthContext';
import { customerFirestore, customerFunctions } from '../../services/firebase';

export default function CustomerHomeScreen() {
  const { profile, locale } = useCustomerAuth();
  const router = useRouter();
  const t = I18N_STRINGS[locale];
  const societyId = profile?.societyId;

  const [society, setSociety] = useState<Society | null>(null);
  const [bulkOffers, setBulkOffers] = useState<BulkOfferCampaign[]>([]);
  const [groupOffers, setGroupOffers] = useState<GroupBuyCampaign[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [bookings, setBookings] = useState<ServiceBooking[]>([]);
  const [participations, setParticipations] = useState<CampaignParticipation[]>([]);
  const [loading, setLoading] = useState(true);
  const [joiningId, setJoiningId] = useState<string | null>(null);

  useEffect(() => {
    if (!societyId || !profile?.uid) return;
    const socRef = customerFirestore().collection('societies').doc(societyId);

    const unsubSoc = socRef.onSnapshot((s) => setSociety(s.exists ? (s.data() as Society) : null));
    const unsubBulk = socRef
      .collection('campaigns')
      .where('status', 'in', ['active', 'target_met'])
      .onSnapshot((s) => {
        setBulkOffers(s.docs.map((d) => d.data() as BulkOfferCampaign));
        setLoading(false);
      });
    const unsubGroup = socRef
      .collection('groupCampaigns')
      .where('status', 'in', ['active', 'target_met'])
      .onSnapshot((s) => setGroupOffers(s.docs.map((d) => d.data() as GroupBuyCampaign)));
    const unsubOrders = socRef
      .collection('orders')
      .where('uid', '==', profile.uid)
      .onSnapshot((s) => setOrders(s.docs.map((d) => d.data() as Order)));
    const unsubBookings = socRef
      .collection('serviceBookings')
      .where('uid', '==', profile.uid)
      .onSnapshot((s) => setBookings(s.docs.map((d) => d.data() as ServiceBooking)));
    const unsubParts = socRef
      .collection('participations')
      .where('uid', '==', profile.uid)
      .onSnapshot((s) => setParticipations(s.docs.map((d) => d.data() as CampaignParticipation)));

    return () => {
      unsubSoc();
      unsubBulk();
      unsubGroup();
      unsubOrders();
      unsubBookings();
      unsubParts();
    };
  }, [societyId, profile?.uid]);

  const handleJoin = async (campaignId: string, campaignType: 'bulk_offer' | 'group_buy') => {
    setJoiningId(campaignId);
    try {
      await customerFunctions().httpsCallable('joinSocietyCampaign')({
        campaignId,
        campaignType,
        quantity: 1,
        idempotencyKey: `${campaignType}_${campaignId}_${Date.now()}`,
      });
    } finally {
      setJoiningId(null);
    }
  };

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F8FAF9' }}>
        <ActivityIndicator color="#0F3D2E" />
      </View>
    );
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: '#F8FAF9' }} contentContainerStyle={{ padding: 16, gap: 24 }}>
      {/* Header */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 12 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 13, color: '#475569' }}>{t.welcomeBack}</Text>
          <Text style={{ fontSize: 20, fontWeight: '700', color: '#0F172A' }}>{profile?.name}</Text>
          <Text style={{ fontSize: 13, color: '#0F3D2E', fontWeight: '500' }}>
            {society?.societyName ?? societyId} · {profile?.tower} / {profile?.flatId}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Pressable onPress={() => router.push('/orders')} style={{ padding: 10, backgroundColor: '#FFFFFF', borderRadius: 12 }}>
            <Bell size={20} color="#0F172A" />
          </Pressable>
          <Pressable onPress={() => router.push('/profile')} style={{ padding: 10, backgroundColor: '#FFFFFF', borderRadius: 12 }}>
            <User size={20} color="#0F172A" />
          </Pressable>
        </View>
      </View>

      {/* Bulk Vendor Offers */}
      <View style={{ gap: 12 }}>
        <Text style={{ fontSize: 18, fontWeight: '700', color: '#0F172A' }}>{t.bulkOffersTitle}</Text>
        {bulkOffers.length === 0 ? (
          <View style={{ backgroundColor: '#FFFFFF', padding: 20, borderRadius: 16 }}>
            <Text style={{ color: '#64748B' }}>No active bulk vendor offers for your society yet.</Text>
          </View>
        ) : (
          bulkOffers.map((offer) => {
            const pct = calculateTargetProgress(offer.currentParticipants, offer.minimumTarget);
            const savings = calculateSavingsPaise(offer.regularPricePaise, offer.offerPricePaise);
            return (
              <View key={offer.campaignId} style={{ backgroundColor: '#FFFFFF', borderRadius: 16, padding: 16, gap: 10 }}>
                {offer.imageUrl ? (
                  <Image source={{ uri: offer.imageUrl }} style={{ width: '100%', height: 140, borderRadius: 12 }} />
                ) : null}
                <Text style={{ fontSize: 16, fontWeight: '700', color: '#0F172A' }}>{offer.title}</Text>
                <Text style={{ fontSize: 13, color: '#475569' }}>
                  Regular {formatINRFromPaise(offer.regularPricePaise)} · Offer {formatINRFromPaise(offer.offerPricePaise)} · Save {formatINRFromPaise(savings)}
                </Text>
                <View style={{ height: 8, backgroundColor: '#E2E8F0', borderRadius: 999 }}>
                  <View style={{ width: `${pct}%`, height: 8, backgroundColor: '#0F3D2E', borderRadius: 999 }} />
                </View>
                <Text style={{ fontSize: 12, color: '#64748B' }}>
                  {offer.currentParticipants} / {offer.minimumTarget} flats joined · Deadline {offer.bookingDeadline} · Service {offer.scheduledDate}
                </Text>
                <Pressable
                  onPress={() => handleJoin(offer.campaignId, 'bulk_offer')}
                  disabled={joiningId === offer.campaignId}
                  style={{ backgroundColor: '#0F3D2E', borderRadius: 10, paddingVertical: 12, alignItems: 'center' }}
                >
                  <Text style={{ color: '#FFFFFF', fontWeight: '600' }}>
                    {joiningId === offer.campaignId ? 'Joining...' : t.joinOffer}
                  </Text>
                </Pressable>
              </View>
            );
          })
        )}
      </View>

      {/* Group Buying */}
      <View style={{ gap: 12 }}>
        <Text style={{ fontSize: 18, fontWeight: '700', color: '#0F172A' }}>{t.groupBuyingTitle}</Text>
        {groupOffers.length === 0 ? (
          <View style={{ backgroundColor: '#FFFFFF', padding: 20, borderRadius: 16 }}>
            <Text style={{ color: '#64748B' }}>No active group buying campaigns in your society.</Text>
          </View>
        ) : (
          groupOffers.map((g) => {
            const pct = calculateTargetProgress(g.currentQuantity, g.minimumGroupQuantity);
            const savings = calculateSavingsPaise(g.marketPricePaise, g.groupPricePaise);
            return (
              <View key={g.campaignId} style={{ backgroundColor: '#FFFFFF', borderRadius: 16, padding: 16, gap: 10 }}>
                <Text style={{ fontSize: 16, fontWeight: '700', color: '#0F172A' }}>{g.title}</Text>
                <Text style={{ fontSize: 13, color: '#475569' }}>
                  Market {formatINRFromPaise(g.marketPricePaise)} · Group {formatINRFromPaise(g.groupPricePaise)} · Save {formatINRFromPaise(savings)}
                </Text>
                <View style={{ height: 8, backgroundColor: '#E2E8F0', borderRadius: 999 }}>
                  <View style={{ width: `${pct}%`, height: 8, backgroundColor: '#15803D', borderRadius: 999 }} />
                </View>
                <Text style={{ fontSize: 12, color: '#64748B' }}>
                  {g.currentQuantity} / {g.minimumGroupQuantity} units · Deadline {g.deadline} · Delivery {g.expectedDeliveryDate}
                </Text>
                <Pressable
                  onPress={() => handleJoin(g.campaignId, 'group_buy')}
                  disabled={joiningId === g.campaignId}
                  style={{ backgroundColor: '#0F3D2E', borderRadius: 10, paddingVertical: 12, alignItems: 'center' }}
                >
                  <Text style={{ color: '#FFFFFF', fontWeight: '600' }}>
                    {joiningId === g.campaignId ? 'Joining...' : t.joinGroup}
                  </Text>
                </Pressable>
              </View>
            );
          })
        )}
      </View>

      {/* My Activities */}
      <View style={{ gap: 10, paddingBottom: 24 }}>
        <Text style={{ fontSize: 18, fontWeight: '700', color: '#0F172A' }}>{t.myActivitiesTitle}</Text>
        <View style={{ backgroundColor: '#FFFFFF', borderRadius: 16, padding: 16, gap: 8 }}>
          <Text style={{ fontWeight: '600', color: '#0F172A' }}>{t.myOrders}: {orders.length}</Text>
          <Text style={{ fontWeight: '600', color: '#0F172A' }}>{t.myGroups}: {participations.length}</Text>
          <Text style={{ fontWeight: '600', color: '#0F172A' }}>{t.myBookings}: {bookings.length}</Text>
        </View>
      </View>
    </ScrollView>
  );
}
