// src/screens/AuthScreen.tsx
// Main authentication screen with live camera feed — Premium UI

import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, Dimensions, TouchableOpacity,
  Animated, StatusBar, ActivityIndicator,
} from 'react-native';
import {
  Camera, useCameraDevice, useCameraPermission,
  runAtTargetFps, useFrameProcessor,
} from 'react-native-vision-camera';
import { Worklets } from 'react-native-worklets-core';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import Svg, { Circle } from 'react-native-svg';
import { FaceOverlay } from '../components/FaceOverlay';
import { LivenessChallenge, StatusBadge } from '../components/LivenessChallenge';
import { PerformanceMonitor } from '../components/PerformanceMonitor';
import { useFaceRecognition } from '../hooks/useFaceRecognition';
import type { FrameResult } from '../hooks/useFaceRecognition';
import { FaceEngine } from '../services/FaceEngine';
import { LivenessEngine } from '../services/LivenessEngine';
import { UI_COLORS } from '../constants';
import {
  wDetectFace, wCheckFaceQuality, wExtractEmbedding, wCropResize,
} from '../utils/faceWorklets';
import type { FaceDetection, LivenessChallenge as ChallengeType } from '../types';


const { width: SCREEN_W } = Dimensions.get('window');
const OVAL_W = SCREEN_W * 0.72;
const OVAL_H = OVAL_W * 1.3;

type AuthState =
  | 'INITIALIZING'
  | 'WAITING_FACE'
  | 'QUALITY_CHECK'
  | 'LIVENESS_PASSIVE'
  | 'LIVENESS_ACTIVE'
  | 'RECOGNIZING'
  | 'SUCCESS'
  | 'FAILED'
  | 'SPOOF_DETECTED';

export const AuthScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const nav = useNavigation();
  const { hasPermission, requestPermission } = useCameraPermission();

  const [authState, setAuthState] = useState<AuthState>('INITIALIZING');
  const [currentChallenge, setCurrentChallenge] = useState<ChallengeType | null>(null);
  const [detectedFace, setDetectedFace] = useState<FaceDetection | null>(null);
  const [resultName, setResultName] = useState('');
  const [resultConfidence, setResultConfidence] = useState(0);
  const [statusMessage, setStatusMessage] = useState('Initializing...');
  const [qualityScore, setQualityScore] = useState(0);
  const [showPerf, setShowPerf] = useState(false);
  const [isCameraLoaded, setIsCameraLoaded] = useState(false);


  const pulseAnim = useRef(new Animated.Value(1)).current;
  const successAnim = useRef(new Animated.Value(0)).current;
  const statusFade = useRef(new Animated.Value(1)).current;
  const scanLineAnim = useRef(new Animated.Value(0)).current;

  const {
    isReady,
    modelsLoaded,
    handleFrameResult,
  } = useFaceRecognition({
    onStateChange: setAuthState,
    onChallengeChange: setCurrentChallenge,
    onFaceDetected: setDetectedFace,
    onQualityUpdate: setQualityScore,
    onSuccess: (name, confidence) => {
      setResultName(name);
      setResultConfidence(confidence);
      animateSuccess();
    },
    onFailed: (reason) => {
      setStatusMessage(reason);
    },
  });

  // ─── Animations ───────────────────────────────────────────────────────────

  useEffect(() => {
    if (authState === 'WAITING_FACE') {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.04, duration: 900, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 900, useNativeDriver: true }),
        ])
      ).start();
      // Scan line animation
      Animated.loop(
        Animated.timing(scanLineAnim, {
          toValue: 1, duration: 2500, useNativeDriver: true,
        })
      ).start();
    } else {
      pulseAnim.stopAnimation();
      pulseAnim.setValue(1);
      scanLineAnim.stopAnimation();
    }
  }, [authState]);

  // Fade status text on state change
  useEffect(() => {
    Animated.sequence([
      Animated.timing(statusFade, { toValue: 0, duration: 100, useNativeDriver: true }),
      Animated.timing(statusFade, { toValue: 1, duration: 300, useNativeDriver: true }),
    ]).start();
  }, [authState]);

  const animateSuccess = () => {
    successAnim.setValue(0);
    Animated.spring(successAnim, {
      toValue: 1, tension: 60, friction: 8, useNativeDriver: true,
    }).start();
  };

  // ─── Permissions ──────────────────────────────────────────────────────────

  useEffect(() => {
    if (!hasPermission) requestPermission();
  }, []);

  // ─── Frame Processor (sync worklet — no ArrayBuffer crosses to JS) ──────

  const handleFrameResultOnJS = useMemo(() => Worklets.createRunOnJS(handleFrameResult), [handleFrameResult]);

  // Get model references (JSI host objects — safe in worklet closure)
  const detModel = modelsLoaded ? FaceEngine.detectionModel : null;
  const recModel = modelsLoaded ? FaceEngine.recognitionModel : null;
  const spoofModel = modelsLoaded ? LivenessEngine.antiSpoofModel : null;
  const meshModel = modelsLoaded ? LivenessEngine.faceMeshModel : null;
  const activeLivenessFlag = LivenessEngine.activeLivenessActive;

  const frameProcessor = useFrameProcessor((frame) => {
    'worklet';
    if (!detModel || !recModel) return;
    runAtTargetFps(3, () => {
      'worklet';
      try {
        const width = frame.width;
        const height = frame.height;
        const buffer = frame.toArrayBuffer();
        const pixels = new Float32Array(new Uint8Array(buffer));

        // Face detection (sync in worklet)
        const face = wDetectFace(pixels, width, height, detModel);
        if (!face) {
          handleFrameResultOnJS({
            hasFace: false, face: null,
            qualityScore: 0, qualityPass: false, qualityReason: null,
            passiveScore: 0, embedding: null,
            challengeCompleted: false, challengeTimedOut: false, currentChallenge: null,
          });
          return;
        }

        // Quality check (sync in worklet)
        const quality = wCheckFaceQuality(pixels, face, width, height);

        // Passive liveness — run anti-spoof model in worklet
        let passiveScore = 0;
        if (spoofModel && quality.pass) {
          try {
            const pad = 0.1;
            const cropX = Math.max(0, Math.min(width, Math.floor(face.x - face.width * pad)));
            const cropY = Math.max(0, Math.min(height, Math.floor(face.y - face.height * pad)));
            const cropW = Math.max(0, Math.min(width - cropX, face.width * (1 + 2 * pad)));
            const cropH = Math.max(0, Math.min(height - cropY, face.height * (1 + 2 * pad)));
            const cropped = wCropResize(pixels, cropX, cropY, cropW, cropH, width, 80);
            const normalized = new Float32Array(80 * 80 * 3);
            for (let i = 0; i < normalized.length; i++) normalized[i] = cropped[i] / 255.0;
            const spoofOut = spoofModel.runSync([normalized]);
            passiveScore = (spoofOut[0] as Float32Array)[0];
          } catch (_e) {
            passiveScore = 0.5; // default on error
          }
        }

        // Active liveness challenge checking (sync in worklet)
        let challengeCompleted = false;
        let challengeTimedOut = false;
        let currentChallenge: string | null = null;

        if (activeLivenessFlag.value && meshModel) {
          try {
            const challengeResult = LivenessEngine.checkChallengeSync(
              pixels, face, width, height, meshModel
            );
            challengeCompleted = challengeResult.completed;
            challengeTimedOut = challengeResult.timedOut;
            currentChallenge = challengeResult.currentChallenge;
          } catch (_e) {
            // Continue without challenge check on error
          }
        }

        // Extract embedding (sync in worklet)
        let embedding: number[] | null = null;
        if (quality.pass) {
          embedding = wExtractEmbedding(pixels, face, width, recModel);
        }

        // Only serializable primitives/plain objects cross to JS
        handleFrameResultOnJS({
          hasFace: true,
          face: {
            x: face.x, y: face.y,
            width: face.width, height: face.height,
            confidence: face.confidence,
          },
          qualityScore: quality.score,
          qualityPass: quality.pass,
          qualityReason: quality.reason ?? null,
          passiveScore,
          embedding,
          challengeCompleted,
          challengeTimedOut,
          currentChallenge,
        });
      } catch (_e) {
        // Silently continue — don't crash app
      }
    });
  }, [detModel, recModel, spoofModel, meshModel, activeLivenessFlag, handleFrameResultOnJS]);

  // ─── Status Messages ──────────────────────────────────────────────────────

  const getStatusMessage = (): string => {
    switch (authState) {
      case 'INITIALIZING': return 'Loading AI models...';
      case 'WAITING_FACE': return 'Position your face in the oval';
      case 'QUALITY_CHECK': return 'Analyzing quality...';
      case 'LIVENESS_PASSIVE': return 'Verifying liveness...';
      case 'LIVENESS_ACTIVE': return currentChallenge ? challengeText(currentChallenge) : 'Follow the prompt';
      case 'RECOGNIZING': return 'Identifying...';
      case 'SUCCESS': return `Welcome, ${resultName}`;
      case 'FAILED': return statusMessage || 'Not recognized. Try again.';
      case 'SPOOF_DETECTED': return 'Spoof attempt detected';
      default: return '';
    }
  };

  const getStatusIcon = (): string => {
    switch (authState) {
      case 'INITIALIZING': return '⏳';
      case 'WAITING_FACE': return '👤';
      case 'QUALITY_CHECK': return '📐';
      case 'LIVENESS_PASSIVE': return '🔍';
      case 'LIVENESS_ACTIVE': return '🎯';
      case 'RECOGNIZING': return '🧠';
      case 'SUCCESS': return '✅';
      case 'FAILED': return '❌';
      case 'SPOOF_DETECTED': return '⚠️';
      default: return '';
    }
  };

  const challengeText = (c: ChallengeType): string => {
    const map: Record<ChallengeType, string> = {
      BLINK: '😉 Please blink',
      SMILE: '😁 Please smile',
      TURN_LEFT: '← Turn left',
      TURN_RIGHT: 'Turn right →',
      NOD: '↕ Nod your head',
    };
    return map[c];
  };

  const getOvalColor = (): string => {
    switch (authState) {
      case 'SUCCESS': return UI_COLORS.SUCCESS;
      case 'FAILED':
      case 'SPOOF_DETECTED': return UI_COLORS.ERROR;
      case 'LIVENESS_ACTIVE': return UI_COLORS.WARNING;
      case 'RECOGNIZING': return UI_COLORS.CYAN;
      default: return detectedFace ? '#FFFFFF' : 'rgba(255,255,255,0.4)';
    }
  };

  if (!hasPermission) {
    return (
      <View style={styles.centerContainer}>
        <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />
        <View style={styles.permissionCard}>
          <Text style={styles.permissionIcon}>📸</Text>
          <Text style={styles.permissionTitle}>Camera Access Required</Text>
          <Text style={styles.permissionText}>PRAHARI needs camera access for face authentication</Text>
          <TouchableOpacity style={styles.permissionButton} onPress={requestPermission}>
            <Text style={styles.permissionButtonText}>Grant Permission</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

      {/* Camera Feed */}
      <CameraFeed
        isActive={authState === 'INITIALIZING' || authState === 'WAITING_FACE' || authState === 'QUALITY_CHECK' || authState === 'LIVENESS_PASSIVE' || authState === 'LIVENESS_ACTIVE' || authState === 'RECOGNIZING'}
        frameProcessor={frameProcessor}
        onCameraLoaded={setIsCameraLoaded}
      />

      {/* Render overlays and controls only when camera is loaded */}
      {isCameraLoaded && (
        <>
          {/* Dark overlay with oval cutout */}
          <FaceOverlay
            ovalWidth={OVAL_W}
            ovalHeight={OVAL_H}
            strokeColor={getOvalColor()}
            isAnimating={authState === 'WAITING_FACE'}
            pulseAnim={pulseAnim}
            quality={qualityScore}
          />

          {/* Live Performance Monitor */}
          <PerformanceMonitor visible={showPerf} />

          {/* Liveness challenge indicator */}
          {authState === 'LIVENESS_ACTIVE' && currentChallenge && (
            <LivenessChallenge challenge={currentChallenge} />
          )}

          {/* Auth pipeline stage indicator */}
          <View style={styles.stageIndicator}>
            {['👤', '📐', '🔍', '🎯', '🧠'].map((icon, i) => {
              const stages: AuthState[] = ['WAITING_FACE', 'QUALITY_CHECK', 'LIVENESS_PASSIVE', 'LIVENESS_ACTIVE', 'RECOGNIZING'];
              const currentIdx = stages.indexOf(authState);
              const isActive = i === currentIdx;
              const isDone = i < currentIdx;
              return (
                <View key={i} style={styles.stageRow}>
                  <View style={[
                    styles.stageDot,
                    isDone && styles.stageDotDone,
                    isActive && styles.stageDotActive,
                  ]}>
                    <Text style={styles.stageIcon}>
                      {isDone ? '✓' : icon}
                    </Text>
                  </View>
                  {i < 4 && (
                    <View style={[
                      styles.stageLine,
                      isDone && styles.stageLineDone,
                    ]} />
                  )}
                </View>
              );
            })}
          </View>

          {/* Status message */}
          <View style={styles.statusContainer}>
            <Animated.View style={[styles.statusPill, { opacity: statusFade }]}>
              <Text style={styles.statusIcon}>{getStatusIcon()}</Text>
              <Text style={[
                styles.statusText,
                authState === 'SUCCESS' && styles.successText,
                authState === 'FAILED' && styles.failedText,
                authState === 'SPOOF_DETECTED' && styles.spoofText,
              ]}>
                {getStatusMessage()}
              </Text>
            </Animated.View>

            {authState === 'SUCCESS' && (
              <Animated.View style={[styles.successCard, { transform: [{ scale: successAnim }] }]}>
                <View style={styles.successBadge}>
                  <Text style={styles.successBadgeText}>VERIFIED</Text>
                </View>
                <Text style={styles.successName}>{resultName}</Text>
                <View style={styles.successConfRow}>
                  <View style={styles.successConfBar}>
                    <View style={[styles.successConfFill, { width: `${Math.round(resultConfidence * 100)}%` }]} />
                  </View>
                  <Text style={styles.successConf}>
                    {Math.round(resultConfidence * 100)}%
                  </Text>
                </View>
                <Text style={styles.successTimestamp}>
                  {new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                </Text>
              </Animated.View>
            )}

            {(authState === 'FAILED' || authState === 'SPOOF_DETECTED') && (
              <TouchableOpacity
                style={[styles.retryButton, authState === 'SPOOF_DETECTED' && styles.spoofRetryButton]}
                onPress={() => setAuthState('WAITING_FACE')}
              >
                <Text style={styles.retryText}>↻ Try Again</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Bottom controls */}
          <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 16 }]}>
            <View style={styles.bottomInfo}>
              <View style={styles.bottomInfoDot} />
              <Text style={styles.bottomInfoText}>100% Offline • AES-256 Encrypted</Text>
            </View>
          </View>
        </>
      )}

      {/* Top bar (Always render for back navigation) */}
      <View style={[styles.topBar, { paddingTop: insets.top + 12 }]}>
        <View style={styles.topLeft}>
          <TouchableOpacity onPress={() => nav.goBack()} style={styles.backBtn} activeOpacity={0.7}>
            <Text style={styles.backBtnText}>‹</Text>
          </TouchableOpacity>
          <Text style={styles.appTitle}>PRAHARI</Text>
          <View style={styles.aiPill}>
            <Text style={styles.aiPillText}>EDGE AI</Text>
          </View>
        </View>
        <View style={styles.topRight}>
          <TouchableOpacity
            style={styles.perfToggle}
            onPress={() => setShowPerf(!showPerf)}
          >
            <Text style={styles.perfToggleText}>⚡</Text>
          </TouchableOpacity>
          <StatusBadge isOnline={false} pendingCount={0} />
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: UI_COLORS.BACKGROUND },
  centerContainer: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    backgroundColor: UI_COLORS.BACKGROUND, padding: 32,
  },
  // ─── Top Bar ──────────────────────────────────────────────────────────────
  topBar: {
    position: 'absolute', top: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', paddingHorizontal: 20,
    zIndex: 10,
  },
  topLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  topRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  appTitle: {
    fontSize: 18, fontWeight: '900', color: '#FFFFFF',
    letterSpacing: 5,
  },
  aiPill: {
    backgroundColor: UI_COLORS.ACCENT_LIGHT,
    borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3,
    borderWidth: 1, borderColor: UI_COLORS.BORDER_ACCENT,
  },
  aiPillText: {
    color: UI_COLORS.ACCENT, fontSize: 8, fontWeight: '900',
    letterSpacing: 1.5,
  },
  perfToggle: {
    width: 32, height: 32, borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
  },
  perfToggleText: { fontSize: 14 },

  // ─── Stage Indicator ──────────────────────────────────────────────────────
  stageIndicator: {
    position: 'absolute', right: 16,
    top: '30%',
    flexDirection: 'column', alignItems: 'center',
    zIndex: 10,
  },
  stageRow: { alignItems: 'center' },
  stageDot: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center', justifyContent: 'center',
  },
  stageDotDone: {
    backgroundColor: 'rgba(0,214,143,0.2)',
    borderColor: UI_COLORS.SUCCESS,
  },
  stageDotActive: {
    backgroundColor: 'rgba(233,69,96,0.2)',
    borderColor: UI_COLORS.ACCENT,
  },
  stageIcon: { fontSize: 11 },
  stageLine: {
    width: 2, height: 12,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  stageLineDone: {
    backgroundColor: 'rgba(0,214,143,0.4)',
  },

  // ─── Status ───────────────────────────────────────────────────────────────
  statusContainer: {
    position: 'absolute',
    bottom: 120, left: 0, right: 0,
    alignItems: 'center', paddingHorizontal: 24,
  },
  statusPill: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(0,0,0,0.65)',
    borderRadius: 24, paddingHorizontal: 20, paddingVertical: 10,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
  },
  statusIcon: { fontSize: 16 },
  statusText: {
    fontSize: 15, color: '#FFFFFF',
    fontWeight: '600', letterSpacing: 0.3,
  },
  successText: { color: UI_COLORS.SUCCESS },
  failedText: { color: UI_COLORS.ERROR },
  spoofText: { color: UI_COLORS.WARNING },

  // ─── Success Card ─────────────────────────────────────────────────────────
  successCard: {
    marginTop: 16, alignItems: 'center',
    backgroundColor: 'rgba(0,214,143,0.08)',
    borderRadius: 20, paddingHorizontal: 36, paddingVertical: 20,
    borderWidth: 1, borderColor: 'rgba(0,214,143,0.3)',
    minWidth: 220,
  },
  successBadge: {
    backgroundColor: UI_COLORS.SUCCESS,
    borderRadius: 6, paddingHorizontal: 12, paddingVertical: 3,
    marginBottom: 10,
  },
  successBadgeText: {
    color: '#FFFFFF', fontSize: 10, fontWeight: '900',
    letterSpacing: 2,
  },
  successName: { fontSize: 22, fontWeight: '800', color: '#FFFFFF' },
  successConfRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    marginTop: 10, width: '100%',
  },
  successConfBar: {
    flex: 1, height: 4, borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  successConfFill: {
    height: '100%', borderRadius: 2,
    backgroundColor: UI_COLORS.SUCCESS,
  },
  successConf: { fontSize: 14, color: UI_COLORS.SUCCESS, fontWeight: '800' },
  successTimestamp: {
    fontSize: 11, color: 'rgba(255,255,255,0.4)',
    marginTop: 8, letterSpacing: 0.5,
  },

  // ─── Retry ────────────────────────────────────────────────────────────────
  retryButton: {
    marginTop: 16, backgroundColor: UI_COLORS.ACCENT,
    paddingHorizontal: 32, paddingVertical: 12, borderRadius: 24,
  },
  spoofRetryButton: {
    backgroundColor: UI_COLORS.WARNING,
  },
  retryText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },

  // ─── Bottom Bar ───────────────────────────────────────────────────────────
  bottomBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    alignItems: 'center', paddingHorizontal: 24,
  },
  bottomInfo: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
  },
  bottomInfoDot: {
    width: 5, height: 5, borderRadius: 3,
    backgroundColor: UI_COLORS.SUCCESS,
  },
  bottomInfoText: {
    color: 'rgba(255,255,255,0.25)', fontSize: 11,
    letterSpacing: 0.3,
  },

  // ─── Permission Screen ────────────────────────────────────────────────────
  permissionCard: {
    alignItems: 'center',
    backgroundColor: UI_COLORS.SURFACE,
    borderRadius: 24, padding: 40,
    borderWidth: 1, borderColor: UI_COLORS.BORDER,
  },
  permissionIcon: { fontSize: 48, marginBottom: 16 },
  permissionTitle: {
    color: '#FFFFFF', fontSize: 20, fontWeight: '800',
    marginBottom: 8,
  },
  permissionText: {
    color: UI_COLORS.TEXT_SECONDARY, fontSize: 14,
    textAlign: 'center', marginBottom: 24, lineHeight: 20,
  },
  permissionButton: {
    backgroundColor: UI_COLORS.ACCENT,
    paddingHorizontal: 32, paddingVertical: 14, borderRadius: 16,
  },
  permissionButtonText: { color: '#FFFFFF', fontWeight: '700', fontSize: 15 },
  backBtn: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    marginRight: 4,
  },
  backBtnText: {
    color: '#FFF',
    fontSize: 20,
    fontWeight: 'bold',
    marginTop: -2,
  },
});

const CameraFeed: React.FC<{
  isActive: boolean;
  frameProcessor: any;
  onCameraLoaded: (loaded: boolean) => void;
}> = ({ isActive, frameProcessor, onCameraLoaded }) => {
  const device = useCameraDevice('front');
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    if (!device) {
      onCameraLoaded(false);
      const timer = setTimeout(() => setTimedOut(true), 5000);
      return () => clearTimeout(timer);
    } else {
      setTimedOut(false);
      onCameraLoaded(true);
    }
  }, [device, onCameraLoaded]);

  if (!device) {
    return (
      <View style={styles.centerContainer}>
        {timedOut ? (
          <>
            <Text style={{ fontSize: 48, marginBottom: 16 }}>📷</Text>
            <Text style={{ color: UI_COLORS.TEXT_PRIMARY, fontSize: 16, fontWeight: '700' }}>No front camera found</Text>
            <Text style={{ color: UI_COLORS.TEXT_SECONDARY, fontSize: 13, marginTop: 6, textAlign: 'center' }}>Please check your camera settings and try again.</Text>
          </>
        ) : (
          <>
            <ActivityIndicator color={UI_COLORS.ACCENT} size="large" />
            <Text style={{ color: UI_COLORS.TEXT_SECONDARY, marginTop: 12 }}>Initializing camera...</Text>
          </>
        )}
      </View>
    );
  }

  return (
    <Camera
      style={StyleSheet.absoluteFill}
      device={device}
      isActive={isActive}
      frameProcessor={frameProcessor}
      photo={false}
      video={true}
      audio={false}
      pixelFormat="rgb"
    />
  );
};

