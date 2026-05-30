// src/screens/AuthScreen.tsx
// Main authentication screen with live camera feed

import React, { useRef, useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, Dimensions, TouchableOpacity,
  Animated, StatusBar,
} from 'react-native';
import {
  Camera, useCameraDevice, useCameraPermission,
  useFrameProcessor,
} from 'react-native-vision-camera';
import { useSharedValue, runOnJS } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';
import { FaceOverlay } from '../components/FaceOverlay';
import { LivenessChallenge, StatusBadge } from '../components/LivenessChallenge';
import { useFaceRecognition } from '../hooks/useFaceRecognition';
import { UI_COLORS } from '../constants';
import type { FaceDetection, LivenessChallenge as ChallengeType } from '../types';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
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
  const device = useCameraDevice('front');
  const { hasPermission, requestPermission } = useCameraPermission();

  const [authState, setAuthState] = useState<AuthState>('INITIALIZING');
  const [currentChallenge, setCurrentChallenge] = useState<ChallengeType | null>(null);
  const [detectedFace, setDetectedFace] = useState<FaceDetection | null>(null);
  const [resultName, setResultName] = useState('');
  const [resultConfidence, setResultConfidence] = useState(0);
  const [statusMessage, setStatusMessage] = useState('Initializing...');
  const [qualityScore, setQualityScore] = useState(0);

  const pulseAnim = useRef(new Animated.Value(1)).current;
  const successAnim = useRef(new Animated.Value(0)).current;

  const {
    isReady,
    processFrame,
    startEnrollment,
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
    } else {
      pulseAnim.stopAnimation();
      pulseAnim.setValue(1);
    }
  }, [authState]);

  const animateSuccess = () => {
    Animated.spring(successAnim, {
      toValue: 1, tension: 60, friction: 8, useNativeDriver: true,
    }).start();
  };

  // ─── Permissions ──────────────────────────────────────────────────────────

  useEffect(() => {
    if (!hasPermission) requestPermission();
  }, []);

  // ─── Frame Processor ──────────────────────────────────────────────────────
  // Runs on camera frame thread — calls JS via runOnJS

  const frameProcessor = useFrameProcessor((frame) => {
    'worklet';
    if (!isReady) return;
    const width = frame.width;
    const height = frame.height;
    const buffer = frame.toArrayBuffer();
    runOnJS(processFrame)(buffer, width, height);
  }, [isReady, processFrame]);

  // ─── Status Messages ──────────────────────────────────────────────────────

  const getStatusMessage = (): string => {
    switch (authState) {
      case 'INITIALIZING': return 'Loading AI models...';
      case 'WAITING_FACE': return 'Position your face in the oval';
      case 'QUALITY_CHECK': return 'Hold still...';
      case 'LIVENESS_PASSIVE': return 'Verifying...';
      case 'LIVENESS_ACTIVE': return currentChallenge ? challengeText(currentChallenge) : 'Follow the prompt';
      case 'RECOGNIZING': return 'Identifying...';
      case 'SUCCESS': return `Welcome, ${resultName}`;
      case 'FAILED': return 'Not recognized. Try again.';
      case 'SPOOF_DETECTED': return '⚠️ Spoof attempt detected';
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
      case 'RECOGNIZING': return '#4FC3F7';
      default: return detectedFace ? '#FFFFFF' : 'rgba(255,255,255,0.4)';
    }
  };

  if (!hasPermission) {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.permissionText}>Camera permission required</Text>
        <TouchableOpacity style={styles.button} onPress={requestPermission}>
          <Text style={styles.buttonText}>Grant Permission</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!device) {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.permissionText}>No front camera found</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

      {/* Camera Feed */}
      <Camera
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={true}
        frameProcessor={frameProcessor}
        photo={false}
        video={false}
        audio={false}
        pixelFormat="rgb"
      />

      {/* Dark overlay with oval cutout */}
      <FaceOverlay
        ovalWidth={OVAL_W}
        ovalHeight={OVAL_H}
        strokeColor={getOvalColor()}
        isAnimating={authState === 'WAITING_FACE'}
        pulseAnim={pulseAnim}
        quality={qualityScore}
      />

      {/* Top bar */}
      <View style={[styles.topBar, { paddingTop: insets.top + 12 }]}>
        <Text style={styles.appTitle}>PRAHARI</Text>
        <StatusBadge isOnline={false} pendingCount={0} />
      </View>

      {/* Liveness challenge indicator */}
      {authState === 'LIVENESS_ACTIVE' && currentChallenge && (
        <LivenessChallenge challenge={currentChallenge} />
      )}

      {/* Status message */}
      <View style={styles.statusContainer}>
        <Text style={[styles.statusText, authState === 'SUCCESS' && styles.successText]}>
          {getStatusMessage()}
        </Text>

        {authState === 'SUCCESS' && (
          <Animated.View style={[styles.successCard, { transform: [{ scale: successAnim }] }]}>
            <Text style={styles.successEmoji}>✅</Text>
            <Text style={styles.successName}>{resultName}</Text>
            <Text style={styles.successConf}>
              {Math.round(resultConfidence * 100)}% match
            </Text>
          </Animated.View>
        )}

        {(authState === 'FAILED' || authState === 'SPOOF_DETECTED') && (
          <TouchableOpacity
            style={styles.retryButton}
            onPress={() => setAuthState('WAITING_FACE')}
          >
            <Text style={styles.retryText}>Try Again</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Bottom controls */}
      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 16 }]}>
        <TouchableOpacity style={styles.enrollButton} onPress={startEnrollment}>
          <Text style={styles.enrollText}>+ Enroll New User</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: UI_COLORS.BACKGROUND },
  centerContainer: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    backgroundColor: UI_COLORS.BACKGROUND,
  },
  topBar: {
    position: 'absolute', top: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', paddingHorizontal: 20,
    zIndex: 10,
  },
  appTitle: {
    fontSize: 20, fontWeight: '800', color: '#FFFFFF',
    letterSpacing: 6,
  },
  statusContainer: {
    position: 'absolute',
    bottom: 140, left: 0, right: 0,
    alignItems: 'center', paddingHorizontal: 24,
  },
  statusText: {
    fontSize: 17, color: '#FFFFFF', textAlign: 'center',
    fontWeight: '600', letterSpacing: 0.3,
  },
  successText: { color: UI_COLORS.SUCCESS, fontSize: 20 },
  successCard: {
    marginTop: 16, alignItems: 'center',
    backgroundColor: 'rgba(0,200,151,0.15)',
    borderRadius: 16, paddingHorizontal: 32, paddingVertical: 16,
    borderWidth: 1, borderColor: UI_COLORS.SUCCESS,
  },
  successEmoji: { fontSize: 36 },
  successName: { fontSize: 22, fontWeight: '700', color: '#FFFFFF', marginTop: 4 },
  successConf: { fontSize: 14, color: UI_COLORS.SUCCESS, marginTop: 2 },
  retryButton: {
    marginTop: 16, backgroundColor: UI_COLORS.ACCENT,
    paddingHorizontal: 32, paddingVertical: 12, borderRadius: 24,
  },
  retryText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  bottomBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    alignItems: 'center', paddingHorizontal: 24,
  },
  enrollButton: {
    borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.3)',
    paddingHorizontal: 28, paddingVertical: 12, borderRadius: 24,
  },
  enrollText: { color: 'rgba(255,255,255,0.8)', fontSize: 15, fontWeight: '600' },
  permissionText: { color: '#FFFFFF', fontSize: 16, marginBottom: 20 },
  button: {
    backgroundColor: UI_COLORS.ACCENT,
    paddingHorizontal: 24, paddingVertical: 12, borderRadius: 20,
  },
  buttonText: { color: '#FFFFFF', fontWeight: '700' },
});
