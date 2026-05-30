// src/services/SyncService.ts
// Offline → Online sync with AWS S3 + purge mechanism

import NetInfo, { NetInfoState } from '@react-native-community/netinfo';
import { uploadData } from '@aws-amplify/storage';
import { fetchAuthSession } from 'aws-amplify/auth';
import DeviceInfo from 'react-native-device-info';
import { DatabaseService } from './DatabaseService';
import type { SyncStatus, AttendanceRecord } from '../types';

type SyncListener = (status: SyncStatus) => void;

class SyncServiceClass {
  private isOnline = false;
  private isSyncing = false;
  private listeners: SyncListener[] = [];
  private unsubscribeNetInfo?: () => void;
  private deviceId: string = '';
  private syncRetryTimeout?: ReturnType<typeof setTimeout>;

  // ─── Initialization ───────────────────────────────────────────────────────

  async initialize(): Promise<void> {
    this.deviceId = await DeviceInfo.getUniqueId();

    // Listen for connectivity changes
    this.unsubscribeNetInfo = NetInfo.addEventListener(this.handleConnectivityChange);

    // Check initial state
    const state = await NetInfo.fetch();
    this.handleConnectivityChange(state);

    console.log('[SyncService] ✅ Initialized');
  }

  private handleConnectivityChange = async (state: NetInfoState) => {
    const wasOffline = !this.isOnline;
    this.isOnline = !!(state.isConnected && state.isInternetReachable);

    await this.notifyListeners();

    if (wasOffline && this.isOnline) {
      console.log('[SyncService] 🌐 Back online — starting sync');
      // Slight delay to ensure connection is stable
      this.syncRetryTimeout = setTimeout(() => this.syncPendingRecords(), 2000);
    }
  };

  // ─── Main Sync Logic ──────────────────────────────────────────────────────

  async syncPendingRecords(): Promise<void> {
    if (!this.isOnline || this.isSyncing) return;

    const pending = await DatabaseService.getUnsynced();
    if (pending.length === 0) {
      console.log('[SyncService] ✅ Nothing to sync');
      return;
    }

    this.isSyncing = true;
    await this.notifyListeners();
    console.log(`[SyncService] 📤 Syncing ${pending.length} records...`);

    try {
      // Batch records into chunks of 50
      const chunks = this.chunkArray(pending, 50);
      const session = await fetchAuthSession();
      const identityId = session.identityId ?? 'guest';
      const syncedIds: string[] = [];

      for (const chunk of chunks) {
        const payload = this.buildSyncPayload(chunk);
        const path = `private/${identityId}/attendance/${this.deviceId}/${Date.now()}_${chunk[0].id}.json`;

        await uploadData({
          path,
          data: JSON.stringify(payload),
          options: {
            contentType: 'application/json',
            metadata: {
              deviceId: this.deviceId,
              recordCount: chunk.length.toString(),
              timestamp: Date.now().toString(),
            },
          },
        }).result;

        syncedIds.push(...chunk.map(r => r.id));
        console.log(`[SyncService] ✅ Chunk synced: ${chunk.length} records → ${path}`);
      }

      // Mark as synced in DB
      await DatabaseService.markSynced(syncedIds);

      // Purge synced records from device
      const purged = await DatabaseService.purgeSyncedRecords();
      console.log(`[SyncService] 🗑️ Purged ${purged} records from device`);

    } catch (error) {
      console.error('[SyncService] ❌ Sync failed:', error);
      // Retry after 30 seconds
      this.syncRetryTimeout = setTimeout(() => this.syncPendingRecords(), 30000);
    } finally {
      this.isSyncing = false;
      await this.notifyListeners();
    }
  }

  private buildSyncPayload(records: AttendanceRecord[]) {
    return {
      schemaVersion: '1.0',
      deviceId: this.deviceId,
      syncedAt: new Date().toISOString(),
      recordCount: records.length,
      records: records.map(r => ({
        id: r.id,
        userId: r.userId,
        userName: r.userName,
        employeeId: r.employeeId,
        timestamp: r.timestamp,
        isoTimestamp: new Date(r.timestamp).toISOString(),
        confidence: Math.round(r.confidence * 10000) / 10000,
        livenessScore: Math.round(r.livenessScore * 10000) / 10000,
        location: r.location,
        imageHash: r.imageHash, // SHA-256 only — no raw image ever leaves device
      })),
    };
  }

  // ─── Manual Trigger ───────────────────────────────────────────────────────

  async triggerSync(): Promise<{ success: boolean; message: string }> {
    if (!this.isOnline) {
      return { success: false, message: 'No internet connection' };
    }
    try {
      await this.syncPendingRecords();
      return { success: true, message: 'Sync completed successfully' };
    } catch {
      return { success: false, message: 'Sync failed — will retry automatically' };
    }
  }

  // ─── Status & Listeners ───────────────────────────────────────────────────

  subscribe(listener: SyncListener): () => void {
    this.listeners.push(listener);
    // Immediately emit current status
    this.getStatus().then(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  private async notifyListeners(): Promise<void> {
    const status = await this.getStatus();
    this.listeners.forEach(l => l(status));
  }

  async getStatus(): Promise<SyncStatus> {
    const stats = await DatabaseService.getStats();
    return {
      pendingCount: stats.unsyncedCount,
      isSyncing: this.isSyncing,
      isOnline: this.isOnline,
    };
  }

  // ─── Utilities ─────────────────────────────────────────────────────────────

  private chunkArray<T>(arr: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
      chunks.push(arr.slice(i, i + size));
    }
    return chunks;
  }

  destroy(): void {
    this.unsubscribeNetInfo?.();
    if (this.syncRetryTimeout) clearTimeout(this.syncRetryTimeout);
  }
}

export const SyncService = new SyncServiceClass();
