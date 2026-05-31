// src/screens/RecordsScreen.tsx
// View attendance records + sync status — Premium Dark UI

import React, { useEffect, useState, useRef } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, RefreshControl, Animated, Easing,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { DatabaseService } from '../services/DatabaseService';
import { SyncService } from '../services/SyncService';
import { UI_COLORS } from '../constants';
import type { AttendanceRecord, SyncStatus } from '../types';

/* ────────── Animated pulsing dot for online status ────────── */
const PulsingDot: React.FC<{ color: string; active: boolean }> = ({ color, active }) => {
  const scale = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (active) {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.parallel([
            Animated.timing(scale, { toValue: 1.6, duration: 800, easing: Easing.out(Easing.ease), useNativeDriver: true }),
            Animated.timing(opacity, { toValue: 0, duration: 800, easing: Easing.out(Easing.ease), useNativeDriver: true }),
          ]),
          Animated.parallel([
            Animated.timing(scale, { toValue: 1, duration: 0, useNativeDriver: true }),
            Animated.timing(opacity, { toValue: 1, duration: 0, useNativeDriver: true }),
          ]),
        ]),
      );
      loop.start();
      return () => loop.stop();
    } else {
      scale.setValue(1);
      opacity.setValue(1);
    }
  }, [active]);

  return (
    <View style={{ width: 20, height: 20, alignItems: 'center', justifyContent: 'center' }}>
      {active && (
        <Animated.View
          style={{
            position: 'absolute',
            width: 10,
            height: 10,
            borderRadius: 5,
            backgroundColor: color,
            transform: [{ scale }],
            opacity,
          }}
        />
      )}
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
    </View>
  );
};

/* ────────── Main Screen ────────── */
export const RecordsScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const nav = useNavigation();
  const onBack = () => nav.goBack();
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({
    pendingCount: 0, isSyncing: false, isOnline: false,
  });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  /* Entrance animation */
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;

  /* Sync button glow */
  const glowAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    loadRecords();
    const unsubscribe = SyncService.subscribe(setSyncStatus);

    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 500, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();

    // Sync button glow loop
    Animated.loop(
      Animated.sequence([
        Animated.timing(glowAnim, { toValue: 1, duration: 1500, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
        Animated.timing(glowAnim, { toValue: 0, duration: 1500, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
      ]),
    ).start();

    return unsubscribe;
  }, []);

  const loadRecords = async () => {
    const data = await DatabaseService.getAttendanceHistory(undefined, 50);
    setRecords(data);
    setLoading(false);
    setRefreshing(false);
  };

  const handleSync = async () => {
    const result = await SyncService.triggerSync();
    if (result.success) await loadRecords();
  };

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleDateString('en-IN') + ' ' + d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  };

  /* ── Computed counts ── */
  const totalCount = records.length;
  const syncedCount = records.filter(r => r.synced).length;
  const pendingCount = totalCount - syncedCount;

  /* ── Confidence badge color helper ── */
  const getConfidenceStyle = (confidence: number) => {
    const pct = confidence * 100;
    if (pct >= 85) return { bg: UI_COLORS.SUCCESS_LIGHT, text: UI_COLORS.SUCCESS };
    if (pct >= 70) return { bg: UI_COLORS.WARNING_LIGHT, text: UI_COLORS.WARNING };
    return { bg: UI_COLORS.ERROR_LIGHT, text: UI_COLORS.ERROR };
  };

  /* Interpolated glow shadow */
  const glowShadowOpacity = glowAnim.interpolate({ inputRange: [0, 1], outputRange: [0.3, 0.8] });
  const glowShadowRadius = glowAnim.interpolate({ inputRange: [0, 1], outputRange: [4, 16] });

  /* ── Render a single record card ── */
  const renderRecord = ({ item, index }: { item: AttendanceRecord; index: number }) => {
    const accentColor = item.synced ? UI_COLORS.SUCCESS : UI_COLORS.WARNING;
    const confStyle = getConfidenceStyle(item.confidence);

    return (
      <Animated.View
        style={[
          styles.recordCard,
          {
            opacity: fadeAnim,
            transform: [{ translateY: slideAnim }],
          },
        ]}
      >
        {/* Left accent border */}
        <View style={[styles.accentBorder, { backgroundColor: accentColor }]} />

        <View style={styles.recordContent}>
          <View style={styles.recordLeft}>
            <Text style={styles.recordName} numberOfLines={1}>{item.userName}</Text>
            <Text style={styles.recordId}>ID: {item.employeeId}</Text>
            <View style={styles.timeRow}>
              <Text style={styles.clockIcon}>🕐</Text>
              <Text style={styles.recordTime}>{formatTime(item.timestamp)}</Text>
            </View>
          </View>

          <View style={styles.recordRight}>
            {/* Sync pill badge */}
            <View style={[styles.syncBadge, item.synced ? styles.syncedBadge : styles.pendingBadge]}>
              <View style={[styles.syncDotInner, { backgroundColor: item.synced ? UI_COLORS.SUCCESS : UI_COLORS.WARNING }]} />
              <Text style={[styles.syncBadgeText, { color: item.synced ? UI_COLORS.SUCCESS : UI_COLORS.WARNING }]}>
                {item.synced ? 'Synced' : 'Pending'}
              </Text>
            </View>

            {/* Confidence badge */}
            <View style={[styles.confidenceBadge, { backgroundColor: confStyle.bg }]}>
              <Text style={[styles.confidenceText, { color: confStyle.text }]}>
                {Math.round(item.confidence * 100)}%
              </Text>
            </View>
          </View>
        </View>
      </Animated.View>
    );
  };

  /* ── Empty state ── */
  const EmptyState = () => (
    <View style={styles.emptyContainer}>
      <View style={styles.emptyIconWrap}>
        <Text style={styles.emptyIcon}>📋</Text>
      </View>
      <Text style={styles.emptyTitle}>No Records Yet</Text>
      <Text style={styles.emptySubtitle}>
        Attendance records will appear here once{'\n'}face recognition check-ins are performed.
      </Text>
    </View>
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* ══════ Header ══════ */}
      <Animated.View style={[styles.header, { opacity: fadeAnim }]}>
        <TouchableOpacity style={styles.backPill} onPress={onBack} activeOpacity={0.7}>
          <Text style={styles.backArrow}>‹</Text>
          <Text style={styles.backLabel}>Back</Text>
        </TouchableOpacity>

        <Text style={styles.title}>Attendance Log</Text>

        <Animated.View
          style={[
            styles.syncBtnGlow,
            { shadowOpacity: glowShadowOpacity, shadowRadius: glowShadowRadius },
          ]}
        >
          <TouchableOpacity
            style={[
              styles.syncBtn,
              (!syncStatus.isOnline || syncStatus.isSyncing) && styles.syncBtnDisabled,
            ]}
            onPress={handleSync}
            disabled={!syncStatus.isOnline || syncStatus.isSyncing}
            activeOpacity={0.75}
          >
            {syncStatus.isSyncing
              ? <ActivityIndicator color="#FFF" size="small" />
              : <Text style={styles.syncBtnText}>↑  Sync</Text>
            }
          </TouchableOpacity>
        </Animated.View>
      </Animated.View>

      {/* ══════ Status Card (glassmorphism) ══════ */}
      <Animated.View
        style={[
          styles.statusCard,
          {
            opacity: fadeAnim,
            backgroundColor: syncStatus.isOnline
              ? 'rgba(0,214,143,0.06)'
              : 'rgba(255,71,87,0.06)',
          },
        ]}
      >
        <PulsingDot color={syncStatus.isOnline ? UI_COLORS.SUCCESS : UI_COLORS.ERROR} active={syncStatus.isOnline} />
        <Text style={styles.statusLabel}>
          {syncStatus.isOnline ? 'Online' : 'Offline'}
        </Text>
        <View style={styles.statusDivider} />
        <Text style={styles.statusDetail}>
          {syncStatus.pendingCount > 0
            ? `${syncStatus.pendingCount} pending sync`
            : 'All records synced'}
        </Text>
      </Animated.View>

      {/* ══════ Summary Row ══════ */}
      <Animated.View style={[styles.summaryRow, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
        {/* Total */}
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{totalCount}</Text>
          <Text style={styles.statLabel}>Total</Text>
        </View>
        {/* Synced */}
        <View style={[styles.statCard, styles.statCardMiddle]}>
          <Text style={[styles.statValue, { color: UI_COLORS.SUCCESS }]}>{syncedCount}</Text>
          <Text style={styles.statLabel}>Synced</Text>
        </View>
        {/* Pending */}
        <View style={styles.statCard}>
          <Text style={[styles.statValue, { color: UI_COLORS.WARNING }]}>{pendingCount}</Text>
          <Text style={styles.statLabel}>Pending</Text>
        </View>
      </Animated.View>

      {/* ══════ Records List ══════ */}
      {loading ? (
        <View style={styles.loaderWrap}>
          <ActivityIndicator color={UI_COLORS.ACCENT} size="large" />
          <Text style={styles.loaderText}>Loading records…</Text>
        </View>
      ) : (
        <FlatList
          data={records}
          keyExtractor={item => item.id}
          renderItem={renderRecord}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); loadRecords(); }}
              tintColor={UI_COLORS.ACCENT}
              colors={[UI_COLORS.ACCENT]}
              progressBackgroundColor={UI_COLORS.SURFACE}
            />
          }
          ListEmptyComponent={<EmptyState />}
        />
      )}
    </View>
  );
};

/* ═══════════════════════════════════════════════════════════════════════════════
   Styles
   ═══════════════════════════════════════════════════════════════════════════════ */
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: UI_COLORS.BACKGROUND,
  },

  /* ── Header ── */
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  backPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: UI_COLORS.SURFACE_ELEVATED,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: UI_COLORS.BORDER,
  },
  backArrow: {
    color: UI_COLORS.ACCENT,
    fontSize: 20,
    fontWeight: '700',
    marginRight: 4,
    marginTop: -1,
  },
  backLabel: {
    color: UI_COLORS.TEXT_PRIMARY,
    fontSize: 13,
    fontWeight: '600',
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    color: UI_COLORS.TEXT_PRIMARY,
    letterSpacing: 0.3,
  },
  syncBtnGlow: {
    borderRadius: 22,
    shadowColor: UI_COLORS.ACCENT,
    shadowOffset: { width: 0, height: 0 },
    elevation: 8,
  },
  syncBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: UI_COLORS.ACCENT,
    paddingHorizontal: 18,
    paddingVertical: 9,
    borderRadius: 22,
  },
  syncBtnDisabled: {
    backgroundColor: UI_COLORS.SURFACE_ELEVATED,
  },
  syncBtnText: {
    color: '#FFF',
    fontWeight: '700',
    fontSize: 13,
    letterSpacing: 0.4,
  },

  /* ── Status Card ── */
  statusCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 18,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: UI_COLORS.BORDER,
  },
  statusLabel: {
    color: UI_COLORS.TEXT_PRIMARY,
    fontSize: 13,
    fontWeight: '700',
    marginLeft: 6,
  },
  statusDivider: {
    width: 1,
    height: 16,
    backgroundColor: UI_COLORS.BORDER,
    marginHorizontal: 12,
  },
  statusDetail: {
    color: UI_COLORS.TEXT_SECONDARY,
    fontSize: 12,
    fontWeight: '500',
  },

  /* ── Summary Row ── */
  summaryRow: {
    flexDirection: 'row',
    marginHorizontal: 18,
    marginTop: 12,
    marginBottom: 4,
    gap: 10,
  },
  statCard: {
    flex: 1,
    backgroundColor: UI_COLORS.SURFACE,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: UI_COLORS.BORDER,
  },
  statCardMiddle: {
    borderColor: 'rgba(0,214,143,0.15)',
  },
  statValue: {
    color: UI_COLORS.TEXT_PRIMARY,
    fontSize: 22,
    fontWeight: '800',
  },
  statLabel: {
    color: UI_COLORS.TEXT_SECONDARY,
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },

  /* ── List ── */
  listContent: {
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 30,
  },

  /* ── Record Card ── */
  recordCard: {
    backgroundColor: UI_COLORS.SURFACE,
    borderRadius: 14,
    marginBottom: 10,
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: UI_COLORS.BORDER,
    overflow: 'hidden',
  },
  accentBorder: {
    width: 4,
    borderTopLeftRadius: 14,
    borderBottomLeftRadius: 14,
  },
  recordContent: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 14,
    paddingLeft: 12,
  },
  recordLeft: {
    flex: 1,
    justifyContent: 'center',
  },
  recordName: {
    color: UI_COLORS.TEXT_PRIMARY,
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  recordId: {
    color: UI_COLORS.TEXT_SECONDARY,
    fontSize: 11,
    fontWeight: '500',
    marginTop: 3,
    letterSpacing: 0.3,
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 5,
  },
  clockIcon: {
    fontSize: 10,
    marginRight: 4,
  },
  recordTime: {
    color: UI_COLORS.TEXT_TERTIARY,
    fontSize: 11,
    fontWeight: '500',
  },
  recordRight: {
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 8,
  },

  /* Sync pill badge */
  syncBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  syncedBadge: {
    backgroundColor: UI_COLORS.SUCCESS_LIGHT,
  },
  pendingBadge: {
    backgroundColor: UI_COLORS.WARNING_LIGHT,
  },
  syncDotInner: {
    width: 5,
    height: 5,
    borderRadius: 3,
    marginRight: 5,
  },
  syncBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.3,
  },

  /* Confidence badge */
  confidenceBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  confidenceText: {
    fontSize: 12,
    fontWeight: '800',
  },

  /* ── Empty state ── */
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
    paddingHorizontal: 40,
  },
  emptyIconWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: UI_COLORS.SURFACE_ELEVATED,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
    borderWidth: 1,
    borderColor: UI_COLORS.BORDER,
  },
  emptyIcon: {
    fontSize: 34,
  },
  emptyTitle: {
    color: UI_COLORS.TEXT_PRIMARY,
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 8,
  },
  emptySubtitle: {
    color: UI_COLORS.TEXT_SECONDARY,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 20,
  },

  /* ── Loader ── */
  loaderWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loaderText: {
    color: UI_COLORS.TEXT_SECONDARY,
    fontSize: 13,
    marginTop: 12,
  },
});
