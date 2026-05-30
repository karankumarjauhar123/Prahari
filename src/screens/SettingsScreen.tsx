// src/screens/SettingsScreen.tsx

import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView,
  TouchableOpacity, Switch, Alert, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DatabaseService } from '../services/DatabaseService';
import { SyncService } from '../services/SyncService';
import { FaceEngine } from '../services/FaceEngine';
import { UI_COLORS } from '../constants';

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

  useEffect(() => {
    loadSettings();
    loadStats();
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

  const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      {children}
    </View>
  );

  const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionCard}>{children}</View>
    </View>
  );

  const ThresholdButton = ({ value, current, onPress }: { value: number; current: number; onPress: () => void }) => (
    <TouchableOpacity
      style={[styles.threshBtn, current === value && styles.threshBtnActive]}
      onPress={onPress}
    >
      <Text style={[styles.threshBtnText, current === value && styles.threshBtnTextActive]}>
        {(value * 100).toFixed(0)}%
      </Text>
    </TouchableOpacity>
  );

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 24 }]}
    >
      <View style={styles.header}>
        <TouchableOpacity onPress={() => nav.goBack()}>
          <Text style={styles.backText}>←</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Settings</Text>
        <View style={{ width: 32 }} />
      </View>

      {/* Device Stats */}
      <Section title="DEVICE VAULT">
        <Row label="Enrolled Faces">
          <Text style={styles.statValue}>{dbStats.totalEmbeddings}</Text>
        </Row>
        <Row label="Total Records">
          <Text style={styles.statValue}>{dbStats.totalRecords}</Text>
        </Row>
        <Row label="Pending Sync">
          <Text style={[styles.statValue, dbStats.unsyncedCount > 0 && { color: UI_COLORS.WARNING }]}>
            {dbStats.unsyncedCount}
          </Text>
        </Row>
      </Section>

      {/* Recognition Thresholds */}
      <Section title="RECOGNITION ACCURACY">
        <View style={styles.threshRow}>
          <Text style={styles.rowLabel}>Match Threshold</Text>
          <View style={styles.threshButtons}>
            {[0.65, 0.70, 0.72, 0.78, 0.85].map(v => (
              <ThresholdButton
                key={v} value={v}
                current={settings.recognitionThreshold}
                onPress={() => saveSettings({ ...settings, recognitionThreshold: v })}
              />
            ))}
          </View>
        </View>
        <Text style={styles.threshHint}>
          Higher = stricter match (fewer false accepts). 72% recommended.
        </Text>
      </Section>

      {/* Liveness */}
      <Section title="LIVENESS DETECTION">
        <Row label="Strict Mode">
          <Switch
            value={settings.livenessStrict}
            onValueChange={v => saveSettings({ ...settings, livenessStrict: v })}
            trackColor={{ true: UI_COLORS.SUCCESS }}
          />
        </Row>
        <Row label="Passive Liveness">
          <Switch
            value={settings.requirePassiveLiveness}
            onValueChange={v => saveSettings({ ...settings, requirePassiveLiveness: v })}
            trackColor={{ true: UI_COLORS.SUCCESS }}
          />
        </Row>
        <Row label="Challenges per Auth">
          <View style={styles.threshButtons}>
            {[1, 2, 3].map(v => (
              <ThresholdButton
                key={v} value={v}
                current={settings.challengeCount}
                onPress={() => saveSettings({ ...settings, challengeCount: v })}
              />
            ))}
          </View>
        </Row>
      </Section>

      {/* Sync */}
      <Section title="SYNC & PURGE">
        <Row label="Auto-purge after sync">
          <Switch
            value={settings.autoPurgeAfterSync}
            onValueChange={v => saveSettings({ ...settings, autoPurgeAfterSync: v })}
            trackColor={{ true: UI_COLORS.SUCCESS }}
          />
        </Row>
        <TouchableOpacity
          style={[styles.actionBtn, { backgroundColor: 'rgba(79,195,247,0.15)', borderColor: '#4FC3F7' }]}
          onPress={handleManualSync}
          disabled={isSyncing}
        >
          {isSyncing
            ? <ActivityIndicator color="#4FC3F7" size="small" />
            : <Text style={[styles.actionBtnText, { color: '#4FC3F7' }]}>☁️  Sync Now</Text>
          }
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionBtn, { backgroundColor: 'rgba(255,179,71,0.12)', borderColor: UI_COLORS.WARNING }]}
          onPress={handlePurge}
          disabled={isPurging}
        >
          {isPurging
            ? <ActivityIndicator color={UI_COLORS.WARNING} size="small" />
            : <Text style={[styles.actionBtnText, { color: UI_COLORS.WARNING }]}>🗑️  Purge Synced Records</Text>
          }
        </TouchableOpacity>
      </Section>

      {/* Danger Zone */}
      <Section title="DANGER ZONE">
        <TouchableOpacity
          style={[styles.actionBtn, { backgroundColor: 'rgba(255,71,87,0.12)', borderColor: UI_COLORS.ERROR }]}
          onPress={handleDeleteAllEnrollments}
        >
          <Text style={[styles.actionBtnText, { color: UI_COLORS.ERROR }]}>
            ⚠️  Delete All Enrollments
          </Text>
        </TouchableOpacity>
      </Section>

      {/* Build info */}
      <View style={styles.buildInfo}>
        <Text style={styles.buildText}>PRAHARI v1.0.0 — Model size: ~8.5 MB</Text>
        <Text style={styles.buildText}>AdaFace + MobileOne-S0 + MediaPipe FaceMesh</Text>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: UI_COLORS.BACKGROUND },
  content: { paddingHorizontal: 20 },
  header: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: 24,
  },
  backText: { color: UI_COLORS.ACCENT, fontSize: 22, fontWeight: '700' },
  title: { fontSize: 18, fontWeight: '800', color: '#FFF' },
  section: { marginBottom: 24 },
  sectionTitle: {
    fontSize: 11, fontWeight: '800', color: UI_COLORS.TEXT_SECONDARY,
    letterSpacing: 1.5, marginBottom: 8,
  },
  sectionCard: {
    backgroundColor: UI_COLORS.SURFACE, borderRadius: 16,
    overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
    gap: 1,
  },
  row: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14,
    backgroundColor: UI_COLORS.SURFACE,
  },
  rowLabel: { color: '#DDD', fontSize: 14, flex: 1 },
  statValue: { color: '#FFF', fontSize: 16, fontWeight: '700' },
  threshRow: { paddingHorizontal: 16, paddingVertical: 14 },
  threshButtons: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginTop: 8 },
  threshBtn: {
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 8, borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    backgroundColor: 'transparent',
  },
  threshBtnActive: { backgroundColor: UI_COLORS.ACCENT, borderColor: UI_COLORS.ACCENT },
  threshBtnText: { color: '#888', fontSize: 12, fontWeight: '700' },
  threshBtnTextActive: { color: '#FFF' },
  threshHint: {
    color: UI_COLORS.TEXT_SECONDARY, fontSize: 11,
    paddingHorizontal: 16, paddingBottom: 12,
  },
  actionBtn: {
    margin: 12, borderRadius: 12, paddingVertical: 13,
    alignItems: 'center', borderWidth: 1,
  },
  actionBtnText: { fontSize: 14, fontWeight: '700' },
  buildInfo: { alignItems: 'center', gap: 4, marginTop: 8 },
  buildText: { color: 'rgba(255,255,255,0.15)', fontSize: 10, letterSpacing: 0.3 },
});
