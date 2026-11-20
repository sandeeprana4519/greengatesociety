import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, TextInput, Pressable } from 'react-native';
import type { ServiceCatalogItem } from '@society-marketplace/shared-types';
import { SERVICE_CATEGORIES, SERVICE_TIME_SLOTS } from '@society-marketplace/constants';
import { formatINRFromPaise } from '@society-marketplace/business-logic';
import { validateServiceBookingInput } from '@society-marketplace/validation';
import { useCustomerAuth } from '../../contexts/AuthContext';
import { customerFirestore, customerFunctions } from '../../services/firebase';

export default function CustomerServicesScreen() {
  const { profile } = useCustomerAuth();
  const [services, setServices] = useState<ServiceCatalogItem[]>([]);
  const [selectedService, setSelectedService] = useState<ServiceCatalogItem | null>(null);
  const [serviceAddress, setServiceAddress] = useState(`${profile?.tower ?? ''} ${profile?.flatId ?? ''}`.trim());
  const [preferredDate, setPreferredDate] = useState('2026-12-01');
  const [timeSlot, setTimeSlot] = useState<string>(SERVICE_TIME_SLOTS[0]);
  const [problemDescription, setProblemDescription] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    return customerFirestore()
      .collection('services')
      .where('available', '==', true)
      .onSnapshot((s) => setServices(s.docs.map((d) => d.data() as ServiceCatalogItem)));
  }, []);

  const handleBook = async () => {
    if (!selectedService) return;
    const check = validateServiceBookingInput({
      serviceId: selectedService.serviceId,
      serviceAddress,
      preferredDate,
      timeSlot,
      problemDescription,
    });
    if (!check.valid) {
      setMessage(check.error ?? 'Invalid booking inputs.');
      return;
    }

    const res = await customerFunctions().httpsCallable('createServiceBooking')({
      serviceId: selectedService.serviceId,
      serviceAddress,
      preferredDate,
      timeSlot,
      problemDescription,
      idempotencyKey: `svc_${Date.now()}`,
    });
    const data = res.data as { bookingId: string };
    setSelectedService(null);
    setProblemDescription('');
    setMessage(`Service booking ${data.bookingId} submitted.`);
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: '#F8FAF9' }} contentContainerStyle={{ padding: 16, gap: 16 }}>
      <Text style={{ fontSize: 22, fontWeight: '700', color: '#0F172A', paddingTop: 12 }}>Home Services</Text>
      <Text style={{ fontSize: 13, color: '#64748B' }}>
        Verified Flat: {profile?.tower} / {profile?.flatId}
      </Text>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {SERVICE_CATEGORIES.map((cat) => (
          <View key={cat} style={{ backgroundColor: '#FFFFFF', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10 }}>
            <Text style={{ fontSize: 12, fontWeight: '600', color: '#0F3D2E' }}>{cat}</Text>
          </View>
        ))}
      </View>

      {services.map((svc) => (
        <View key={svc.serviceId} style={{ backgroundColor: '#FFFFFF', borderRadius: 16, padding: 16, gap: 6 }}>
          <Text style={{ fontSize: 16, fontWeight: '700', color: '#0F172A' }}>{svc.title}</Text>
          <Text style={{ fontSize: 12, color: '#64748B' }}>{svc.category}</Text>
          <Text style={{ fontSize: 13, color: '#475569' }}>{svc.description}</Text>
          <Text style={{ fontSize: 14, fontWeight: '700', color: '#0F3D2E' }}>
            Starts at {formatINRFromPaise(svc.startingPricePaise)}
          </Text>
          <Pressable
            onPress={() => setSelectedService(svc)}
            style={{ backgroundColor: '#0F3D2E', borderRadius: 10, paddingVertical: 10, alignItems: 'center', marginTop: 6 }}
          >
            <Text style={{ color: '#FFFFFF', fontWeight: '600' }}>Book Service</Text>
          </Pressable>
        </View>
      ))}

      {selectedService ? (
        <View style={{ backgroundColor: '#FFFFFF', borderRadius: 16, padding: 16, gap: 10 }}>
          <Text style={{ fontSize: 16, fontWeight: '700', color: '#0F172A' }}>Book: {selectedService.title}</Text>
          <TextInput
            value={serviceAddress}
            onChangeText={setServiceAddress}
            placeholder="Service Address"
            style={{ borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 10, padding: 12 }}
          />
          <TextInput
            value={preferredDate}
            onChangeText={setPreferredDate}
            placeholder="Preferred Date (YYYY-MM-DD)"
            style={{ borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 10, padding: 12 }}
          />
          <TextInput
            value={timeSlot}
            onChangeText={setTimeSlot}
            placeholder="Preferred Time Slot"
            style={{ borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 10, padding: 12 }}
          />
          <TextInput
            value={problemDescription}
            onChangeText={setProblemDescription}
            placeholder="Describe the issue..."
            multiline
            style={{ borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 10, padding: 12, minHeight: 80 }}
          />
          <Pressable onPress={handleBook} style={{ backgroundColor: '#0F3D2E', borderRadius: 12, paddingVertical: 14, alignItems: 'center' }}>
            <Text style={{ color: '#FFFFFF', fontWeight: '700' }}>Confirm Booking</Text>
          </Pressable>
        </View>
      ) : null}

      {message ? <Text style={{ color: '#0F3D2E', fontWeight: '600' }}>{message}</Text> : null}
    </ScrollView>
  );
}
