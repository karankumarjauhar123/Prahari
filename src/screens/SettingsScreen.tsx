// src/screens/SettingsScreen.tsx

import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView,
  TouchableOpacity, Switch, Alert, ActivityIndicator,
  Animated, Easing,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DatabaseService } from '../services/DatabaseService';
import { SyncService } from '../services/SyncService';
import { FaceEngine } from '../services/FaceEngine';
import { UI_COLORS } from '../constants';
import { BenchmarkOverlay } from '../components/BenchmarkOverlay';

interface AppSettings {
  recognitionThreshold: number;
  livenessStrict: boolean;
  autoPurgeAfterSync: boolean;
  challengeCount: number;
  requirePassiveLiveness: boolean;
}

const DEFAULT_SETTINGS: AppSettings = {
  recognitionThreshold: 0.72,
  livenessStrict: true,
  autoPurgeAfterSync: true,
  challengeCount: 2,
  requirePassiveLiveness: true,
};

const SETTINGS_KEY = '@prahari_settings';

export const SettingsScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const nav = useNavigation();
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isPurging, setIsPurging] = useState(false);
  const [dbStats, setDbStats] = useState({ totalEmbeddings: 0, totalRecords: 0, unsyncedCount: 0 });
  const [showBenchmark, setShowBenchmark] = useState(false);

  // ─── Animations ──────────────────────────────────────────
  const headerOpacity = useRef(new Animated.Value(0)).current;
  const headerSlide = useRef(new Animated.Value(-20)).current;
  const vaultGlow = useRef(new Animated.Value(0)).current;
  const sectionAnims = useRef([0, 1, 2, 3, 4, 5, 6].map(() => new Animated.Value(0))).current;
  const sectionSlides = useRef([0, 1, 2, 3, 4, 5, 6].map(() => new Animated.Value(30))).current;
  const benchmarkPulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    loadSettings();
    loadStats();

    // Header entrance
    Animated.parallel([
      Animated.timing(headerOpacity, { toValue: 1, duration: 500, useNativeDriver: true }),
      Animated.timing(headerSlide, { toValue: 0, duration: 500, easing: Easing.out(Easing.back(1.5)), useNativeDriver: true }),
    ]).start();

    // Staggered section entrances
    const sectionAnimations = sectionAnims.map((anim, i) =>
      Animated.parallel([
        Animated.timing(anim, { toValue: 1, duration: 450, delay: 150 + i * 80, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(sectionSlides[i], { toValue: 0, duration: 450, delay: 150 + i * 80, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      ])
    );
    Animated.stagger(0, sectionAnimations).start();

    // Vault glow loop
    Animated.loop(
      Animated.sequence([
        Animated.timing(vaultGlow, { toValue: 1, duration: 2000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(vaultGlow, { toValue: 0, duration: 2000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])
    ).start();

    // Benchmark button pulse
    Animated.loop(
      Animated.sequence([
        Animated.timing(benchmarkPulse, { toValue: 1.03, duration: 1200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(benchmarkPulse, { toValue: 1, duration: 1200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])
    ).start();
  }, []);

  const loadSettings = async () => {
    try {
      const raw = await AsyncStorage.getItem(SETTINGS_KEY);
      if (raw) setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(raw) });
    } catch (_) {}
  };

  const saveSettings = async (updated: AppSettings) => {
    setSettings(updated);
    await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(updated));
  };

  const loadStats = async () => {
    const s = await DatabaseService.getStats();
    setDbStats(s);
  };

  const handleManualSync = async () => {
    setIsSyncing(true);
    const result = await SyncService.triggerSync();
    setIsSyncing(false);
    await loadStats();
    Alert.alert(result.success ? '✅ Sync Complete' : '❌ Sync Failed', result.message);
  };

  const handlePurge = () => {
    Alert.alert(
      'Purge Synced Records',
      `This will permanently delete ${dbStats.totalRecords - dbStats.unsyncedCount} synced records from this device. Cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Purge', style: 'destructive',
          onPress: async () => {
            setIsPurging(true);
            await DatabaseService.purgeSyncedRecords();
            await loadStats();
            setIsPurging(false);
            Alert.alert('✅ Done', 'Synced records purged from device');
          },
        },
      ]
    );
  };

  const handleDeleteAllEnrollments = () => {
    Alert.alert(
      '⚠️ Delete All Enrollments',
      `This will remove all ${dbStats.totalEmbeddings} enrolled faces. They cannot be recovered.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete All', style: 'destructive',
          onPress: async () => {
            const embeddings = await DatabaseService.getAllEmbeddings();
            for (const e of embeddings) await DatabaseService.deleteEmbedding(e.userId);
            FaceEngine.loadEmbeddings([]);
            await loadStats();
            Alert.alert('Done', 'All enrollments deleted');
          },
        },
      ]
    );
  };

  // ─── Helper Components ───────────────────────────────────

  const StatRow = ({ icon, label, value, valueColor }: { icon: string; label: string; value: string | number; valueColor?: string }) => (
    <View style={styles.statRow}>
      <View style={styles.statRowLeft}>
        <Text style={styles.statIcon}>{icon}</Text>
        <Text style={styles.rowLabel}>{label}</Text>
      </View>
      <View style={styles.statValueContainer}>
        <Text style={[styles.statValue, valueColor ? { color: valueColor } : undefined]}>{value}</Text>
      </View>
    </View>
  );

  const Row = ({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) => (
    <View style={styles.row}>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowLabel}>{label}</Text>
        {description ? <Text style={styles.rowDescription}>{description}</Text> : null}
      </View>
      {children}
    </View>
  );

  const Section = ({ title, children, index, danger }: { title: string; children: React.ReactNode; index: number; danger?: boolean }) => (
    <Animated.View style={[
      styles.section,
      { opacity: sectionAnims[index] || 1, transform: [{ translateY: sectionSlides[index] || 0 }] },
    ]}>
      <View style={styles.sectionHeader}>
        <View style={[styles.sectionDot, danger && { backgroundColor: UI_COLORS.ERROR }]} />
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>
      <View style={[styles.sectionCard, danger && styles.dangerCard]}>{children}</View>
    </Animated.View>
  );

  const ThresholdButton = ({ value, current, onPress, isChallenge }: { value: number; current: number; onPress: () => void; isChallenge?: boolean }) => {
    const isActive = current === value;
    const displayLabel = isChallenge ? `${value}` : `${(value * 100).toFixed(0)}%`;
    return (
      <TouchableOpacity
        style={[styles.threshBtn, isActive && styles.threshBtnActive]}
        onPress={onPress}
        activeOpacity={0.7}
      >
        {isActive && <View style={styles.threshBtnGlow} />}
        <Text style={[styles.threshBtnText, isActive && styles.threshBtnTextActive]}>
          {displayLabel}
        </Text>
      </TouchableOpacity>
    );
  };

  // Threshold gauge
  const thresholdValues = [0.65, 0.70, 0.72, 0.78, 0.85];
  const currentThreshIdx = thresholdValues.indexOf(settings.recognitionThreshold);
  const gaugePercent = currentThreshIdx >= 0 ? ((currentThreshIdx) / (thresholdValues.length - 1)) * 100 : 50;

  const ActionCard = ({ icon, label, sublabel, color, onPress, loading, disabled }: {
    icon: string; label: string; sublabel?: string; color: string;
    onPress: () => void; loading?: boolean; disabled?: boolean;
  }) => (
    <TouchableOpacity
      style={[styles.actionCard, { borderColor: color + '40' }]}
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.7}
    >
      <View style={[styles.actionCardIconBg, { backgroundColor: color + '18' }]}>
        {loading
          ? <ActivityIndicator color={color} size="small" />
          : <Text style={styles.actionCardIcon}>{icon}</Text>
        }
      </View>
      <View style={styles.actionCardTextWrap}>
        <Text style={[styles.actionCardLabel, { color }]}>{label}</Text>
        {sublabel ? <Text style={styles.actionCardSublabel}>{sublabel}</Text> : null}
      </View>
      <Text style={[styles.actionCardChevron, { color: color + '80' }]}>›</Text>
    </TouchableOpacity>
  );

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 40 }]}
      showsVerticalScrollIndicator={false}
    >
      {/* ─── Header ─── */}
      <Animated.View style={[styles.header, { opacity: headerOpacity, transform: [{ translateY: headerSlide }] }]}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => nav.goBack()}
          activeOpacity={0.7}
        >
          <Text style={styles.backArrow}>←</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Settings</Text>
        <View style={{ width: 44 }} />
      </Animated.View>

      {/* ─── Performance ─── */}
      <Section title="PERFORMANCE" index={0}>
        <Animated.View style={{ transform: [{ scale: benchmarkPulse }] }}>
          <TouchableOpacity
            style={styles.benchmarkBtn}
            onPress={() => setShowBenchmark(true)}
            activeOpacity={0.75}
          >
            <View style={styles.benchmarkBtnGlow} />
            <Text style={styles.benchmarkBtnIcon}>⚡</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.benchmarkBtnTitle}>Run Model Benchmark</Text>
              <Text style={styles.benchmarkBtnSub}>Test inference speed & accuracy</Text>
            </View>
            <Text style={styles.benchmarkChevron}>›</Text>
          </TouchableOpacity>
        </Animated.View>
      </Section>

      {/* ─── Device Vault ─── */}
      <Animated.View style={[
        styles.section,
        { opacity: sectionAnims[1], transform: [{ translateY: sectionSlides[1] }] },
      ]}>
        <View style={styles.sectionHeader}>
          <View style={styles.sectionDot} />
          <Text style={styles.sectionTitle}>DEVICE VAULT</Text>
        </View>
        <Animated.View style={[
          styles.sectionCard,
          { shadowOpacity: vaultGlow.interpolate({ inputRange: [0, 1], outputRange: [0, 0.35] }) },
          { shadowColor: UI_COLORS.ACCENT, shadowRadius: 20, shadowOffset: { width: 0, height: 0 }, elevation: 4 },
        ]}>
          <View style={styles.vaultGlowBorder}>
            <StatRow icon="🔐" label="Enrolled Faces" value={dbStats.totalEmbeddings} />
            <View style={styles.rowDivider} />
            <StatRow icon="📊" label="Total Records" value={dbStats.totalRecords} />
            <View style={styles.rowDivider} />
            <StatRow
              icon="⏳"
              label="Pending Sync"
              value={dbStats.unsyncedCount}
              valueColor={dbStats.unsyncedCount > 0 ? UI_COLORS.WARNING : undefined}
            />
          </View>
        </Animated.View>
      </Animated.View>

      {/* ─── Recognition Accuracy ─── */}
      <Section title="RECOGNITION ACCURACY" index={2}>
        <View style={styles.threshRow}>
          <Text style={styles.rowLabel}>Match Threshold</Text>
          <View style={styles.threshButtons}>
            {thresholdValues.map(v => (
              <ThresholdButton
                key={v} value={v}
                current={settings.recognitionThreshold}
                onPress={() => saveSettings({ ...settings, recognitionThreshold: v })}
              />
            ))}
          </View>
        </View>

        {/* Visual Gauge */}
        <View style={styles.gaugeContainer}>
          <View style={styles.gaugeTrack}>
            <Animated.View style={[styles.gaugeFill, { width: `${gaugePercent}%` as any }]} />
            <View style={[styles.gaugeThumb, { left: `${gaugePercent}%` as any }]} />
          </View>
          <View style={styles.gaugeLabels}>
            <Text style={styles.gaugeLabelText}>Lenient</Text>
            <Text style={[styles.gaugeLabelText, { color: UI_COLORS.ACCENT }]}>
              {(settings.recognitionThreshold * 100).toFixed(0)}%
            </Text>
            <Text style={styles.gaugeLabelText}>Strict</Text>
          </View>
        </View>

        <Text style={styles.threshHint}>
          Higher = stricter match (fewer false accepts). 72% recommended.
        </Text>
      </Section>

      {/* ─── Liveness Detection ─── */}
      <Section title="LIVENESS DETECTION" index={3}>
        <Row label="Strict Mode" description="Requires all challenges to pass with high confidence">
          <Switch
            value={settings.livenessStrict}
            onValueChange={v => saveSettings({ ...settings, livenessStrict: v })}
            trackColor={{ false: 'rgba(255,255,255,0.08)', true: UI_COLORS.SUCCESS }}
            thumbColor={settings.livenessStrict ? '#FFF' : '#AAA'}
          />
        </Row>
        <View style={styles.rowDivider} />
        <Row label="Passive Liveness" description="Anti-spoof check using a neural network model">
          <Switch
            value={settings.requirePassiveLiveness}
            onValueChange={v => saveSettings({ ...settings, requirePassiveLiveness: v })}
            trackColor={{ false: 'rgba(255,255,255,0.08)', true: UI_COLORS.SUCCESS }}
            thumbColor={settings.requirePassiveLiveness ? '#FFF' : '#AAA'}
          />
        </Row>
        <View style={styles.rowDivider} />
        <Row label="Challenges per Auth" description="Number of active liveness challenges required">
          <View style={styles.threshButtons}>
            {[1, 2, 3].map(v => (
              <ThresholdButton
                key={v} value={v}
                current={settings.challengeCount}
                onPress={() => saveSettings({ ...settings, challengeCount: v })}
                isChallenge
              />
            ))}
          </View>
        </Row>
      </Section>

      {/* ─── Sync & Purge ─── */}
      <Section title="SYNC & PURGE" index={4}>
        <Row label="Auto-purge after sync" description="Automatically remove synced records from device">
          <Switch
            value={settings.autoPurgeAfterSync}
            onValueChange={v => saveSettings({ ...settings, autoPurgeAfterSync: v })}
            trackColor={{ false: 'rgba(255,255,255,0.08)', true: UI_COLORS.SUCCESS }}
            thumbColor={settings.autoPurgeAfterSync ? '#FFF' : '#AAA'}
          />
        </Row>
        <View style={styles.rowDivider} />
        <ActionCard
          icon="☁️"
          label="Sync Now"
          sublabel={`${dbStats.unsyncedCount} records pending`}
          color={UI_COLORS.CYAN}
          onPress={handleManualSync}
          loading={isSyncing}
        />
        <ActionCard
          icon="🗑️"
          label="Purge Synced Records"
          sublabel={`${dbStats.totalRecords - dbStats.unsyncedCount} synced records on device`}
          color={UI_COLORS.WARNING}
          onPress={handlePurge}
          loading={isPurging}
        />
      </Section>

      {/* ─── Danger Zone ─── */}
      <Section title="DANGER ZONE" index={5} danger>
        <View style={styles.dangerContent}>
          <Text style={styles.dangerWarningIcon}>⚠️</Text>
          <Text style={styles.dangerDescription}>
            This action is irreversible. All enrolled face data will be permanently deleted from this device.
          </Text>
          <TouchableOpacity
            style={styles.dangerBtn}
            onPress={handleDeleteAllEnrollments}
            activeOpacity={0.7}
          >
            <Text style={styles.dangerBtnText}>Delete All Enrollments</Text>
          </TouchableOpacity>
        </View>
      </Section>

      {/* ─── Build Info Footer ─── */}
      <Animated.View style={[
        styles.buildInfo,
        { opacity: sectionAnims[6], transform: [{ translateY: sectionSlides[6] }] },
      ]}>
        <View style={styles.buildDivider} />
        <View style={styles.buildLogoRow}>
          <Text style={styles.buildLogo}>◆</Text>
          <Text style={styles.buildAppName}>PRAHARI</Text>
        </View>
        <Text style={styles.buildVersion}>v1.0.0 — Model size: ~8.5 MB</Text>
        <Text style={styles.buildModels}>AdaFace + MobileOne-S0 + MediaPipe FaceMesh</Text>
        <Text style={styles.buildCopyright}>On-device biometric security</Text>
      </Animated.View>

      {/* ─── Benchmark Overlay ─── */}
      <BenchmarkOverlay visible={showBenchmark} onClose={() => setShowBenchmark(false)} />
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: UI_COLORS.BACKGROUND,
  },
  content: {
    paddingHorizontal: 20,
  },

  // ─── Header ──────────────────────────────
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 28,
    paddingTop: 4,
  },
  backButton: {
    width: 44,
    height: 36,
    borderRadius: 18,
    backgroundColor: UI_COLORS.SURFACE_ELEVATED,
    borderWidth: 1,
    borderColor: UI_COLORS.BORDER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backArrow: {
    color: UI_COLORS.ACCENT,
    fontSize: 18,
    fontWeight: '700',
    marginTop: -1,
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    color: UI_COLORS.TEXT_PRIMARY,
    letterSpacing: 0.5,
  },

  // ─── Sections ────────────────────────────
  section: {
    marginBottom: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    gap: 8,
  },
  sectionDot: {
    width: 3,
    height: 14,
    borderRadius: 2,
    backgroundColor: UI_COLORS.ACCENT,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: UI_COLORS.TEXT_SECONDARY,
    letterSpacing: 1.6,
  },
  sectionCard: {
    backgroundColor: UI_COLORS.SURFACE,
    borderRadius: 18,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: UI_COLORS.BORDER,
  },
  dangerCard: {
    borderColor: 'rgba(255,71,87,0.3)',
    borderWidth: 1.5,
    backgroundColor: 'rgba(255,71,87,0.04)',
  },

  // ─── Rows ────────────────────────────────
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 15,
  },
  rowLabel: {
    color: '#DDD',
    fontSize: 14,
    fontWeight: '500',
  },
  rowDescription: {
    color: UI_COLORS.TEXT_SECONDARY,
    fontSize: 11,
    marginTop: 3,
    lineHeight: 15,
  },
  rowDivider: {
    height: 1,
    backgroundColor: UI_COLORS.BORDER,
    marginHorizontal: 16,
  },

  // ─── Stat Rows (Device Vault) ────────────
  statRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 15,
  },
  statRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  statIcon: {
    fontSize: 18,
  },
  statValueContainer: {
    backgroundColor: UI_COLORS.SURFACE_ELEVATED,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: UI_COLORS.BORDER,
  },
  statValue: {
    color: '#FFF',
    fontSize: 17,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  vaultGlowBorder: {
    // Inner wrapper for vault section
  },

  // ─── Threshold Buttons ───────────────────
  threshRow: {
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  threshButtons: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
    marginTop: 10,
  },
  threshBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    backgroundColor: UI_COLORS.SURFACE_ELEVATED,
    position: 'relative',
    overflow: 'hidden',
  },
  threshBtnActive: {
    backgroundColor: UI_COLORS.ACCENT,
    borderColor: UI_COLORS.ACCENT,
    shadowColor: UI_COLORS.ACCENT,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 12,
    elevation: 6,
  },
  threshBtnGlow: {
    position: 'absolute',
    top: -10,
    left: -10,
    right: -10,
    bottom: -10,
    backgroundColor: 'rgba(233,69,96,0.15)',
    borderRadius: 20,
  },
  threshBtnText: {
    color: UI_COLORS.TEXT_SECONDARY,
    fontSize: 13,
    fontWeight: '700',
  },
  threshBtnTextActive: {
    color: '#FFF',
  },
  threshHint: {
    color: UI_COLORS.TEXT_SECONDARY,
    fontSize: 11,
    paddingHorizontal: 16,
    paddingBottom: 14,
    lineHeight: 16,
  },

  // ─── Gauge ───────────────────────────────
  gaugeContainer: {
    paddingHorizontal: 16,
    paddingBottom: 6,
    paddingTop: 4,
  },
  gaugeTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.06)',
    position: 'relative',
    overflow: 'visible',
  },
  gaugeFill: {
    height: '100%',
    borderRadius: 3,
    backgroundColor: UI_COLORS.ACCENT,
    shadowColor: UI_COLORS.ACCENT,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 6,
  },
  gaugeThumb: {
    position: 'absolute',
    top: -5,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#FFF',
    marginLeft: -8,
    borderWidth: 3,
    borderColor: UI_COLORS.ACCENT,
    shadowColor: UI_COLORS.ACCENT,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.7,
    shadowRadius: 8,
    elevation: 4,
  },
  gaugeLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
    paddingHorizontal: 2,
  },
  gaugeLabelText: {
    fontSize: 10,
    fontWeight: '600',
    color: UI_COLORS.TEXT_SECONDARY,
    letterSpacing: 0.3,
  },

  // ─── Action Cards (Sync & Purge) ────────
  actionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 12,
    marginVertical: 6,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
    backgroundColor: 'rgba(255,255,255,0.02)',
  },
  actionCardIconBg: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionCardIcon: {
    fontSize: 18,
  },
  actionCardTextWrap: {
    flex: 1,
    marginLeft: 12,
  },
  actionCardLabel: {
    fontSize: 14,
    fontWeight: '700',
  },
  actionCardSublabel: {
    fontSize: 11,
    color: UI_COLORS.TEXT_SECONDARY,
    marginTop: 2,
  },
  actionCardChevron: {
    fontSize: 24,
    fontWeight: '300',
  },

  // ─── Danger Zone ─────────────────────────
  dangerContent: {
    alignItems: 'center',
    paddingVertical: 20,
    paddingHorizontal: 20,
  },
  dangerWarningIcon: {
    fontSize: 32,
    marginBottom: 10,
  },
  dangerDescription: {
    color: UI_COLORS.TEXT_SECONDARY,
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 18,
  },
  dangerBtn: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: UI_COLORS.ERROR_LIGHT,
    borderWidth: 1,
    borderColor: 'rgba(255,71,87,0.4)',
  },
  dangerBtnText: {
    color: UI_COLORS.ERROR,
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.3,
  },

  // ─── Benchmark Button ────────────────────
  benchmarkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 16,
    position: 'relative',
    overflow: 'hidden',
  },
  benchmarkBtnGlow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(233,69,96,0.04)',
  },
  benchmarkBtnIcon: {
    fontSize: 24,
    marginRight: 14,
  },
  benchmarkBtnTitle: {
    color: UI_COLORS.ACCENT,
    fontSize: 15,
    fontWeight: '700',
  },
  benchmarkBtnSub: {
    color: UI_COLORS.TEXT_SECONDARY,
    fontSize: 11,
    marginTop: 2,
  },
  benchmarkChevron: {
    color: UI_COLORS.ACCENT,
    fontSize: 24,
    fontWeight: '300',
    opacity: 0.6,
  },

  // ─── Build Info Footer ───────────────────
  buildInfo: {
    alignItems: 'center',
    paddingTop: 8,
    paddingBottom: 20,
  },
  buildDivider: {
    width: 60,
    height: 1,
    backgroundColor: UI_COLORS.BORDER,
    marginBottom: 20,
  },
  buildLogoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  buildLogo: {
    color: UI_COLORS.ACCENT,
    fontSize: 14,
  },
  buildAppName: {
    color: UI_COLORS.TEXT_PRIMARY,
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 3,
  },
  buildVersion: {
    color: UI_COLORS.TEXT_SECONDARY,
    fontSize: 11,
    letterSpacing: 0.3,
    marginBottom: 4,
  },
  buildModels: {
    color: UI_COLORS.TEXT_TERTIARY,
    fontSize: 10,
    letterSpacing: 0.3,
    marginBottom: 2,
  },
  buildCopyright: {
    color: UI_COLORS.TEXT_TERTIARY,
    fontSize: 10,
    letterSpacing: 0.4,
    marginTop: 4,
  },
});
