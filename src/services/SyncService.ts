// src/services/SyncService.ts
// Offline-first sync service — queues records locally and syncs when online
// Removed aws-amplify and netinfo hard dependencies to prevent crashes
// Sync will use fetch() when online — no external cloud SDK required

import DeviceInfo from 'react-native-device-info';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DatabaseService } from './DatabaseService';
import type { SyncStatus, AttendanceRecord } from '../types';

type SyncListener = (status: SyncStatus) => void;

class SyncServiceClass {
  private isOnline = false;
  private isSyncing = false;
  private listeners: SyncListener[] = [];
  private deviceId: string = '';
  private connectivityInterval?: ReturnType<typeof setInterval>;

  // ─── Initialization ───────────────────────────────────────────────────────

  async initialize(): Promise<void> {
    this.deviceId = await DeviceInfo.getUniqueId();

    // Simple connectivity check using fetch (no external dependency)
    this.checkConnectivity();
    this.connectivityInterval = setInterval(() => this.checkConnectivity(), 30000);

    console.log('[SyncService] ✅ Initialized (offline-first mode)');
  }

  private async checkConnectivity(): Promise<void> {
    try {
      // Try a lightweight HEAD request to check connectivity
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      await fetch('https://www.google.com/generate_204', {
        method: 'HEAD',
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const wasOffline = !this.isOnline;
      this.isOnline = true;

      if (wasOffline) {
        console.log('[SyncService] 🌐 Back online — starting sync');
        setTimeout(() => this.syncPendingRecords(), 2000);
      }
    } catch {
      this.isOnline = false;
    }
    await this.notifyListeners();
  }

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
      const syncedIds: string[] = [];

      for (const chunk of chunks) {
        const payload = this.buildSyncPayload(chunk);

        // POST to Datalake 3.0 sync endpoint
        const endpoint = await this.getSyncEndpoint();
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Device-ID': this.deviceId,
            'X-App-Version': '1.0.0',
            'X-Schema-Version': '1.0',
          },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          throw new Error(`Sync failed: HTTP ${response.status} ${response.statusText}`);
        }

        // Server acknowledged the batch
        try {
          const responseData = await response.json();
          console.log(`[SyncService] ✅ Server acknowledged: ${responseData.acknowledged ?? chunk.length} records`);
        } catch {
          // Response may not be JSON — that's OK as long as status was 2xx
          console.log(`[SyncService] ✅ Server accepted batch: ${chunk.length} records`);
        }

        syncedIds.push(...chunk.map(r => r.id));
        console.log(`[SyncService] ✅ Chunk synced: ${chunk.length} records`);
      }

      // Mark as synced in DB
      if (syncedIds.length > 0) {
        await DatabaseService.markSynced(syncedIds);
        console.log(`[SyncService] ✅ Marked ${syncedIds.length} records as synced`);

        // Auto-purge if setting is enabled
        try {
          const rawSettings = await AsyncStorage.getItem('@prahari_settings');
          if (rawSettings) {
            const settings = JSON.parse(rawSettings);
            if (settings.autoPurgeAfterSync) {
              await DatabaseService.purgeSyncedRecords();
              console.log('[SyncService] ✅ Auto-purged synced records');
            }
          }
        } catch (purgeError) {
          console.error('[SyncService] Auto-purge failed:', purgeError);
        }
      }

    } catch (error) {
      console.error('[SyncService] ❌ Sync failed:', error);
      // Retry after 30 seconds
      setTimeout(() => this.syncPendingRecords(), 30000);
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

  private async getSyncEndpoint(): Promise<string> {
    try {
      const customEndpoint = await AsyncStorage.getItem('@prahari_sync_endpoint');
      if (customEndpoint && customEndpoint.trim().length > 0) {
        return customEndpoint.trim();
      }
    } catch {}
    // Default Datalake 3.0 endpoint (configure in Settings)
    return 'https://datalake-api.execute-api.ap-south-1.amazonaws.com/prod/attendance/sync';
  }

  // ─── Manual Trigger ───────────────────────────────────────────────────────

  async triggerSync(): Promise<{ success: boolean; message: string }> {
    // Re-check connectivity first
    await this.checkConnectivity();

    if (!this.isOnline) {
      return { success: false, message: 'No internet connection. Records are securely queued on device.' };
    }
    try {
      await this.syncPendingRecords();
      return { success: true, message: 'Sync completed successfully' };
    } catch {
      return { success: false, message: 'Sync failed — will retry automatically when online' };
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
    if (this.connectivityInterval) clearInterval(this.connectivityInterval);
  }
}

export const SyncService = new SyncServiceClass();
