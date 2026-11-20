import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, TextInput, Pressable } from 'react-native';
import type { Order, Product } from '@society-marketplace/shared-types';
import { formatINRFromPaise } from '@society-marketplace/business-logic';
import { PRODUCT_CATEGORIES } from '@society-marketplace/constants';
import { useCustomerAuth } from '../../contexts/AuthContext';
import { customerFirestore, customerFunctions } from '../../services/firebase';

export default function CustomerBuyScreen() {
  const { profile } = useCustomerAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string>('All');
  const [cart, setCart] = useState<Record<string, number>>({});
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  useEffect(() => {
    const unsubProd = customerFirestore()
      .collection('products')
      .where('active', '==', true)
      .onSnapshot((s) => setProducts(s.docs.map((d) => d.data() as Product)));

    let unsubOrd = () => {};
    if (profile?.societyId && profile?.uid) {
      unsubOrd = customerFirestore()
        .collection('societies')
        .doc(profile.societyId)
        .collection('orders')
        .where('uid', '==', profile.uid)
        .onSnapshot((s) => setOrders(s.docs.map((d) => d.data() as Order)));
    }
    return () => {
      unsubProd();
      unsubOrd();
    };
  }, [profile?.societyId, profile?.uid]);

  const filtered = products.filter((p) => {
    const matchesCat = category === 'All' || p.category === category;
    const matchesQuery = p.title.toLowerCase().includes(search.toLowerCase());
    return matchesCat && matchesQuery;
  });

  const handlePlaceOrder = async () => {
    const items = Object.entries(cart)
      .filter(([, qty]) => qty > 0)
      .map(([productId, quantity]) => ({ productId, quantity }));
    if (items.length === 0) return;

    const res = await customerFunctions().httpsCallable('createIndividualOrder')({
      items,
      idempotencyKey: `ord_${Date.now()}`,
    });
    const data = res.data as { orderId: string };
    setCart({});
    setStatusMsg(`Order ${data.orderId} placed. Payment integration is pending (no charge processed).`);
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: '#F8FAF9' }} contentContainerStyle={{ padding: 16, gap: 16 }}>
      <Text style={{ fontSize: 22, fontWeight: '700', color: '#0F172A', paddingTop: 12 }}>Buy Essentials</Text>

      <TextInput
        value={search}
        onChangeText={setSearch}
        placeholder="Search society essentials..."
        style={{ backgroundColor: '#FFFFFF', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#E2E8F0' }}
      />

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {PRODUCT_CATEGORIES.map((cat) => (
          <Pressable
            key={cat}
            onPress={() => setCategory(cat)}
            style={{
              paddingHorizontal: 14,
              paddingVertical: 8,
              borderRadius: 10,
              backgroundColor: category === cat ? '#0F3D2E' : '#FFFFFF',
            }}
          >
            <Text style={{ color: category === cat ? '#FFFFFF' : '#334155', fontWeight: '600' }}>{cat}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {filtered.map((item) => (
        <View key={item.productId} style={{ backgroundColor: '#FFFFFF', borderRadius: 16, padding: 16, gap: 6 }}>
          <Text style={{ fontSize: 16, fontWeight: '700', color: '#0F172A' }}>{item.title}</Text>
          <Text style={{ fontSize: 13, color: '#64748B' }}>{item.category} · {item.unitLabel}</Text>
          <Text style={{ fontSize: 15, fontWeight: '700', color: '#0F3D2E' }}>
            {formatINRFromPaise(item.pricePaise)} (MRP {formatINRFromPaise(item.mrpPaise)})
          </Text>
          <Pressable
            onPress={() => setCart((c) => ({ ...c, [item.productId]: (c[item.productId] || 0) + 1 }))}
            style={{ backgroundColor: '#0F3D2E', borderRadius: 10, paddingVertical: 10, alignItems: 'center', marginTop: 6 }}
          >
            <Text style={{ color: '#FFFFFF', fontWeight: '600' }}>
              Add to Cart ({cart[item.productId] || 0})
            </Text>
          </Pressable>
        </View>
      ))}

      {Object.values(cart).some((q) => q > 0) ? (
        <View style={{ backgroundColor: '#FFFBEB', borderRadius: 16, padding: 16, gap: 10 }}>
          <Text style={{ fontSize: 13, color: '#92400E', fontWeight: '600' }}>
            Payment Integration Pending: Checkout creates a real Firestore order with status payment_integration_pending.
          </Text>
          <Pressable
            onPress={handlePlaceOrder}
            style={{ backgroundColor: '#0F3D2E', borderRadius: 12, paddingVertical: 14, alignItems: 'center' }}
          >
            <Text style={{ color: '#FFFFFF', fontWeight: '700' }}>Confirm Order (Payment Pending)</Text>
          </Pressable>
        </View>
      ) : null}

      {statusMsg ? <Text style={{ color: '#0F3D2E', fontWeight: '600' }}>{statusMsg}</Text> : null}

      <View style={{ gap: 8, paddingBottom: 24 }}>
        <Text style={{ fontSize: 17, fontWeight: '700', color: '#0F172A' }}>Order History ({orders.length})</Text>
        {orders.map((ord) => (
          <View key={ord.orderId} style={{ backgroundColor: '#FFFFFF', borderRadius: 12, padding: 14 }}>
            <Text style={{ fontWeight: '600', color: '#0F172A' }}>
              Order #{ord.orderId.slice(0, 8)} · {formatINRFromPaise(ord.totalAmountPaise)}
            </Text>
            <Text style={{ fontSize: 12, color: '#64748B' }}>
              Status: {ord.orderStatus} · Payment: {ord.paymentStatus}
            </Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}
