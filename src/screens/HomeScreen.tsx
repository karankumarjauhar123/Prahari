// src/screens/HomeScreen.tsx
// Main dashboard — entry point of app

import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  Dimensions, Animated,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { DatabaseService } from '../services/DatabaseService';
import { SyncService } from '../services/SyncService';
import { UI_COLORS } from '../constants';
import type { SyncStatus } from '../types';
import type { RootStackParamList } from '../../App';

const { width: W } = Dimensions.get('window');
type Nav = NativeStackNavigationProp<RootStackParamList>;

interface Stats {
  totalEmbeddings: number;
  totalRecords: number;
  unsyncedCount: number;
}

export const HomeScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const nav = useNavigation<Nav>();
  const [stats, setStats] = useState<Stats>({ totalEmbeddings: 0, totalRecords: 0, unsyncedCount: 0 });
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({ pendingCount: 0, isSyncing: false, isOnline: false });
  const fadeAnim = React.useRef(new Animated.Value(0)).current;
  const slideAnim = React.useRef(new Animated.Value(30)).current;

  useFocusEffect(useCallback(() => {
    loadStats();
  }, []));

  useEffect(() => {
    const unsub = SyncService.subscribe(setSyncStatus);
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
      Animated.spring(slideAnim, { toValue: 0, tension: 60, friction: 10, useNativeDriver: true }),
    ]).start();
    return unsub;
  }, []);

  const loadStats = async () => {
    const s = await DatabaseService.getStats();
    setStats(s);
  };

  const menuItems = [
    {
      icon: '🔍',
      title: 'Authenticate',
      subtitle: 'Verify field personnel identity',
      color: UI_COLORS.ACCENT,
      route: 'Auth' as const,
    },
    {
      icon: '➕',
      title: 'Enroll User',
      subtitle: 'Register new personnel face',
      color: '#4FC3F7',
      route: 'Enroll' as const,
    },
    {
      icon: '📋',
      title: 'Attendance Log',
      subtitle: 'View & sync records',
      color: UI_COLORS.SUCCESS,
      route: 'Records' as const,
    },
    {
      icon: '⚙️',
      title: 'Settings',
      subtitle: 'Configure thresholds & sync',
      color: '#CE93D8',
      route: 'Settings' as const,
    },
  ];

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <Animated.View
        style={[styles.header, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}
      >
        <View>
          <Text style={styles.appName}>PRAHARI</Text>
          <Text style={styles.tagline}>Offline Face Authentication</Text>
        </View>
        <View style={[styles.onlinePill, {
          backgroundColor: syncStatus.isOnline
            ? 'rgba(0,200,151,0.15)' : 'rgba(255,71,87,0.12)',
          borderColor: syncStatus.isOnline ? UI_COLORS.SUCCESS : UI_COLORS.ERROR,
        }]}>
          <View style={[styles.onlineDot, {
            backgroundColor: syncStatus.isOnline ? UI_COLORS.SUCCESS : UI_COLORS.ERROR,
          }]} />
          <Text style={[styles.onlineText, {
            color: syncStatus.isOnline ? UI_COLORS.SUCCESS : UI_COLORS.ERROR,
          }]}>
            {syncStatus.isOnline ? 'ONLINE' : 'OFFLINE'}
          </Text>
        </View>
      </Animated.View>

      {/* Stats Row */}
      <Animated.View style={[styles.statsRow, { opacity: fadeAnim }]}>
        <StatCard label="Enrolled" value={stats.totalEmbeddings} icon="👤" />
        <StatCard label="Total Logs" value={stats.totalRecords} icon="📊" />
        <StatCard
          label="Unsynced"
          value={stats.unsyncedCount}
          icon="⏳"
          highlight={stats.unsyncedCount > 0}
        />
      </Animated.View>

      {/* Sync banner */}
      {!syncStatus.isOnline && stats.unsyncedCount > 0 && (
        <View style={styles.syncBanner}>
          <Text style={styles.syncBannerText}>
            📡 {stats.unsyncedCount} record{stats.unsyncedCount > 1 ? 's' : ''} queued — will sync when online
          </Text>
        </View>
      )}

      {/* Menu Grid */}
      <Animated.View style={[styles.grid, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
        {menuItems.map((item, i) => (
          <TouchableOpacity
            key={item.route}
            style={[styles.card, { borderColor: item.color + '30' }]}
            onPress={() => nav.navigate(item.route)}
            activeOpacity={0.75}
          >
            <View style={[styles.cardIcon, { backgroundColor: item.color + '18' }]}>
              <Text style={styles.cardIconText}>{item.icon}</Text>
            </View>
            <Text style={styles.cardTitle}>{item.title}</Text>
            <Text style={styles.cardSubtitle}>{item.subtitle}</Text>
            <View style={[styles.cardArrow, { backgroundColor: item.color }]}>
              <Text style={styles.cardArrowText}>→</Text>
            </View>
          </TouchableOpacity>
        ))}
      </Animated.View>

      {/* Footer */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
        <Text style={styles.footerText}>
          All data encrypted • Models: ~8.5 MB • No internet required
        </Text>
      </View>
    </View>
  );
};

const StatCard: React.FC<{
  label: string; value: number; icon: string; highlight?: boolean;
}> = ({ label, value, icon, highlight }) => (
  <View style={[statStyles.card, highlight && statStyles.cardHighlight]}>
    <Text style={statStyles.icon}>{icon}</Text>
    <Text style={[statStyles.value, highlight && statStyles.valueHighlight]}>
      {value}
    </Text>
    <Text style={statStyles.label}>{label}</Text>
  </View>
);

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: UI_COLORS.BACKGROUND },
  header: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24, paddingVertical: 20,
  },
  appName: {
    fontSize: 28, fontWeight: '900', color: '#FFFFFF', letterSpacing: 6,
  },
  tagline: { fontSize: 11, color: UI_COLORS.TEXT_SECONDARY, marginTop: 2, letterSpacing: 1 },
  onlinePill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderRadius: 20, borderWidth: 1,
    paddingHorizontal: 12, paddingVertical: 6,
  },
  onlineDot: { width: 7, height: 7, borderRadius: 4 },
  onlineText: { fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  statsRow: {
    flexDirection: 'row', gap: 10,
    paddingHorizontal: 24, marginBottom: 12,
  },
  syncBanner: {
    marginHorizontal: 24, marginBottom: 12,
    backgroundColor: 'rgba(255,179,71,0.12)',
    borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10,
    borderWidth: 1, borderColor: 'rgba(255,179,71,0.3)',
  },
  syncBannerText: { color: UI_COLORS.WARNING, fontSize: 12, fontWeight: '600' },
  grid: {
    flex: 1, flexDirection: 'row', flexWrap: 'wrap',
    gap: 14, paddingHorizontal: 24,
  },
  card: {
    width: (W - 62) / 2,
    backgroundColor: UI_COLORS.SURFACE,
    borderRadius: 20, padding: 18,
    borderWidth: 1, gap: 6,
  },
  cardIcon: {
    width: 44, height: 44, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 4,
  },
  cardIconText: { fontSize: 22 },
  cardTitle: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  cardSubtitle: { color: UI_COLORS.TEXT_SECONDARY, fontSize: 11, lineHeight: 16 },
  cardArrow: {
    width: 28, height: 28, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center',
    alignSelf: 'flex-end', marginTop: 4,
  },
  cardArrowText: { color: '#FFF', fontSize: 14, fontWeight: '700' },
  footer: {
    alignItems: 'center', paddingHorizontal: 24, paddingTop: 8,
  },
  footerText: { color: 'rgba(255,255,255,0.2)', fontSize: 10, textAlign: 'center', letterSpacing: 0.3 },
});

const statStyles = StyleSheet.create({
  card: {
    flex: 1, backgroundColor: UI_COLORS.SURFACE,
    borderRadius: 14, padding: 12, alignItems: 'center', gap: 2,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)',
  },
  cardHighlight: { borderColor: 'rgba(255,179,71,0.3)', backgroundColor: 'rgba(255,179,71,0.07)' },
  icon: { fontSize: 18 },
  value: { fontSize: 22, fontWeight: '800', color: '#FFFFFF' },
  valueHighlight: { color: UI_COLORS.WARNING },
  label: { fontSize: 10, color: UI_COLORS.TEXT_SECONDARY, letterSpacing: 0.5 },
});
