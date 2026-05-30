// src/types/index.ts

export interface FaceEmbedding {
  id: string;
  userId: string;
  userName: string;
  employeeId: string;
  embedding: number[];          // 128-dim AdaFace vector
  enrolledAt: number;
  deviceId: string;
}

export interface AttendanceRecord {
  id: string;
  userId: string;
  userName: string;
  employeeId: string;
  timestamp: number;
  confidence: number;
  livenessScore: number;
  location?: { lat: number; lng: number };
  synced: boolean;
  imageHash: string;            // SHA-256 of face crop — no raw image stored
}

export type LivenessChallenge = 'BLINK' | 'SMILE' | 'TURN_LEFT' | 'TURN_RIGHT' | 'NOD';

export interface LivenessResult {
  passed: boolean;
  score: number;                // 0–1
  passiveScore: number;         // frequency + optical flow + LBP
  activeScore: number;          // challenge completion score
  spoofDetected: boolean;
}

export interface FaceDetection {
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
  landmarks: FaceLandmarks;
}

export interface FaceLandmarks {
  leftEye: Point;
  rightEye: Point;
  nose: Point;
  leftMouth: Point;
  rightMouth: Point;
}

export interface Point {
  x: number;
  y: number;
}

export interface FaceMeshLandmarks {
  points: Point[];              // 468 MediaPipe landmarks
  leftEyePoints: Point[];
  rightEyePoints: Point[];
  lipPoints: Point[];
  nosePoints: Point[];
}

export interface QualityResult {
  pass: boolean;
  score: number;
  reason?: string;
  blur: number;
  brightness: number;
  faceSize: number;
}

export interface RecognitionResult {
  matched: boolean;
  userId?: string;
  userName?: string;
  employeeId?: string;
  confidence: number;
  processingTimeMs: number;
}

export interface SyncStatus {
  pendingCount: number;
  lastSyncAt?: number;
  isSyncing: boolean;
  isOnline: boolean;
}

export type AppScreen = 'HOME' | 'AUTH' | 'ENROLL' | 'RECORDS' | 'SETTINGS';
