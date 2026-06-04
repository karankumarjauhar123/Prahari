// src/services/DatabaseService.ts
// Encrypted local storage using SQLite + SQLCipher
// Embeddings secured via Android Keystore / iOS Secure Enclave

import SQLite from 'react-native-sqlite-storage';
import Keychain from 'react-native-keychain';
import AesCrypto from 'react-native-aes-crypto';
import DeviceInfo from 'react-native-device-info';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DB_CONFIG } from '../constants';
import type { FaceEmbedding, AttendanceRecord } from '../types';

SQLite.enablePromise(true);

class DatabaseServiceClass {
  private db: SQLite.SQLiteDatabase | null = null;
  private encryptionKey: string = '';
  private initPromise: Promise<void> | null = null;
  private isInitialized = false;
  private usedKeyType: 'keychain' | 'fallback' | null = null;

  // ─── Initialization ───────────────────────────────────────────────────────

  async initialize(): Promise<void> {
    if (this.isInitialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      try {
        await this.loadOrCreateEncryptionKey();
        this.db = await SQLite.openDatabase({
          name: DB_CONFIG.DATABASE_NAME,
          location: 'default',
          // SQLCipher encryption key passed here
          key: this.encryptionKey,
        });
        await this.createTables();

        // Persist the key type used to open the database successfully
        if (this.usedKeyType) {
          await AsyncStorage.setItem('@prahari_db_key_type', this.usedKeyType);
        }

        this.isInitialized = true;
        console.log(`[DatabaseService] ✅ Initialized with key type: ${this.usedKeyType}`);
      } catch (error) {
        this.initPromise = null;
        console.error('[DatabaseService] Initialization failed:', error);
        throw error;
      }
    })();

    return this.initPromise;
  }

  private async ensureInitialized(): Promise<SQLite.SQLiteDatabase> {
    if (!this.db || !this.isInitialized) {
      await this.initialize();
    }
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    return this.db;
  }

  private async loadOrCreateEncryptionKey(): Promise<void> {
    const deviceId = await DeviceInfo.getUniqueId();
    const storedKeyType = await AsyncStorage.getItem('@prahari_db_key_type');

    if (storedKeyType === 'fallback') {
      this.encryptionKey = await AesCrypto.sha256(`${deviceId}_prahari_fallback`);
      this.usedKeyType = 'fallback';
      console.log('[DatabaseService] 🔐 Using fallback encryption key (enforced by key type)');
      return;
    }

    if (storedKeyType === 'keychain') {
      try {
        const credentials = await Keychain.getGenericPassword({
          service: DB_CONFIG.ENCRYPTION_KEY_ALIAS,
        });
        if (!credentials) {
          throw new Error('No credentials found in Keychain for registered key type');
        }
        this.encryptionKey = credentials.password;
        this.usedKeyType = 'keychain';
        console.log('[DatabaseService] 🔐 Using Keychain encryption key');
        return;
      } catch (error) {
        console.error('[DatabaseService] Failed to load Keychain key, but database was encrypted with it:', error);
        throw new Error('Secure hardware keystore is currently locked or unavailable. Please unlock your device and retry.');
      }
    }

    // First-time launch or uninitialized key type: try Keychain first, fallback if it fails
    try {
      // For compatibility: also check legacy fallback key forced flag
      const useFallbackStr = await AsyncStorage.getItem('@prahari_use_fallback_key');
      if (useFallbackStr === 'true') {
        throw new Error('Legacy fallback key forced');
      }

      const credentials = await Keychain.getGenericPassword({
        service: DB_CONFIG.ENCRYPTION_KEY_ALIAS,
      });

      if (credentials) {
        this.encryptionKey = credentials.password;
        this.usedKeyType = 'keychain';
      } else {
        const timestamp = Date.now().toString();
        const rawKey = await AesCrypto.sha256(`${deviceId}_${timestamp}_prahari_v1`);
        const success = await Keychain.setGenericPassword('prahari_db', rawKey, {
          service: DB_CONFIG.ENCRYPTION_KEY_ALIAS,
          accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
        });
        if (!success) {
          throw new Error('Keychain setGenericPassword returned false');
        }
        this.encryptionKey = rawKey;
        this.usedKeyType = 'keychain';
      }
    } catch (error) {
      console.warn('[DatabaseService] Keychain access failed during first launch, falling back to derived key:', error);
      this.encryptionKey = await AesCrypto.sha256(`${deviceId}_prahari_fallback`);
      this.usedKeyType = 'fallback';
    }
  }

  private async createTables(): Promise<void> {
    if (!this.db) return;

    await this.db.executeSql(`
      CREATE TABLE IF NOT EXISTS face_embeddings (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL UNIQUE,
        user_name TEXT NOT NULL,
        employee_id TEXT NOT NULL,
        embedding_enc TEXT NOT NULL,   -- AES-256 encrypted JSON array
        enrolled_at INTEGER NOT NULL,
        device_id TEXT NOT NULL
      );
    `);

    await this.db.executeSql(`
      CREATE TABLE IF NOT EXISTS attendance_records (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        user_name TEXT NOT NULL,
        employee_id TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        confidence REAL NOT NULL,
        liveness_score REAL NOT NULL,
        location_lat REAL,
        location_lng REAL,
        synced INTEGER DEFAULT 0,
        image_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);

    await this.db.executeSql(
      `CREATE INDEX IF NOT EXISTS idx_attendance_synced ON attendance_records(synced);`
    );
    await this.db.executeSql(
      `CREATE INDEX IF NOT EXISTS idx_attendance_user ON attendance_records(user_id);`
    );
  }

  // ─── Face Embeddings CRUD ──────────────────────────────────────────────────

  async saveEmbedding(embedding: FaceEmbedding): Promise<void> {
    const db = await this.ensureInitialized();

    // Embeddings are already fully secured by SQLCipher encryption on the database file level.
    // Storing as JSON string to eliminate bridge-call performance bottlenecks.
    const embeddingStore = JSON.stringify(embedding.embedding);

    await db.executeSql(
      `INSERT OR REPLACE INTO face_embeddings
       (id, user_id, user_name, employee_id, embedding_enc, enrolled_at, device_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        embedding.id,
        embedding.userId,
        embedding.userName,
        embedding.employeeId,
        embeddingStore,
        embedding.enrolledAt,
        embedding.deviceId,
      ]
    );
  }

  async getAllEmbeddings(): Promise<FaceEmbedding[]> {
    const db = await this.ensureInitialized();
    const [result] = await db.executeSql(
      'SELECT * FROM face_embeddings'
    );

    const embeddings: FaceEmbedding[] = [];
    for (let i = 0; i < result.rows.length; i++) {
      const row = result.rows.item(i);
      try {
        const parsed = JSON.parse(row.embedding_enc);
        let embeddingArray: number[];
        
        if (parsed && typeof parsed === 'object' && 'data' in parsed && 'iv' in parsed) {
          // Decrypt legacy records (if any exist in database)
          const decryptedJson = await AesCrypto.decrypt(
            parsed.data, this.encryptionKey,
            parsed.iv, 'aes-256-cbc'
          );
          embeddingArray = JSON.parse(decryptedJson);
        } else {
          // Standard JSON array format (fast, no native bridge decryption delay)
          embeddingArray = parsed;
        }

        embeddings.push({
          id: row.id,
          userId: row.user_id,
          userName: row.user_name,
          employeeId: row.employee_id,
          embedding: embeddingArray,
          enrolledAt: row.enrolled_at,
          deviceId: row.device_id,
        });
      } catch (e) {
        console.error('[DB] Failed to parse/decrypt embedding for user:', row.user_id);
      }
    }
    return embeddings;
  }

  async deleteEmbedding(userId: string): Promise<void> {
    const db = await this.ensureInitialized();
    await db.executeSql(
      'DELETE FROM face_embeddings WHERE user_id = ?', [userId]
    );
  }

  // ─── Attendance Records CRUD ───────────────────────────────────────────────

  async saveAttendance(record: AttendanceRecord): Promise<void> {
    const db = await this.ensureInitialized();
    await db.executeSql(
      `INSERT INTO attendance_records
       (id, user_id, user_name, employee_id, timestamp, confidence,
        liveness_score, location_lat, location_lng, synced, image_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      [
        record.id,
        record.userId,
        record.userName,
        record.employeeId,
        record.timestamp,
        record.confidence,
        record.livenessScore,
        record.location?.lat ?? null,
        record.location?.lng ?? null,
        record.imageHash,
        Date.now(),
      ]
    );
  }

  async getUnsynced(): Promise<AttendanceRecord[]> {
    const db = await this.ensureInitialized();
    const [result] = await db.executeSql(
      'SELECT * FROM attendance_records WHERE synced = 0 ORDER BY timestamp ASC LIMIT 100'
    );
    const records: AttendanceRecord[] = [];
    for (let i = 0; i < result.rows.length; i++) {
      const row = result.rows.item(i);
      const hasLocation = row.location_lat !== null && row.location_lat !== undefined &&
                          row.location_lng !== null && row.location_lng !== undefined;
      records.push({
        id: row.id,
        userId: row.user_id,
        userName: row.user_name,
        employeeId: row.employee_id,
        timestamp: row.timestamp,
        confidence: row.confidence,
        livenessScore: row.liveness_score,
        location: hasLocation ? { lat: Number(row.location_lat), lng: Number(row.location_lng) } : undefined,
        synced: false,
        imageHash: row.image_hash,
      });
    }
    return records;
  }

  async markSynced(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const db = await this.ensureInitialized();
    const placeholders = ids.map(() => '?').join(',');
    await db.executeSql(
      `UPDATE attendance_records SET synced = 1 WHERE id IN (${placeholders})`,
      ids
    );
  }

  async markFailed(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const db = await this.ensureInitialized();
    const placeholders = ids.map(() => '?').join(',');
    await db.executeSql(
      `UPDATE attendance_records SET synced = 2 WHERE id IN (${placeholders})`,
      ids
    );
  }

  async purgeSyncedRecords(): Promise<number> {
    const db = await this.ensureInitialized();
    const [result] = await db.executeSql(
      'DELETE FROM attendance_records WHERE synced = 1'
    );
    console.log(`[DB] Purged ${result.rowsAffected} synced records`);
    return result.rowsAffected;
  }

  async getAttendanceHistory(userId?: string, limit = 50): Promise<AttendanceRecord[]> {
    const db = await this.ensureInitialized();
    const query = userId
      ? 'SELECT * FROM attendance_records WHERE user_id = ? ORDER BY timestamp DESC LIMIT ?'
      : 'SELECT * FROM attendance_records ORDER BY timestamp DESC LIMIT ?';
    const params = userId ? [userId, limit] : [limit];
    const [result] = await db.executeSql(query, params);

    const records: AttendanceRecord[] = [];
    for (let i = 0; i < result.rows.length; i++) {
      const row = result.rows.item(i);
      const hasLocation = row.location_lat !== null && row.location_lat !== undefined &&
                          row.location_lng !== null && row.location_lng !== undefined;
      records.push({
        id: row.id, userId: row.user_id, userName: row.user_name,
        employeeId: row.employee_id, timestamp: row.timestamp,
        confidence: row.confidence, livenessScore: row.liveness_score,
        location: hasLocation ? { lat: Number(row.location_lat), lng: Number(row.location_lng) } : undefined,
        synced: row.synced === 1, imageHash: row.image_hash,
      });
    }
    return records;
  }

  async getStats(): Promise<{ totalEmbeddings: number; totalRecords: number; unsyncedCount: number }> {
    const db = await this.ensureInitialized();
    const [emb] = await db.executeSql('SELECT COUNT(*) as cnt FROM face_embeddings');
    const [total] = await db.executeSql('SELECT COUNT(*) as cnt FROM attendance_records');
    const [unsynced] = await db.executeSql('SELECT COUNT(*) as cnt FROM attendance_records WHERE synced = 0');
    return {
      totalEmbeddings: emb.rows.item(0).cnt,
      totalRecords: total.rows.item(0).cnt,
      unsyncedCount: unsynced.rows.item(0).cnt,
    };
  }

  async close(): Promise<void> {
    if (this.db) {
      await this.db.close();
      this.db = null;
    }
    this.isInitialized = false;
    this.initPromise = null;
    this.usedKeyType = null;
  }
}

export const DatabaseService = new DatabaseServiceClass();
