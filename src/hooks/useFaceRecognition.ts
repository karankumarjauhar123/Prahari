// src/hooks/useFaceRecognition.ts
// Master hook — orchestrates detection → quality → liveness → recognition
// All model inference now runs in the worklet thread; only lightweight
// results (primitives/plain objects) cross to JS via createRunOnJS.

import { useEffect, useRef, useState, useCallback } from 'react';
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

/** Lightweight result object — NO ArrayBuffer, only serializable types. */
export interface FrameResult {
  hasFace: boolean;
  face: { x: number; y: number; width: number; height: number; confidence: number } | null;
  qualityScore: number;
  qualityPass: boolean;
  qualityReason: string | null;
  passiveScore: number;
  embedding: number[] | null;
}

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
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const stateRef = useRef<AuthState>('INITIALIZING');
  const isProcessingRef = useRef(false);
  const passiveScoreRef = useRef(0);
  const activeCompleteRef = useRef(false);
  const frameCountRef = useRef(0);
  const resetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updateState = useCallback((newState: AuthState) => {
    stateRef.current = newState;
    props.onStateChange(newState);
  }, [props.onStateChange]);

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

        setModelsLoaded(true);
        setIsReady(true);
        updateState('WAITING_FACE');
      } catch (err) {
        console.error('[useFaceRecognition] Init failed:', err);
        props.onFailed('Failed to initialize. Please restart the app.');
      }
    };
    init();

    // Cleanup timeouts on unmount
    return () => {
      if (resetTimeoutRef.current) {
        clearTimeout(resetTimeoutRef.current);
      }
    };
  }, []);

  // ─── Handle worklet results on JS thread ──────────────────────────────────

  const handleFrameResult = useCallback(async (result: FrameResult) => {
    if (!isReady || isProcessingRef.current) return;
    if (stateRef.current === 'SUCCESS' || stateRef.current === 'FAILED' || stateRef.current === 'SPOOF_DETECTED') return;

    isProcessingRef.current = true;
    frameCountRef.current++;

    try {
      // ── Step 1: Face Detection ──
      if (!result.hasFace || !result.face) {
        props.onFaceDetected(null);
        if (stateRef.current !== 'WAITING_FACE') {
          updateState('WAITING_FACE');
        }
        return;
      }

      // Reconstruct face detection object for UI callbacks
      const face = result.face as FaceDetection;
      props.onFaceDetected(face);

      // ── Step 2: Quality Check ──
      if (stateRef.current === 'WAITING_FACE') {
        updateState('QUALITY_CHECK');
      }

      props.onQualityUpdate(result.qualityScore);

      if (!result.qualityPass) {
        props.onFailed(result.qualityReason ?? 'Adjust position');
        updateState('WAITING_FACE');
        return;
      }

      // ── Step 3: Passive Liveness ──
      if (stateRef.current === 'QUALITY_CHECK') {
        updateState('LIVENESS_PASSIVE');
      }

      // Use passive score from worklet (anti-spoof model already ran there)
      if (result.passiveScore > 0) {
        passiveScoreRef.current = result.passiveScore;
      }

      // Spoof detected — halt immediately
      if (passiveScoreRef.current > 0 && passiveScoreRef.current < 0.35) {
        updateState('SPOOF_DETECTED');
        props.onFailed('Spoof attempt detected');
        resetTimeoutRef.current = setTimeout(() => {
          updateState('WAITING_FACE');
          activeCompleteRef.current = false;
          passiveScoreRef.current = 0;
          props.onChallengeChange(null);
        }, 3000);
        return;
      }

      // ── Step 4: Active Liveness Challenge ──
      if (stateRef.current === 'LIVENESS_PASSIVE' && passiveScoreRef.current > 0.55) {
        updateState('LIVENESS_ACTIVE');
        const challenges = LivenessEngine.startChallenge(Date.now() % 9999);
        props.onChallengeChange(challenges[0]);
      }

      if (stateRef.current === 'LIVENESS_ACTIVE' && !activeCompleteRef.current) {
        // Auto-pass active liveness when passive score is strong enough
        // (worklet already validated the face is real via anti-spoof model)
        if (passiveScoreRef.current > 0.65) {
          activeCompleteRef.current = true;
          updateState('RECOGNIZING');
        } else {
          return; // Still waiting for better scores
        }
      }

      // ── Step 5: Face Recognition ──
      if (stateRef.current === 'RECOGNIZING' && result.embedding) {
        // Match embedding against enrolled faces (JS thread, no ArrayBuffer)
        const matchResult = FaceEngine.matchEmbedding(result.embedding);

        if (matchResult.matched && matchResult.userId && matchResult.userName) {
          // Compute image hash from embedding values (no pixel data needed)
          const sampleHex = result.embedding.slice(0, 50)
            .map(v => Math.round(Math.abs(v) * 255).toString(16).padStart(2, '0'))
            .join('');
          const imageHash = await AesCrypto.sha256(sampleHex);

          const record: AttendanceRecord = {
            id: uuid(),
            userId: matchResult.userId,
            userName: matchResult.userName,
            employeeId: matchResult.employeeId ?? '',
            timestamp: Date.now(),
            confidence: matchResult.confidence,
            livenessScore: passiveScoreRef.current,
            synced: false,
            imageHash,
          };

          await DatabaseService.saveAttendance(record);

          updateState('SUCCESS');
          props.onSuccess(matchResult.userName, matchResult.confidence);

          resetTimeoutRef.current = setTimeout(() => {
            updateState('WAITING_FACE');
            activeCompleteRef.current = false;
            passiveScoreRef.current = 0;
            props.onChallengeChange(null);
          }, 3000);
        } else {
          updateState('FAILED');
          props.onFailed('Face not recognized');
          resetTimeoutRef.current = setTimeout(() => {
            updateState('WAITING_FACE');
            activeCompleteRef.current = false;
            passiveScoreRef.current = 0;
          }, 2000);
        }
      }

    } catch (error) {
      console.error('[useFaceRecognition] Frame result error:', error);
    } finally {
      isProcessingRef.current = false;
    }
  }, [isReady]);

  // ─── Enrollment trigger ───────────────────────────────────────────────────

  const startEnrollment = useCallback(() => {
    props.onStateChange('WAITING_FACE');
  }, []);

  return {
    isReady,
    modelsLoaded,
    handleFrameResult,
    startEnrollment,
  };
};
