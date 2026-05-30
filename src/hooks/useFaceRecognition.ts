// src/hooks/useFaceRecognition.ts
// Master hook — orchestrates detection → quality → liveness → recognition

import { useEffect, useRef, useState, useCallback } from 'react';
import DeviceInfo from 'react-native-device-info';
import AesCrypto from 'react-native-aes-crypto';
import { v4 as uuid } from 'uuid';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { FaceEngine } from '../services/FaceEngine';
import { LivenessEngine } from '../services/LivenessEngine';
import { DatabaseService } from '../services/DatabaseService';
import type {
  FaceDetection,
  LivenessChallenge,
  AttendanceRecord,
} from '../types';

type AuthState =
  | 'INITIALIZING' | 'WAITING_FACE' | 'QUALITY_CHECK'
  | 'LIVENESS_PASSIVE' | 'LIVENESS_ACTIVE' | 'RECOGNIZING'
  | 'SUCCESS' | 'FAILED' | 'SPOOF_DETECTED';

interface Props {
  onStateChange: (state: AuthState) => void;
  onChallengeChange: (challenge: LivenessChallenge | null) => void;
  onFaceDetected: (face: FaceDetection | null) => void;
  onQualityUpdate: (score: number) => void;
  onSuccess: (name: string, confidence: number) => void;
  onFailed: (reason: string) => void;
}

export const useFaceRecognition = (props: Props) => {
  const [isReady, setIsReady] = useState(false);
  const stateRef = useRef<AuthState>('INITIALIZING');
  const isProcessingRef = useRef(false);
  const passiveScoreRef = useRef(0);
  const activeCompleteRef = useRef(false);
  const frameCountRef = useRef(0);

  const updateState = (newState: AuthState) => {
    stateRef.current = newState;
    props.onStateChange(newState);
  };

  // ─── Initialize engines ───────────────────────────────────────────────────

  useEffect(() => {
    const init = async () => {
      try {
        await FaceEngine.initialize();
        await LivenessEngine.initialize();

        // Load settings from AsyncStorage and apply to engines
        try {
          const rawSettings = await AsyncStorage.getItem('@prahari_settings');
          if (rawSettings) {
            const settings = JSON.parse(rawSettings);
            if (typeof settings.recognitionThreshold === 'number') {
              FaceEngine.setThreshold(settings.recognitionThreshold);
            }
            if (typeof settings.challengeCount === 'number') {
              LivenessEngine.setChallengeCount(settings.challengeCount);
            }
          }
        } catch (settingsErr) {
          console.error('[useFaceRecognition] Settings load failed:', settingsErr);
        }

        // Load enrolled embeddings from encrypted DB
        const embeddings = await DatabaseService.getAllEmbeddings();
        FaceEngine.loadEmbeddings(embeddings);

        setIsReady(true);
        updateState('WAITING_FACE');
      } catch (err) {
        console.error('[useFaceRecognition] Init failed:', err);
        props.onFailed('Failed to initialize. Please restart the app.');
      }
    };
    init();
  }, []);

  // ─── Main frame processor callback ───────────────────────────────────────

  const processFrame = useCallback(async (buffer: ArrayBuffer, width: number, height: number) => {
    if (!isReady || isProcessingRef.current) return;
    if (stateRef.current === 'SUCCESS' || stateRef.current === 'FAILED') return;

    isProcessingRef.current = true;
    frameCountRef.current++;

    try {
      // Convert camera frame buffer to Float32Array RGB
      const uint8 = new Uint8Array(buffer);
      const pixels = new Float32Array(uint8.length);
      for (let i = 0; i < uint8.length; i++) {
        pixels[i] = uint8[i];
      }

      // ── Step 1: Face Detection ──
      const face = await FaceEngine.detectFace(pixels, width, height);

      if (!face) {
        props.onFaceDetected(null);
        if (stateRef.current !== 'WAITING_FACE') {
          updateState('WAITING_FACE');
          LivenessEngine.resetOpticalFlow();
        }
        return;
      }

      props.onFaceDetected(face);

      // ── Step 2: Quality Check ──
      if (stateRef.current === 'WAITING_FACE') {
        updateState('QUALITY_CHECK');
      }

      const quality = FaceEngine.checkFaceQuality(pixels, face, width, height);
      props.onQualityUpdate(quality.score);

      if (!quality.pass) {
        props.onFailed(quality.reason ?? 'Adjust position');
        updateState('WAITING_FACE');
        return;
      }

      // ── Step 3: Passive Liveness (runs continuously in background) ──
      if (stateRef.current === 'QUALITY_CHECK') {
        updateState('LIVENESS_PASSIVE');
      }

      // Run passive every 3rd frame for performance
      if (frameCountRef.current % 3 === 0) {
        passiveScoreRef.current = await LivenessEngine.runPassiveLiveness(
          pixels, face, width, height
        );
      }

      // Spoof detected — halt immediately
      if (passiveScoreRef.current < 0.35) {
        updateState('SPOOF_DETECTED');
        props.onFailed('Spoof attempt detected');
        return;
      }

      // ── Step 4: Active Liveness Challenge ──
      if (stateRef.current === 'LIVENESS_PASSIVE' && passiveScoreRef.current > 0.55) {
        updateState('LIVENESS_ACTIVE');
        // Start randomized challenge sequence
        const challenges = LivenessEngine.startChallenge(Date.now() % 9999);
        props.onChallengeChange(challenges[0]);
      }

      if (stateRef.current === 'LIVENESS_ACTIVE' && !activeCompleteRef.current) {
        const result = await LivenessEngine.checkChallenge(pixels, face, width, height);

        if (result.timedOut) {
          updateState('WAITING_FACE');
          activeCompleteRef.current = false;
          props.onChallengeChange(null);
          return;
        }

        props.onChallengeChange(result.currentChallenge);

        if (result.completed) {
          activeCompleteRef.current = true;
          updateState('RECOGNIZING');
        }
        return; // Keep processing challenges
      }

      // ── Step 5: Face Recognition ──
      if (stateRef.current === 'RECOGNIZING') {
        const result = await FaceEngine.recognizeFace(pixels, face, width);

        if (result.matched && result.userId && result.userName) {
          // Save attendance record
          const record: AttendanceRecord = {
            id: uuid(),
            userId: result.userId,
            userName: result.userName,
            employeeId: result.employeeId ?? '',
            timestamp: Date.now(),
            confidence: result.confidence,
            livenessScore: passiveScoreRef.current,
            synced: false,
            imageHash: await computeImageHash(pixels),
          };

          await DatabaseService.saveAttendance(record);

          updateState('SUCCESS');
          props.onSuccess(result.userName, result.confidence);

          // Reset for next auth after 3 seconds
          setTimeout(() => {
            updateState('WAITING_FACE');
            activeCompleteRef.current = false;
            passiveScoreRef.current = 0;
            props.onChallengeChange(null);
          }, 3000);
        } else {
          updateState('FAILED');
          props.onFailed('Face not recognized');
          // Reset after 2 seconds
          setTimeout(() => {
            updateState('WAITING_FACE');
            activeCompleteRef.current = false;
            passiveScoreRef.current = 0;
          }, 2000);
        }
      }

    } catch (error) {
      console.error('[useFaceRecognition] Frame error:', error);
    } finally {
      isProcessingRef.current = false;
    }
  }, [isReady]);

  // ─── Enrollment trigger ───────────────────────────────────────────────────

  const startEnrollment = useCallback(() => {
    // Navigate to enroll screen — handled by navigation
    props.onStateChange('WAITING_FACE');
  }, []);

  return { isReady, processFrame, startEnrollment };
};

// ─── Utilities ────────────────────────────────────────────────────────────────

async function computeImageHash(pixels: Float32Array): Promise<string> {
  // SHA-256 of raw pixel data — no image stored, only cryptographic hash
  const sample = Array.from(pixels.slice(0, 1000))
    .map(v => Math.round(v).toString(16).padStart(2, '0'))
    .join('');
  return AesCrypto.sha256(sample);
}
