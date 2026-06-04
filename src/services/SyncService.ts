// src/services/SyncService.ts
// Offline-first sync service — queues records locally and syncs when online
// Removed aws-amplify and netinfo hard dependencies to prevent crashes
// Sync will use fetch() when online — no external cloud SDK required

import { AppState, AppStateStatus } from 'react-native';
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
  private retryTimeout?: ReturnType<typeof setTimeout>;
  private appStateSubscription?: any;
  private retryCount = 0;

  // ─── Initialization ───────────────────────────────────────────────────────

  async initialize(): Promise<void> {
    try {
      this.deviceId = await DeviceInfo.getUniqueId();
    } catch (e) {
      console.error('[SyncService] Failed to get unique device ID:', e);
      this.deviceId = 'unknown_device';
    }

    // Simple connectivity check using fetch (no external dependency)
    this.checkConnectivity();
    this.connectivityInterval = setInterval(() => this.checkConnectivity(), 30000);

    // Register AppState listener to check connectivity when returning to foreground
    try {
      this.appStateSubscription = AppState.addEventListener('change', this.handleAppStateChange);
    } catch (e) {
      console.error('[SyncService] Failed to add AppState listener:', e);
    }

    console.log('[SyncService] ✅ Initialized (offline-first mode)');
  }

  private handleAppStateChange = (nextAppState: AppStateStatus) => {
    if (nextAppState === 'active') {
      console.log('[SyncService] App returned to foreground, probing connectivity');
      this.checkConnectivity();
    }
  };

  private async checkConnectivity(): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    let online = false;

    try {
      const endpoint = await this.getSyncEndpoint();
      const match = endpoint.match(/^(https?:\/\/[^\/]+)/i);
      const probeUrl = match ? match[1] : endpoint;

      // Try to probe the custom/default sync endpoint host first
      await fetch(probeUrl, {
        method: 'HEAD',
        signal: controller.signal,
      });
      online = true;
    } catch {
      // Fallback to Google generate_204
      let fallbackTimeout: ReturnType<typeof setTimeout> | undefined;
      try {
        const fallbackController = new AbortController();
        fallbackTimeout = setTimeout(() => fallbackController.abort(), 5000);
        await fetch('https://www.google.com/generate_204', {
          method: 'HEAD',
          signal: fallbackController.signal,
        });
        online = true;
      } catch {
        online = false;
      } finally {
        if (fallbackTimeout) {
          clearTimeout(fallbackTimeout);
        }
      }
    } finally {
      clearTimeout(timeout);
    }

    const wasOffline = !this.isOnline;
    this.isOnline = online;

    if (this.isOnline && wasOffline) {
      console.log('[SyncService] 🌐 Back online — starting sync');
      if (this.retryTimeout) {
        clearTimeout(this.retryTimeout);
        this.retryTimeout = undefined;
      }
      setTimeout(() => this.syncPendingRecords(), 2000);
    }
    await this.notifyListeners();
  }

  // ─── Main Sync Logic ──────────────────────────────────────────────────────

  async syncPendingRecords(): Promise<boolean> {
    if (!this.isOnline || this.isSyncing) return false;

    this.isSyncing = true;
    await this.notifyListeners();

    if (this.retryTimeout) {
      clearTimeout(this.retryTimeout);
      this.retryTimeout = undefined;
    }

    // Try to fetch device ID on demand if it was not retrieved properly during initialize
    if (!this.deviceId || this.deviceId === 'unknown_device') {
      try {
        this.deviceId = await DeviceInfo.getUniqueId();
      } catch {
        this.deviceId = 'unknown_device';
      }
    }

    try {
      let hasMore = true;
      const syncedIds: string[] = [];

      while (hasMore) {
        const pending = await DatabaseService.getUnsynced();
        if (pending.length === 0) {
          hasMore = false;
          break;
        }

        console.log(`[SyncService] 📤 Found ${pending.length} pending records to sync.`);

        // Batch records into chunks of 50
        const chunks = this.chunkArray(pending, 50);

        for (const chunk of chunks) {
          const payload = this.buildSyncPayload(chunk);
          const endpoint = await this.getSyncEndpoint();

          const controller = new AbortController();
          const syncTimeout = setTimeout(() => controller.abort(), 15000);
          let response: Response;
          try {
            response = await fetch(endpoint, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-Device-ID': this.deviceId,
                'X-App-Version': '1.0.0',
                'X-Schema-Version': '1.0',
              },
              body: JSON.stringify(payload),
              signal: controller.signal,
            });
          } catch (fetchError) {
            console.error('[SyncService] Network fetch error during batch sync:', fetchError);
            throw fetchError; // propagate to trigger retry later
          } finally {
            clearTimeout(syncTimeout);
          }

          if (!response.ok) {
            // Check for non-retryable client errors (400, 401, 403, 404, 422, etc.)
            // Excluding transient ones like 408 (timeout) and 429 (rate limit)
            const isClientError = response.status >= 400 && response.status < 500 &&
              response.status !== 408 && response.status !== 429;

            if (isClientError) {
              const chunkIds = chunk.map(r => r.id);
              await DatabaseService.markFailed(chunkIds);
              console.error(`[SyncService] ❌ Client error (${response.status}) on batch sync. Quarantined ${chunk.length} records to prevent head-of-line blocking.`);
              continue; // proceed to next batch, do not throw
            } else {
              throw new Error(`Sync failed: HTTP ${response.status} ${response.statusText}`);
            }
          }

          // Server acknowledged the batch
          try {
            const responseData = await response.json();
            console.log(`[SyncService] ✅ Server acknowledged: ${responseData.acknowledged ?? chunk.length} records`);
          } catch {
            // Response may not be JSON — that's OK as long as status was 2xx
            console.log(`[SyncService] ✅ Server accepted batch: ${chunk.length} records`);
          }

          // Mark this chunk as synced in DB immediately to prevent duplicates on partial network failures
          const chunkIds = chunk.map(r => r.id);
          await DatabaseService.markSynced(chunkIds);
          console.log(`[SyncService] ✅ Chunk synced & marked in DB: ${chunk.length} records`);

          syncedIds.push(...chunkIds);
        }

        // If the query returned less than the limit (100), we processed everything
        if (pending.length < 100) {
          hasMore = false;
        }
      }

      // Reset retry count on complete success
      this.retryCount = 0;

      // Auto-purge if setting is enabled (run only if at least one chunk succeeded)
      if (syncedIds.length > 0) {
        try {
          const rawSettings = await AsyncStorage.getItem('@prahari_settings');
          let autoPurge = true; // Default is true, matching DEFAULT_SETTINGS in SettingsScreen
          if (rawSettings) {
            const settings = JSON.parse(rawSettings);
            if (settings.autoPurgeAfterSync !== undefined) {
              autoPurge = settings.autoPurgeAfterSync;
            }
          }
          if (autoPurge) {
            const purgedCount = await DatabaseService.purgeSyncedRecords();
            console.log(`[SyncService] ✅ Auto-purged ${purgedCount} synced records`);
          }
        } catch (purgeError) {
          console.error('[SyncService] Auto-purge failed:', purgeError);
        }
      }
      return true;
    } catch (error) {
      console.error('[SyncService] ❌ Sync failed:', error);

      // Implement Exponential Backoff with Jitter
      this.retryCount++;
      // 2^retryCount * 5 seconds (5s, 10s, 20s, 40s, 80s, etc.), max 5 minutes (300000ms)
      const backoff = Math.min(Math.pow(2, this.retryCount) * 5000, 300000);
      const jitter = Math.random() * 2000; // up to 2s random jitter
      const delay = backoff + jitter;

      console.log(`[SyncService] Scheduling retry #${this.retryCount} in ${(delay / 1000).toFixed(1)}s`);
      this.retryTimeout = setTimeout(() => this.syncPendingRecords(), delay);

      return false;
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
      records: records.map(r => {
        let isoTimestampStr = new Date().toISOString();
        try {
          if (typeof r.timestamp === 'number' && !isNaN(r.timestamp) && r.timestamp > 0) {
            isoTimestampStr = new Date(r.timestamp).toISOString();
          }
        } catch {
          // Fallback if parsing fails
        }

        const confidenceVal = typeof r.confidence === 'number' && !isNaN(r.confidence)
          ? Math.round(r.confidence * 10000) / 10000
          : 0;

        const livenessVal = typeof r.livenessScore === 'number' && !isNaN(r.livenessScore)
          ? Math.round(r.livenessScore * 10000) / 10000
          : 0;

        return {
          id: r.id,
          userId: r.userId,
          userName: r.userName,
          employeeId: r.employeeId,
          timestamp: r.timestamp,
          isoTimestamp: isoTimestampStr,
          confidence: confidenceVal,
          livenessScore: livenessVal,
          location: r.location ?? null, // normalize undefined to null for JSON compliance
          imageHash: r.imageHash, // SHA-256 only — no raw image ever leaves device
        };
      }),
    };
  }

  private async getSyncEndpoint(): Promise<string> {
    const defaultEndpoint = 'https://datalake-api.execute-api.ap-south-1.amazonaws.com/prod/attendance/sync';
    try {
      const customEndpoint = await AsyncStorage.getItem('@prahari_sync_endpoint');
      if (customEndpoint && customEndpoint.trim().length > 0) {
        const trimmed = customEndpoint.trim();
        // Basic URL validation
        if (/^https?:\/\/[^\s$.?#].[^\s]*$/i.test(trimmed)) {
          return trimmed;
        }
        console.warn(`[SyncService] Invalid custom endpoint stored: "${trimmed}". Falling back to default.`);
      }
    } catch (e) {
      console.error('[SyncService] Failed to read sync endpoint from AsyncStorage:', e);
    }
    return defaultEndpoint;
  }

  // ─── Manual Trigger ───────────────────────────────────────────────────────

  async triggerSync(): Promise<{ success: boolean; message: string }> {
    // Re-check connectivity first
    await this.checkConnectivity();

    if (!this.isOnline) {
      return { success: false, message: 'No internet connection. Records are securely queued on device.' };
    }
    try {
      const success = await this.syncPendingRecords();
      if (success) {
        return { success: true, message: 'Sync completed successfully' };
      } else {
        return { success: false, message: 'Sync failed — will retry automatically when online' };
      }
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
    if (this.connectivityInterval) {
      clearInterval(this.connectivityInterval);
    }
    if (this.retryTimeout) {
      clearTimeout(this.retryTimeout);
    }
    if (this.appStateSubscription) {
      if (typeof this.appStateSubscription.remove === 'function') {
        this.appStateSubscription.remove();
      } else {
        // Fallback for older react-native versions
        (AppState as any).removeEventListener('change', this.handleAppStateChange as any);
      }
    }
  }
}

export const SyncService = new SyncServiceClass();
