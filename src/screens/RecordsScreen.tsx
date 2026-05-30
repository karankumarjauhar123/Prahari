// src/screens/RecordsScreen.tsx
// View attendance records + sync status

import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { DatabaseService } from '../services/DatabaseService';
import { SyncService } from '../services/SyncService';
import { UI_COLORS } from '../constants';
import type { AttendanceRecord, SyncStatus } from '../types';

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

  useEffect(() => {
    loadRecords();
    const unsubscribe = SyncService.subscribe(setSyncStatus);
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

  const renderRecord = ({ item }: { item: AttendanceRecord }) => (
    <View style={styles.recordCard}>
      <View style={styles.recordLeft}>
        <Text style={styles.recordName}>{item.userName}</Text>
        <Text style={styles.recordId}>{item.employeeId}</Text>
        <Text style={styles.recordTime}>{formatTime(item.timestamp)}</Text>
      </View>
      <View style={styles.recordRight}>
        <View style={[styles.syncBadge, item.synced ? styles.syncedBadge : styles.pendingBadge]}>
          <Text style={styles.syncBadgeText}>{item.synced ? '☁️ Synced' : '⏳ Pending'}</Text>
        </View>
        <Text style={styles.confidence}>{Math.round(item.confidence * 100)}%</Text>
      </View>
    </View>
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack}>
          <Text style={styles.backText}>←</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Attendance Log</Text>
        <TouchableOpacity
          style={styles.syncBtn}
          onPress={handleSync}
          disabled={!syncStatus.isOnline || syncStatus.isSyncing}
        >
          {syncStatus.isSyncing
            ? <ActivityIndicator color="#FFF" size="small" />
            : <Text style={styles.syncBtnText}>Sync ↑</Text>
          }
        </TouchableOpacity>
      </View>

      {/* Sync Status Bar */}
      <View style={[styles.statusBar, { backgroundColor: syncStatus.isOnline ? 'rgba(0,200,151,0.15)' : 'rgba(255,71,87,0.15)' }]}>
        <View style={[styles.statusDot, { backgroundColor: syncStatus.isOnline ? UI_COLORS.SUCCESS : UI_COLORS.ERROR }]} />
        <Text style={styles.statusText}>
          {syncStatus.isOnline ? 'Online' : 'Offline'}
          {syncStatus.pendingCount > 0 ? ` · ${syncStatus.pendingCount} pending sync` : ' · All synced'}
        </Text>
      </View>

      {/* Records List */}
      {loading ? (
        <ActivityIndicator color={UI_COLORS.ACCENT} size="large" style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={records}
          keyExtractor={item => item.id}
          renderItem={renderRecord}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadRecords(); }} />
          }
          ListEmptyComponent={
            <Text style={styles.emptyText}>No attendance records yet</Text>
          }
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: UI_COLORS.BACKGROUND },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 16,
  },
  backText: { color: UI_COLORS.ACCENT, fontSize: 22, fontWeight: '700' },
  title: { fontSize: 18, fontWeight: '800', color: '#FFF' },
  syncBtn: {
    backgroundColor: UI_COLORS.ACCENT, paddingHorizontal: 14,
    paddingVertical: 7, borderRadius: 12,
  },
  syncBtnText: { color: '#FFF', fontWeight: '700', fontSize: 13 },
  statusBar: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 20, paddingVertical: 10,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { color: '#CCC', fontSize: 13 },
  listContent: { padding: 16, gap: 10 },
  recordCard: {
    backgroundColor: UI_COLORS.SURFACE, borderRadius: 14,
    padding: 16, flexDirection: 'row', justifyContent: 'space-between',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
  },
  recordLeft: { flex: 1 },
  recordName: { color: '#FFF', fontSize: 16, fontWeight: '700' },
  recordId: { color: UI_COLORS.TEXT_SECONDARY, fontSize: 12, marginTop: 2 },
  recordTime: { color: UI_COLORS.TEXT_SECONDARY, fontSize: 12, marginTop: 4 },
  recordRight: { alignItems: 'flex-end', gap: 6 },
  syncBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  syncedBadge: { backgroundColor: 'rgba(0,200,151,0.2)' },
  pendingBadge: { backgroundColor: 'rgba(255,179,71,0.2)' },
  syncBadgeText: { fontSize: 11, fontWeight: '600', color: '#CCC' },
  confidence: { color: UI_COLORS.SUCCESS, fontSize: 15, fontWeight: '700' },
  emptyText: { textAlign: 'center', color: UI_COLORS.TEXT_SECONDARY, marginTop: 60, fontSize: 15 },
});
