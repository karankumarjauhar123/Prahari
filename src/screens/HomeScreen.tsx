// src/screens/HomeScreen.tsx
// Main dashboard — entry point of app

import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  Dimensions, Animated, Easing,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { DatabaseService } from '../services/DatabaseService';
import { SyncService } from '../services/SyncService';
import { UI_COLORS } from '../constants';
import { BenchmarkOverlay } from '../components/BenchmarkOverlay';
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
  const [benchmarkVisible, setBenchmarkVisible] = useState(false);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;

  // Staggered card animations
  const cardAnims = useRef(
    [0, 1, 2, 3].map(() => ({
      opacity: new Animated.Value(0),
      translateY: new Animated.Value(40),
    })),
  ).current;

  // Shimmer animation for stat cards
  const shimmerAnim = useRef(new Animated.Value(0)).current;

  // Header accent pulse
  const accentPulse = useRef(new Animated.Value(0.6)).current;

  // Floating button scale
  const fabScale = useRef(new Animated.Value(1)).current;

  useFocusEffect(useCallback(() => {
    loadStats();
  }, []));

  useEffect(() => {
    const unsub = SyncService.subscribe(setSyncStatus);

    // Main entrance animation
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
      Animated.spring(slideAnim, { toValue: 0, tension: 60, friction: 10, useNativeDriver: true }),
    ]).start(() => {
      // Stagger menu cards after main entrance
      const staggeredAnims = cardAnims.map((anim, i) =>
        Animated.parallel([
          Animated.timing(anim.opacity, {
            toValue: 1,
            duration: 400,
            delay: i * 100,
            useNativeDriver: true,
            easing: Easing.out(Easing.cubic),
          }),
          Animated.timing(anim.translateY, {
            toValue: 0,
            duration: 450,
            delay: i * 100,
            useNativeDriver: true,
            easing: Easing.out(Easing.back(1.2)),
          }),
        ]),
      );
      Animated.stagger(80, staggeredAnims).start();
    });

    // Continuous shimmer loop
    Animated.loop(
      Animated.sequence([
        Animated.timing(shimmerAnim, {
          toValue: 1,
          duration: 2200,
          useNativeDriver: true,
          easing: Easing.inOut(Easing.ease),
        }),
        Animated.timing(shimmerAnim, {
          toValue: 0,
          duration: 2200,
          useNativeDriver: true,
          easing: Easing.inOut(Easing.ease),
        }),
      ]),
    ).start();

    // Header accent pulse
    Animated.loop(
      Animated.sequence([
        Animated.timing(accentPulse, {
          toValue: 1,
          duration: 1800,
          useNativeDriver: true,
          easing: Easing.inOut(Easing.ease),
        }),
        Animated.timing(accentPulse, {
          toValue: 0.6,
          duration: 1800,
          useNativeDriver: true,
          easing: Easing.inOut(Easing.ease),
        }),
      ]),
    ).start();

    return unsub;
  }, []);

  const loadStats = async () => {
    const s = await DatabaseService.getStats();
    setStats(s);
  };

  const onFabPressIn = () => {
    Animated.spring(fabScale, { toValue: 0.88, friction: 5, tension: 200, useNativeDriver: true }).start();
  };

  const onFabPressOut = () => {
    Animated.spring(fabScale, { toValue: 1, friction: 4, tension: 180, useNativeDriver: true }).start();
  };

  const menuItems = [
    {
      icon: '🔍',
      title: 'Authenticate',
      subtitle: 'Verify field personnel identity',
      color: UI_COLORS.ACCENT,
      glowColor: UI_COLORS.GLOW_ACCENT,
      route: 'Auth' as const,
    },
    {
      icon: '➕',
      title: 'Enroll User',
      subtitle: 'Register new personnel face',
      color: UI_COLORS.CYAN,
      glowColor: 'rgba(79,195,247,0.08)',
      route: 'Enroll' as const,
    },
    {
      icon: '📋',
      title: 'Attendance Log',
      subtitle: 'View & sync records',
      color: UI_COLORS.SUCCESS,
      glowColor: UI_COLORS.GLOW_SUCCESS,
      route: 'Records' as const,
    },
    {
      icon: '⚙️',
      title: 'Settings',
      subtitle: 'Configure thresholds & sync',
      color: UI_COLORS.PURPLE,
      glowColor: 'rgba(179,136,255,0.08)',
      route: 'Settings' as const,
    },
  ];

  // Shimmer interpolation for stat cards
  const shimmerOpacity = shimmerAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.03, 0.12],
  });

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <Animated.View
        style={[styles.header, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}
      >
        <View style={styles.headerLeft}>
          <View style={styles.titleRow}>
            <Animated.View style={[styles.accentBarLeft, { opacity: accentPulse }]} />
            <Text style={styles.shieldIcon}>🛡️</Text>
            <Text style={styles.appName}>PRAHARI</Text>
            <Animated.View style={[styles.accentBarRight, { opacity: accentPulse }]} />
          </View>
          <Text style={styles.tagline}>Offline Face Authentication</Text>
        </View>
        <View style={[styles.onlinePill, {
          backgroundColor: syncStatus.isOnline
            ? 'rgba(0,214,143,0.12)' : 'rgba(255,71,87,0.10)',
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
        <StatCard
          label="Enrolled"
          value={stats.totalEmbeddings}
          icon="👤"
          glowColor={UI_COLORS.GLOW_ACCENT}
          shimmerOpacity={shimmerOpacity}
        />
        <StatCard
          label="Total Logs"
          value={stats.totalRecords}
          icon="📊"
          glowColor={UI_COLORS.GLOW_SUCCESS}
          shimmerOpacity={shimmerOpacity}
        />
        <StatCard
          label="Unsynced"
          value={stats.unsyncedCount}
          icon="⏳"
          highlight={stats.unsyncedCount > 0}
          glowColor="rgba(255,179,71,0.08)"
          shimmerOpacity={shimmerOpacity}
        />
      </Animated.View>

      {/* Sync banner */}
      {!syncStatus.isOnline && stats.unsyncedCount > 0 && (
        <View style={styles.syncBanner}>
          <View style={styles.syncBannerIconWrap}>
            <Text style={styles.syncBannerIcon}>📡</Text>
          </View>
          <View style={styles.syncBannerContent}>
            <Text style={styles.syncBannerTitle}>Sync Pending</Text>
            <Text style={styles.syncBannerText}>
              {stats.unsyncedCount} record{stats.unsyncedCount > 1 ? 's' : ''} queued — will sync when online
            </Text>
          </View>
        </View>
      )}

      {/* Menu Grid */}
      <View style={styles.grid}>
        {menuItems.map((item, i) => (
          <Animated.View
            key={item.route}
            style={{
              opacity: cardAnims[i].opacity,
              transform: [{ translateY: cardAnims[i].translateY }],
            }}
          >
            <TouchableOpacity
              style={[styles.card, {
                borderColor: item.color + '25',
                shadowColor: item.color,
              }]}
              onPress={() => nav.navigate(item.route)}
              activeOpacity={0.7}
            >
              {/* Subtle gradient-like accent overlay */}
              <View style={[styles.cardGradientOverlay, { backgroundColor: item.color + '08' }]} />
              <View style={[styles.cardGlowTop, { backgroundColor: item.color + '06' }]} />

              <View style={[styles.cardIcon, { backgroundColor: item.color + '22' }]}>
                <Text style={styles.cardIconText}>{item.icon}</Text>
              </View>
              <Text style={styles.cardTitle}>{item.title}</Text>
              <Text style={styles.cardSubtitle}>{item.subtitle}</Text>
              <View style={[styles.cardArrow, { backgroundColor: item.color }]}>
                <View style={[styles.cardArrowGlow, { backgroundColor: item.color }]} />
                <Text style={styles.cardArrowText}>→</Text>
              </View>
            </TouchableOpacity>
          </Animated.View>
        ))}
      </View>

      {/* Footer */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
        <View style={styles.footerLine} />
        <Text style={styles.footerText}>
          All data encrypted • Models: ~8.5 MB • No internet required
        </Text>
        <Text style={styles.footerVersion}>PRAHARI v1.0.0</Text>
      </View>

      {/* Floating Benchmark Button */}
      <Animated.View style={[styles.fabContainer, {
        bottom: insets.bottom + 24,
        transform: [{ scale: fabScale }],
      }]}>
        <TouchableOpacity
          style={styles.fab}
          onPressIn={onFabPressIn}
          onPressOut={onFabPressOut}
          onPress={() => setBenchmarkVisible(true)}
          activeOpacity={0.85}
        >
          <Text style={styles.fabText}>⚡</Text>
        </TouchableOpacity>
      </Animated.View>

      {/* Benchmark Overlay Modal */}
      <BenchmarkOverlay
        visible={benchmarkVisible}
        onClose={() => setBenchmarkVisible(false)}
      />
    </View>
  );
};

/* ── Stat Card Component ──────────────────────────────────────── */

const StatCard: React.FC<{
  label: string;
  value: number;
  icon: string;
  highlight?: boolean;
  glowColor: string;
  shimmerOpacity: Animated.AnimatedInterpolation<number>;
}> = ({ label, value, icon, highlight, glowColor, shimmerOpacity }) => (
  <View style={[
    statStyles.card,
    highlight && statStyles.cardHighlight,
    { shadowColor: highlight ? UI_COLORS.WARNING : glowColor === UI_COLORS.GLOW_ACCENT ? UI_COLORS.ACCENT : UI_COLORS.SUCCESS },
  ]}>
    {/* Animated shimmer overlay */}
    <Animated.View
      style={[
        statStyles.shimmerOverlay,
        {
          backgroundColor: highlight ? UI_COLORS.WARNING : UI_COLORS.ACCENT,
          opacity: shimmerOpacity,
        },
      ]}
    />
    <View style={[statStyles.glowDot, { backgroundColor: glowColor }]} />
    <Text style={statStyles.icon}>{icon}</Text>
    <Text style={[statStyles.value, highlight && statStyles.valueHighlight]}>
      {value}
    </Text>
    <Text style={statStyles.label}>{label}</Text>
  </View>
);

/* ── Styles ───────────────────────────────────────────────────── */

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: UI_COLORS.BACKGROUND,
  },

  /* Header */
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 20,
  },
  headerLeft: {
    flex: 1,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  shieldIcon: {
    fontSize: 22,
    marginRight: 4,
  },
  appName: {
    fontSize: 30,
    fontWeight: '900',
    color: UI_COLORS.TEXT_PRIMARY,
    letterSpacing: 7,
  },
  accentBarLeft: {
    width: 3,
    height: 22,
    borderRadius: 2,
    backgroundColor: UI_COLORS.ACCENT,
    marginRight: 4,
  },
  accentBarRight: {
    width: 3,
    height: 22,
    borderRadius: 2,
    backgroundColor: UI_COLORS.ACCENT,
    marginLeft: 4,
  },
  tagline: {
    fontSize: 11,
    color: UI_COLORS.TEXT_SECONDARY,
    marginTop: 4,
    letterSpacing: 1.5,
    marginLeft: 38, // align under the title text (after shield + bars)
  },
  onlinePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  onlineDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  onlineText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.2,
  },

  /* Stats Row */
  statsRow: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 24,
    marginBottom: 14,
  },

  /* Sync Banner */
  syncBanner: {
    marginHorizontal: 24,
    marginBottom: 14,
    backgroundColor: UI_COLORS.WARNING_LIGHT,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,179,71,0.25)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  syncBannerIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: 'rgba(255,179,71,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  syncBannerIcon: {
    fontSize: 18,
  },
  syncBannerContent: {
    flex: 1,
  },
  syncBannerTitle: {
    color: UI_COLORS.WARNING,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  syncBannerText: {
    color: 'rgba(255,179,71,0.85)',
    fontSize: 11,
    fontWeight: '500',
    lineHeight: 16,
  },

  /* Menu Grid */
  grid: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 14,
    paddingHorizontal: 24,
    alignContent: 'flex-start',
  },
  card: {
    width: (W - 62) / 2,
    backgroundColor: UI_COLORS.SURFACE,
    borderRadius: 22,
    padding: 18,
    borderWidth: 1,
    gap: 6,
    overflow: 'hidden',
    // Shadow / elevation for glow
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 6,
  },
  cardGradientOverlay: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 22,
  },
  cardGlowTop: {
    position: 'absolute',
    top: -20,
    left: -20,
    width: 100,
    height: 100,
    borderRadius: 50,
    opacity: 0.5,
  },
  cardIcon: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  cardIconText: {
    fontSize: 24,
  },
  cardTitle: {
    color: UI_COLORS.TEXT_PRIMARY,
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  cardSubtitle: {
    color: UI_COLORS.TEXT_SECONDARY,
    fontSize: 11,
    lineHeight: 16,
    letterSpacing: 0.2,
  },
  cardArrow: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-end',
    marginTop: 6,
    overflow: 'hidden',
    // Arrow glow
    shadowColor: '#FFF',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  cardArrowGlow: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 10,
    opacity: 0.15,
  },
  cardArrowText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '800',
  },

  /* Footer */
  footer: {
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 10,
  },
  footerLine: {
    width: 40,
    height: 2,
    borderRadius: 1,
    backgroundColor: UI_COLORS.BORDER,
    marginBottom: 10,
  },
  footerText: {
    color: UI_COLORS.TEXT_TERTIARY,
    fontSize: 10,
    textAlign: 'center',
    letterSpacing: 0.4,
    lineHeight: 16,
  },
  footerVersion: {
    color: UI_COLORS.ACCENT,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.5,
    marginTop: 4,
    opacity: 0.5,
  },

  /* Floating Action Button */
  fabContainer: {
    position: 'absolute',
    right: 22,
  },
  fab: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: UI_COLORS.SURFACE_ELEVATED,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: UI_COLORS.BORDER_ACCENT,
    // Glow
    shadowColor: UI_COLORS.ACCENT,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 8,
  },
  fabText: {
    fontSize: 22,
  },
});

/* ── Stat Card Styles ─────────────────────────────────────────── */

const statStyles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: UI_COLORS.SURFACE,
    borderRadius: 16,
    padding: 14,
    alignItems: 'center',
    gap: 3,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
    overflow: 'hidden',
    // Glow shadow
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 4,
  },
  cardHighlight: {
    borderColor: 'rgba(255,179,71,0.3)',
    backgroundColor: 'rgba(255,179,71,0.06)',
  },
  shimmerOverlay: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 16,
  },
  glowDot: {
    position: 'absolute',
    top: -8,
    right: -8,
    width: 30,
    height: 30,
    borderRadius: 15,
    opacity: 0.7,
  },
  icon: {
    fontSize: 20,
    marginBottom: 2,
  },
  value: {
    fontSize: 28,
    fontWeight: '900',
    color: UI_COLORS.TEXT_PRIMARY,
    letterSpacing: 0.5,
  },
  valueHighlight: {
    color: UI_COLORS.WARNING,
  },
  label: {
    fontSize: 10,
    color: UI_COLORS.TEXT_SECONDARY,
    letterSpacing: 0.8,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
});
