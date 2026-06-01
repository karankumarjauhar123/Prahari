// src/hooks/useSyncStatus.ts
import { useState, useEffect, useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { SyncService } from '../services/SyncService';
import { DatabaseService } from '../services/DatabaseService';
import type { SyncStatus } from '../types';

interface Stats {
  totalEmbeddings: number;
  totalRecords: number;
  unsyncedCount: number;
}

export const useSyncStatus = () => {
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({
    pendingCount: 0,
    isSyncing: false,
    isOnline: false,
  });
  const [stats, setStats] = useState<Stats>({
    totalEmbeddings: 0,
    totalRecords: 0,
    unsyncedCount: 0,
  });

  const reloadStats = useCallback(async () => {
    try {
      const s = await DatabaseService.getStats();
      setStats(s);
    } catch (err) {
      console.error('[useSyncStatus] Failed to load stats:', err);
    }
  }, []);

  useEffect(() => {
    const unsubscribe = SyncService.subscribe(setSyncStatus);
    reloadStats();
    return unsubscribe;
  }, []);

  useFocusEffect(
    useCallback(() => {
      reloadStats();
    }, [reloadStats])
  );

  const triggerSync = useCallback(async () => {
    const result = await SyncService.triggerSync();
    await reloadStats();
    return result;
  }, [reloadStats]);

  return { syncStatus, stats, triggerSync, reloadStats };
};
