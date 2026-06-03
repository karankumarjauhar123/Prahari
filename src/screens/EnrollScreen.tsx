// src/screens/EnrollScreen.tsx
// Enroll a new field personnel — capture 5 frames, average embeddings

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  View, Text, TextInput, StyleSheet, TouchableOpacity,
  Alert, ScrollView, ActivityIndicator, StatusBar,
  Animated, Easing, Vibration, Dimensions,
} from 'react-native';
import {
  Camera, runAtTargetFps, useCameraDevice, useFrameProcessor, useCameraPermission,
} from 'react-native-vision-camera';
import { Worklets } from 'react-native-worklets-core';
import { useNavigation } from '@react-navigation/native';
import DeviceInfo from 'react-native-device-info';
import { v4 as uuid } from 'uuid';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path, Rect, Defs, Mask } from 'react-native-svg';
import { FaceEngine } from '../services/FaceEngine';
import { DatabaseService } from '../services/DatabaseService';
import { UI_COLORS, MODEL_CONFIG, QUALITY_CONFIG } from '../constants';
import {
  wDetectFace, wCheckFaceQuality, wExtractEmbedding, wExtractROI, wLaplacianVariance,
} from '../utils/faceWorklets';
import type { FaceEmbedding } from '../types';

const CAPTURE_COUNT = 5; // Capture 5 embeddings and average for robustness
// ─── Step Progress Indicator ────────────────────────────────────────────────
const STEPS = ['Form', 'Capture', 'Done'] as const;

const StepIndicator: React.FC<{ currentStep: number }> = ({ currentStep }) => {
  return (
    <View style={stepStyles.container}>
      {STEPS.map((label, i) => {
        const isActive = i === currentStep;
        const isDone = i < currentStep;
        return (
          <React.Fragment key={label}>
            {i > 0 && (
              <View style={[stepStyles.connector, isDone && stepStyles.connectorDone]} />
            )}
            <View style={stepStyles.stepItem}>
              <View
                style={[
                  stepStyles.circle,
                  isActive && stepStyles.circleActive,
                  isDone && stepStyles.circleDone,
                ]}
              >
                {isDone ? (
                  <Text style={stepStyles.checkmark}>✓</Text>
                ) : (
                  <Text
                    style={[
                      stepStyles.stepNumber,
                      (isActive || isDone) && stepStyles.stepNumberActive,
                    ]}
                  >
                    {i + 1}
                  </Text>
                )}
              </View>
              <Text
                style={[
                  stepStyles.stepLabel,
                  isActive && stepStyles.stepLabelActive,
                  isDone && stepStyles.stepLabelDone,
                ]}
              >
                {label}
              </Text>
            </View>
          </React.Fragment>
        );
      })}
    </View>
  );
};

const stepStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 28,
    paddingHorizontal: 16,
  },
  stepItem: { alignItems: 'center' },
  circle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: UI_COLORS.SURFACE,
    borderWidth: 1.5,
    borderColor: UI_COLORS.BORDER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  circleActive: {
    borderColor: UI_COLORS.ACCENT,
    backgroundColor: UI_COLORS.ACCENT_LIGHT,
  },
  circleDone: {
    borderColor: UI_COLORS.SUCCESS,
    backgroundColor: UI_COLORS.SUCCESS,
  },
  connector: {
    height: 2,
    width: 40,
    backgroundColor: UI_COLORS.BORDER,
    marginHorizontal: 6,
    marginBottom: 18,
    borderRadius: 1,
  },
  connectorDone: {
    backgroundColor: UI_COLORS.SUCCESS,
  },
  checkmark: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: '700',
  },
  stepNumber: {
    color: UI_COLORS.TEXT_SECONDARY,
    fontSize: 13,
    fontWeight: '700',
  },
  stepNumberActive: { color: UI_COLORS.ACCENT },
  stepLabel: {
    color: UI_COLORS.TEXT_SECONDARY,
    fontSize: 11,
    fontWeight: '600',
    marginTop: 6,
    letterSpacing: 0.3,
  },
  stepLabelActive: { color: UI_COLORS.ACCENT },
  stepLabelDone: { color: UI_COLORS.SUCCESS },
});

// ─── Face Scan Decorative Icon ─────────────────────────────────────────────
const FaceScanIcon: React.FC<{ size?: number; color?: string }> = ({
  size = 64,
  color = UI_COLORS.ACCENT,
}) => (
  <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
    <Svg width={size} height={size} viewBox="0 0 64 64" fill="none">
      {/* Corner brackets */}
      <Path d="M4 16V8a4 4 0 014-4h8" stroke={color} strokeWidth={2.5} strokeLinecap="round" />
      <Path d="M48 4h8a4 4 0 014 4v8" stroke={color} strokeWidth={2.5} strokeLinecap="round" />
      <Path d="M60 48v8a4 4 0 01-4 4h-8" stroke={color} strokeWidth={2.5} strokeLinecap="round" />
      <Path d="M16 60H8a4 4 0 01-4-4v-8" stroke={color} strokeWidth={2.5} strokeLinecap="round" />
      {/* Simplified face */}
      <Circle cx={24} cy={26} r={2.5} fill={color} opacity={0.7} />
      <Circle cx={40} cy={26} r={2.5} fill={color} opacity={0.7} />
      <Path
        d="M24 40c0 0 4 5 8 5s8-5 8-5"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        opacity={0.5}
      />
      {/* Scan line */}
      <Path d="M12 32h40" stroke={color} strokeWidth={1} strokeDasharray="4 3" opacity={0.35} />
    </Svg>
  </View>
);

// ─── Shield / Lock Icon (for done state) ───────────────────────────────────
const ShieldCheckIcon: React.FC<{ size?: number }> = ({ size = 72 }) => (
  <Svg width={size} height={size} viewBox="0 0 64 64" fill="none">
    <Path
      d="M32 4L8 16v16c0 14 10 26 24 30 14-4 24-16 24-30V16L32 4z"
      fill={UI_COLORS.SUCCESS_LIGHT}
      stroke={UI_COLORS.SUCCESS}
      strokeWidth={2}
    />
    <Path
      d="M22 32l7 7 13-14"
      stroke={UI_COLORS.SUCCESS}
      strokeWidth={3}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

// ─── Lock Icon ─────────────────────────────────────────────────────────────
const LockIcon: React.FC<{ size?: number; color?: string }> = ({
  size = 16,
  color = UI_COLORS.SUCCESS,
}) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Rect x={4} y={10} width={16} height={12} rx={2} fill={color} opacity={0.2} stroke={color} strokeWidth={1.5} />
    <Path d="M8 10V7a4 4 0 018 0v3" stroke={color} strokeWidth={1.5} strokeLinecap="round" />
    <Circle cx={12} cy={16} r={1.5} fill={color} />
  </Svg>
);

// ─── Error Icon ────────────────────────────────────────────────────────────
const ErrorIcon: React.FC<{ size?: number }> = ({ size = 56 }) => (
  <Svg width={size} height={size} viewBox="0 0 64 64" fill="none">
    <Circle cx={32} cy={32} r={28} fill={UI_COLORS.ERROR_LIGHT} stroke={UI_COLORS.ERROR} strokeWidth={2} />
    <Path d="M22 22l20 20M42 22L22 42" stroke={UI_COLORS.ERROR} strokeWidth={3} strokeLinecap="round" />
  </Svg>
);

// ─── Circular Progress Ring (SVG) ──────────────────────────────────────────
const ProgressRing: React.FC<{
  progress: number; // 0–1
  size?: number;
  strokeWidth?: number;
}> = ({ progress, size = 160, strokeWidth = 6 }) => {
  const center = size / 2;
  const radius = (size - strokeWidth * 2) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference * (1 - progress);

  return (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {/* Background ring */}
      <Circle
        cx={center}
        cy={center}
        r={radius}
        stroke="rgba(255,255,255,0.08)"
        strokeWidth={strokeWidth}
        fill="none"
      />
      {/* Progress ring */}
      <Circle
        cx={center}
        cy={center}
        r={radius}
        stroke={UI_COLORS.ACCENT}
        strokeWidth={strokeWidth}
        fill="none"
        strokeLinecap="round"
        strokeDasharray={`${circumference}`}
        strokeDashoffset={strokeDashoffset}
        rotation="-90"
        origin={`${center}, ${center}`}
      />
      {/* Inner glow ring */}
      <Circle
        cx={center}
        cy={center}
        r={radius - 12}
        stroke={UI_COLORS.BORDER_ACCENT}
        strokeWidth={1}
        fill="none"
        strokeDasharray="6 4"
      />
    </Svg>
  );
};

// ─── Main EnrollScreen ─────────────────────────────────────────────────────

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const GUIDE_SIZE = 300; // Larger scanning circle (diameter)
const cx = SCREEN_W / 2;
const cy = SCREEN_H / 2 - 30; // Slightly above center to make room for bottom stats
const radius = GUIDE_SIZE / 2;

interface EnrollState {
  step: 'FORM' | 'CAPTURE' | 'PROCESSING' | 'DONE' | 'ERROR';
  capturedCount: number;
  embeddings: number[][];
}

export const EnrollScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const nav = useNavigation();
  const onBack = useCallback(() => {
    nav.goBack();
  }, [nav]);

  const { hasPermission, requestPermission } = useCameraPermission();
  const [name, setName] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [nameFocused, setNameFocused] = useState(false);
  const [idFocused, setIdFocused] = useState(false);
  const [state, setState] = useState<EnrollState>({
    step: 'FORM', capturedCount: 0, embeddings: [],
  });
  const [isCameraLoaded, setIsCameraLoaded] = useState(false);
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [statusMessage, setStatusMessage] = useState('Position your face in the circle');
  const [frameStatus, setFrameStatus] = useState({
    hasFace: false,
    isCentered: false,
    isBright: false,
    isFocused: false,
    qualityPass: false,
    qualityScore: 0,
  });

  const nameRef = useRef('');
  const employeeIdRef = useRef('');

  useEffect(() => {
    nameRef.current = name;
    employeeIdRef.current = employeeId;
  }, [name, employeeId]);

  const isCapturingRef = useRef(false);
  const capturedEmbeddingsRef = useRef<number[][]>([]);
  const stepRef = useRef<EnrollState['step']>('FORM');

  // Initialize FaceEngine models and request camera permission on screen mount
  useEffect(() => {
    const init = async () => {
      try {
        await FaceEngine.initialize();
        setModelsLoaded(true);
      } catch (err) {
        console.error('[EnrollScreen] FaceEngine initialize error:', err);
      }
      // Pre-request camera permission so device is available when capture starts
      if (!hasPermission) {
        try {
          await requestPermission();
        } catch (err) {
          console.error('[EnrollScreen] Camera permission request error:', err);
        }
      }
    };
    init();
  }, []);

  // ─── Animations ─────────────────────────────────────────────────────────
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const scanLineAnim = useRef(new Animated.Value(0)).current;
  const successScaleAnim = useRef(new Animated.Value(0)).current;
  const successOpacityAnim = useRef(new Animated.Value(0)).current;
  const badgeSlideAnim = useRef(new Animated.Value(30)).current;
  const buttonScaleAnim = useRef(new Animated.Value(1)).current;

  // Pulse animation for capture overlay
  useEffect(() => {
    if (state.step === 'CAPTURE') {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.08, duration: 1200, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 1200, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ]),
      ).start();

      // Scan line animation
      Animated.loop(
        Animated.timing(scanLineAnim, {
          toValue: 1,
          duration: 2500,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
      ).start();
    } else {
      pulseAnim.stopAnimation();
      pulseAnim.setValue(1);
      scanLineAnim.stopAnimation();
      scanLineAnim.setValue(0);
    }
  }, [state.step]);

  // Success animations
  useEffect(() => {
    if (state.step === 'DONE') {
      Animated.parallel([
        Animated.spring(successScaleAnim, {
          toValue: 1,
          tension: 50,
          friction: 7,
          useNativeDriver: true,
        }),
        Animated.timing(successOpacityAnim, {
          toValue: 1,
          duration: 400,
          useNativeDriver: true,
        }),
        Animated.timing(badgeSlideAnim, {
          toValue: 0,
          duration: 500,
          delay: 300,
          easing: Easing.out(Easing.back(1.5)),
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      successScaleAnim.setValue(0);
      successOpacityAnim.setValue(0);
      badgeSlideAnim.setValue(30);
    }
  }, [state.step]);

  // Button press animation
  const onButtonPressIn = () => {
    Animated.spring(buttonScaleAnim, {
      toValue: 0.96,
      useNativeDriver: true,
    }).start();
  };
  const onButtonPressOut = () => {
    Animated.spring(buttonScaleAnim, {
      toValue: 1,
      friction: 4,
      useNativeDriver: true,
    }).start();
  };

  // ─── Capture Logic (sync worklet – no ArrayBuffer crosses to JS) ────────

  const handleEmbeddingResult = useCallback((embedding: number[]) => {
    if (capturedEmbeddingsRef.current.length >= CAPTURE_COUNT) return;
    capturedEmbeddingsRef.current.push(embedding);

    // Haptic vibration feedback for each sample capture
    try {
      Vibration.vibrate(30);
    } catch {}

    setState(prev => {
      const next = {
        ...prev,
        capturedCount: capturedEmbeddingsRef.current.length,
      };
      stepRef.current = next.step;
      return next;
    });

    if (capturedEmbeddingsRef.current.length >= CAPTURE_COUNT) {
      finalizeEnrollment(capturedEmbeddingsRef.current);
    }
  }, []); // Empty dependencies ensures VisionCamera frame processor is never re-registered during typing

  const handleEmbeddingOnJS = useMemo(() => Worklets.createRunOnJS(handleEmbeddingResult), [handleEmbeddingResult]);

  const handleFrameStatus = useCallback((
    hasFace: boolean,
    isCentered: boolean,
    isBright: boolean,
    isFocused: boolean,
    qualityPass: boolean,
    reason: string | null,
    qualityScore: number
  ) => {
    if (stepRef.current !== 'CAPTURE') return;
    
    setFrameStatus({
      hasFace,
      isCentered,
      isBright,
      isFocused,
      qualityPass,
      qualityScore,
    });

    if (!hasFace) {
      setStatusMessage('No face detected');
    } else if (!qualityPass) {
      setStatusMessage(reason || 'Adjust position');
    } else {
      setStatusMessage('Capturing... hold still');
    }
  }, []);

  const handleFrameStatusOnJS = useMemo(() => Worklets.createRunOnJS(handleFrameStatus), [handleFrameStatus]);

  // Get model references (JSI host objects — safe to capture in worklet closure)
  const detModel = modelsLoaded ? FaceEngine.detectionModel : null;
  const recModel = modelsLoaded ? FaceEngine.recognitionModel : null;

  const frameProcessor = useFrameProcessor((frame) => {
    'worklet';
    if (!detModel || !recModel) return;
    runAtTargetFps(2, () => {
      'worklet';
      try {
        const width = frame.width;
        const height = frame.height;
        const buffer = frame.toArrayBuffer();
        const pixels = new Float32Array(new Uint8Array(buffer));

        // Step 1: Detect face (synchronous — runs in worklet thread)
        const face = wDetectFace(pixels, width, height, detModel);
        if (!face) {
          handleFrameStatusOnJS(false, false, false, false, false, 'No face detected', 0);
          return;
        }

        // Step 2: Extract face metrics for quality check
        const faceSize = Math.min(face.width, face.height);
        const centerX = face.x + face.width / 2;
        const centerY = face.y + face.height / 2;
        const dx = Math.abs(centerX / width - 0.5);
        const dy = Math.abs(centerY / height - 0.5);
        
        const isCentered = dx <= QUALITY_CONFIG.FACE_CENTER_TOLERANCE && dy <= QUALITY_CONFIG.FACE_CENTER_TOLERANCE;
        const isLargeEnough = faceSize >= QUALITY_CONFIG.MIN_FACE_SIZE_PX;

        const roi = wExtractROI(pixels, face, width, height);
        const brightness = roi.reduce((a: number, b: number) => a + b, 0) / roi.length;
        const isBright = brightness >= QUALITY_CONFIG.MIN_BRIGHTNESS && brightness <= QUALITY_CONFIG.MAX_BRIGHTNESS;

        const roiW = Math.min(width - Math.max(0, Math.floor(face.x)), Math.ceil(face.width));
        const roiH = Math.min(height - Math.max(0, Math.floor(face.y)), Math.ceil(face.height));
        const blur = wLaplacianVariance(roi, roiW, roiH);
        const isFocused = blur >= QUALITY_CONFIG.MIN_BLUR_SCORE;

        let qualityPass = true;
        let reason: string | null = null;
        let qualityScore = 0;

        if (!isLargeEnough) {
          qualityPass = false;
          reason = 'Move closer to camera';
        } else if (!isCentered) {
          qualityPass = false;
          reason = 'Center your face';
        } else if (!isBright) {
          qualityPass = false;
          reason = brightness < QUALITY_CONFIG.MIN_BRIGHTNESS 
            ? 'Too dark — find better lighting' 
            : 'Too bright — avoid direct light';
        } else if (!isFocused) {
          qualityPass = false;
          reason = 'Image too blurry — hold still';
        }

        if (qualityPass) {
          qualityScore = Math.min(1.0, (blur / 300) * 0.4 + ((brightness - 35) / 185) * 0.3 + (faceSize / 200) * 0.3);
        }

        // Send status indicators to JS
        handleFrameStatusOnJS(true, isCentered, isBright, isFocused, qualityPass, reason, qualityScore);

        if (!qualityPass) return;

        // Step 3: Extract embedding (synchronous)
        const embedding = wExtractEmbedding(pixels, face, width, recModel);

        // Only a number[] crosses to JS — fully supported as shared value
        handleEmbeddingOnJS(embedding);
      } catch (e: any) {
        console.error('[EnrollFP] Frame processing error:', e?.message || e);
      }
    });
  }, [detModel, recModel, handleEmbeddingOnJS, handleFrameStatusOnJS]);

  const finalizeEnrollment = async (embeddings: number[][]) => {
    setState(prev => {
      const next = { ...prev, step: 'PROCESSING' as const };
      stepRef.current = next.step;
      return next;
    });

    try {
      // Average the 5 embeddings → more robust than single capture
      const avgEmbedding = averageEmbeddings(embeddings);

      const userId = uuid();
      const deviceId = await DeviceInfo.getUniqueId();

      const faceEmbedding: FaceEmbedding = {
        id: uuid(),
        userId,
        userName: nameRef.current.trim(),
        employeeId: employeeIdRef.current.trim(),
        embedding: avgEmbedding,
        enrolledAt: Date.now(),
        deviceId,
      };

      await DatabaseService.saveEmbedding(faceEmbedding);
      FaceEngine.addEmbedding(faceEmbedding);

      setState(prev => ({ ...prev, step: 'DONE' }));
    } catch (err) {
      console.error('[Enroll] Save error:', err);
      setState(prev => ({ ...prev, step: 'ERROR' }));
    }
  };

  const averageEmbeddings = (embeddings: number[][]): number[] => {
    const dim = embeddings[0].length;
    const avg = new Array(dim).fill(0);
    for (const emb of embeddings) {
      for (let i = 0; i < dim; i++) avg[i] += emb[i];
    }
    for (let i = 0; i < dim; i++) avg[i] /= embeddings.length;
    // Re-normalize
    const norm = Math.sqrt(avg.reduce((s, x) => s + x * x, 0));
    return avg.map(x => x / norm);
  };

  const startCapture = async () => {
    if (!name.trim()) { Alert.alert('Error', 'Please enter name'); return; }
    if (!employeeId.trim()) { Alert.alert('Error', 'Please enter Employee ID'); return; }
    
    // Check and request camera permission dynamically
    if (!hasPermission) {
      try {
        const granted = await requestPermission();
        if (!granted) {
          Alert.alert('Permission Denied', 'Camera permission is required to enroll a user. Please grant it in Settings.');
          return;
        }
        // Small delay to let the permission state propagate through the system
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (err) {
        console.error('[EnrollScreen] Permission request error:', err);
        Alert.alert('Error', 'Could not request camera permission.');
        return;
      }
    }
    
    capturedEmbeddingsRef.current = [];
    const next: EnrollState = { step: 'CAPTURE', capturedCount: 0, embeddings: [] };
    stepRef.current = next.step;
    setState(next);
  };

  // ─── Render: FORM ──────────────────────────────────────────────────────

  if (state.step === 'FORM') {
    return (
      <ScrollView
        style={styles.container}
        contentContainerStyle={[styles.formContent, { paddingTop: insets.top + 16 }]}
        keyboardShouldPersistTaps="handled"
      >
        <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

        {/* Back button */}
        <TouchableOpacity onPress={onBack} style={styles.backBtn} activeOpacity={0.7}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>

        {/* Progress stepper */}
        <StepIndicator currentStep={0} />

        {/* Decorative icon */}
        <View style={styles.iconContainer}>
          <View style={styles.iconGlow}>
            <FaceScanIcon size={64} />
          </View>
        </View>

        {/* Title */}
        <Text style={styles.title}>
          Enroll <Text style={styles.titleAccent}>New User</Text>
        </Text>
        <Text style={styles.subtitle}>
          Register a new field personnel with biometric face data
        </Text>

        {/* Info card */}
        <View style={styles.infoCard}>
          <View style={styles.infoIconWrap}>
            <Text style={styles.infoIcon}>🔬</Text>
          </View>
          <View style={styles.infoTextWrap}>
            <Text style={styles.infoTitle}>Multi-Sample Capture</Text>
            <Text style={styles.infoDesc}>
              5 samples are captured and averaged for maximum recognition accuracy
            </Text>
          </View>
        </View>

        {/* Name input */}
        <View style={styles.inputGroup}>
          <Text style={styles.label}>FULL NAME</Text>
          <TextInput
            style={[
              styles.input,
              nameFocused && styles.inputFocused,
            ]}
            value={name}
            onChangeText={setName}
            placeholder="e.g. Rajesh Kumar"
            placeholderTextColor={UI_COLORS.TEXT_TERTIARY}
            autoCapitalize="words"
            onFocus={() => setNameFocused(true)}
            onBlur={() => setNameFocused(false)}
          />
        </View>

        {/* Employee ID input */}
        <View style={styles.inputGroup}>
          <Text style={styles.label}>EMPLOYEE ID</Text>
          <TextInput
            style={[
              styles.input,
              idFocused && styles.inputFocused,
            ]}
            value={employeeId}
            onChangeText={setEmployeeId}
            placeholder="e.g. EMP-2024-001"
            placeholderTextColor={UI_COLORS.TEXT_TERTIARY}
            autoCapitalize="characters"
            onFocus={() => setIdFocused(true)}
            onBlur={() => setIdFocused(false)}
          />
        </View>

        {/* Start Capture button */}
        <Animated.View style={{ transform: [{ scale: buttonScaleAnim }] }}>
          <TouchableOpacity
            style={styles.startButton}
            onPress={startCapture}
            onPressIn={onButtonPressIn}
            onPressOut={onButtonPressOut}
            activeOpacity={0.85}
          >
            <View style={styles.startButtonInner}>
              <Text style={styles.startButtonText}>Start Face Capture</Text>
              <Text style={styles.startButtonArrow}>→</Text>
            </View>
          </TouchableOpacity>
        </Animated.View>

        {/* Bottom spacer */}
        <View style={{ height: 40 }} />
      </ScrollView>
    );
  }

  // ─── Render: CAPTURE / PROCESSING ────────────────────────────────────

  if (state.step === 'CAPTURE' || state.step === 'PROCESSING') {
    const progress = state.capturedCount / CAPTURE_COUNT;
    const scanLineTranslate = scanLineAnim.interpolate({
      inputRange: [0, 1],
      outputRange: [-radius + 15, radius - 15],
    });

    const onCancel = () => {
      capturedEmbeddingsRef.current = [];
      setState({ step: 'FORM', capturedCount: 0, embeddings: [] });
      stepRef.current = 'FORM';
    };

    return (
      <View style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

        <EnrollCameraFeed
           isActive={state.step === 'CAPTURE'}
           frameProcessor={frameProcessor}
           onCancel={onCancel}
           onCameraLoaded={setIsCameraLoaded}
           hasPermission={hasPermission}
        />

        {/* Dark overlay with circular cutout - only display when camera is loaded */}
        {isCameraLoaded && (
          <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
            <Svg width={SCREEN_W} height={SCREEN_H} style={StyleSheet.absoluteFill}>
              <Defs>
                <Mask id="circleMask">
                  <Rect x="0" y="0" width={SCREEN_W} height={SCREEN_H} fill="white" />
                  <Circle cx={cx} cy={cy} r={radius} fill="black" />
                </Mask>
              </Defs>

              {/* Semi-transparent dark background with clear circle hole */}
              <Rect
                x="0"
                y="0"
                width={SCREEN_W}
                height={SCREEN_H}
                fill="rgba(8,8,26,0.72)"
                mask="url(#circleMask)"
              />

              {/* Outer subtle glow ring */}
              <Circle
                cx={cx}
                cy={cy}
                r={radius + 15}
                fill="none"
                stroke={UI_COLORS.ACCENT}
                strokeWidth={1}
                opacity={0.15}
              />

              {/* Main circular border */}
              <Circle
                cx={cx}
                cy={cy}
                r={radius}
                fill="none"
                stroke={progress > 0 ? UI_COLORS.SUCCESS : UI_COLORS.ACCENT}
                strokeWidth={2.5}
                opacity={0.8}
              />

              {/* Inner dotted decorative ring */}
              <Circle
                cx={cx}
                cy={cy}
                r={radius - 8}
                fill="none"
                stroke={UI_COLORS.ACCENT}
                strokeWidth={1}
                strokeDasharray="6 4"
                opacity={0.3}
              />

              {/* Green progress ring layered on top */}
              {progress > 0 && (
                <Circle
                  cx={cx}
                  cy={cy}
                  r={radius}
                  fill="none"
                  stroke={UI_COLORS.SUCCESS}
                  strokeWidth={5}
                  strokeDasharray={`${2 * Math.PI * radius}`}
                  strokeDashoffset={2 * Math.PI * radius * (1 - progress)}
                  strokeLinecap="round"
                  rotation="-90"
                  origin={`${cx}, ${cy}`}
                  opacity={0.9}
                />
              )}
            </Svg>

            {/* Scan line overlay inside the cutout */}
            {state.step === 'CAPTURE' && (
              <Animated.View
                style={[
                  styles.scanLine,
                  {
                    transform: [{ translateY: scanLineTranslate }],
                    width: radius * 2 - 20,
                    top: cy,
                    left: cx - (radius - 10),
                    position: 'absolute',
                  },
                ]}
              />
            )}

            {/* Top info bar */}
            <View style={[styles.captureTopContainer, { paddingTop: insets.top + 16 }]}>
              <View style={styles.captureTopBar}>
                <TouchableOpacity
                  onPress={onCancel}
                  style={styles.captureBackBtn}
                  activeOpacity={0.7}
                >
                  <Text style={styles.captureBackText}>✕</Text>
                </TouchableOpacity>
                <View style={styles.captureBadge}>
                  <Text style={styles.captureBadgeText}>BIOMETRIC ENROLLMENT</Text>
                </View>
              </View>

              {/* Title */}
              <Text style={styles.captureTitle}>
                {state.step === 'PROCESSING' ? 'Processing...' : 'Face Registration'}
              </Text>
              <Text style={styles.captureSubtitleInfo}>
                {state.step === 'PROCESSING'
                  ? 'Averaging and encrypting biometric credentials'
                  : 'Align your face in the circular scanner zone'}
              </Text>
            </View>

            {/* Bottom dashboard container */}
            <View style={[styles.captureBottomContainer, { paddingBottom: insets.bottom + 20 }]}>
              
              {/* Aadhaar-style Real-time indicators dashboard */}
              {state.step === 'CAPTURE' && (
                <View style={styles.dashboardCard}>
                  <Text style={styles.dashboardTitle}>REAL-TIME BIOMETRIC QUALITY</Text>
                  
                  <View style={styles.metricsRow}>
                    {/* Position indicator */}
                    <View style={styles.metricItem}>
                      <Text style={[styles.metricDot, frameStatus.isCentered ? styles.metricDotGreen : styles.metricDotRed]}>●</Text>
                      <Text style={styles.metricLabel}>ALIGNMENT</Text>
                      <Text style={[styles.metricValue, frameStatus.isCentered ? styles.textGreen : styles.textRed]}>
                        {frameStatus.isCentered ? 'Centered' : 'Adjust'}
                      </Text>
                    </View>
                    
                    <View style={styles.metricDivider} />

                    {/* Lighting indicator */}
                    <View style={styles.metricItem}>
                      <Text style={[styles.metricDot, frameStatus.isBright ? styles.metricDotGreen : styles.metricDotRed]}>●</Text>
                      <Text style={styles.metricLabel}>LIGHTING</Text>
                      <Text style={[styles.metricValue, frameStatus.isBright ? styles.textGreen : styles.textRed]}>
                        {frameStatus.isBright ? 'Optimal' : 'Adjust'}
                      </Text>
                    </View>

                    <View style={styles.metricDivider} />

                    {/* Sharpness/Focus indicator */}
                    <View style={styles.metricItem}>
                      <Text style={[styles.metricDot, frameStatus.isFocused ? styles.metricDotGreen : styles.metricDotRed]}>●</Text>
                      <Text style={styles.metricLabel}>STABILITY</Text>
                      <Text style={[styles.metricValue, frameStatus.isFocused ? styles.textGreen : styles.textRed]}>
                        {frameStatus.isFocused ? 'Steady' : 'Hold Still'}
                      </Text>
                    </View>
                  </View>
                </View>
              )}

              {/* Status message pill */}
              <View style={styles.statusPill}>
                <Text style={styles.statusPillDot}>●</Text>
                <Text style={styles.statusPillText}>{statusMessage}</Text>
              </View>

              {/* Sample counter */}
              <View style={styles.sampleCountContainer}>
                <Text style={styles.sampleCountLabel}>SAMPLES SECURED</Text>
                <Text style={styles.sampleCountValue}>
                  {Math.min(state.capturedCount, CAPTURE_COUNT)}
                  <Text style={styles.sampleCountTotal}>/{CAPTURE_COUNT}</Text>
                </Text>
              </View>

              {/* Progress dots row */}
              <View style={styles.progressRow}>
                {Array.from({ length: CAPTURE_COUNT }).map((_, i) => (
                  <View key={i} style={styles.progressDotContainer}>
                    <View
                      style={[
                        styles.progressDot,
                        i < state.capturedCount && styles.progressDotDone,
                        i === state.capturedCount && state.step === 'CAPTURE' && styles.progressDotActive,
                      ]}
                     />
                     {i < state.capturedCount && (
                       <Text style={styles.progressDotCheck}>✓</Text>
                     )}
                  </View>
                ))}
              </View>

              {state.step === 'PROCESSING' && (
                <ActivityIndicator color={UI_COLORS.SUCCESS} size="large" style={{ marginTop: 12 }} />
              )}
            </View>
          </View>
        )}
      </View>
    );
  }

  // ─── Render: DONE ────────────────────────────────────────────────────

  if (state.step === 'DONE') {
    return (
      <View style={[styles.container, styles.centerContent, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16 }]}>
        <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

        {/* Success checkmark with scale animation */}
        <Animated.View
          style={[
            styles.successIconContainer,
            {
              transform: [{ scale: successScaleAnim }],
              opacity: successOpacityAnim,
            },
          ]}
        >
          <ShieldCheckIcon size={80} />
        </Animated.View>

        {/* Security Clearance Badge */}
        <Animated.View
          style={[
            styles.clearanceBadge,
            {
              transform: [{ translateY: badgeSlideAnim }],
              opacity: successOpacityAnim,
            },
          ]}
        >
          <View style={styles.badgeHeader}>
            <View style={styles.badgeDot} />
            <Text style={styles.badgeHeaderText}>SECURITY CLEARANCE GRANTED</Text>
            <View style={styles.badgeDot} />
          </View>

          <View style={styles.badgeDivider} />

          <Text style={styles.badgeName}>{name}</Text>
          <Text style={styles.badgeId}>ID: {employeeId}</Text>

          <View style={styles.badgeDivider} />

          {/* Encrypted stored info */}
          <View style={styles.encryptedRow}>
            <LockIcon size={14} color={UI_COLORS.SUCCESS} />
            <Text style={styles.encryptedText}>Encrypted & Stored on Device</Text>
          </View>

          {/* Details */}
          <View style={styles.badgeDetailsRow}>
            <View style={styles.badgeDetail}>
              <Text style={styles.badgeDetailLabel}>SAMPLES</Text>
              <Text style={styles.badgeDetailValue}>{CAPTURE_COUNT}</Text>
            </View>
            <View style={styles.badgeDetailSeparator} />
            <View style={styles.badgeDetail}>
              <Text style={styles.badgeDetailLabel}>SECURITY</Text>
              <Text style={styles.badgeDetailValue}>AES-256</Text>
            </View>
            <View style={styles.badgeDetailSeparator} />
            <View style={styles.badgeDetail}>
              <Text style={styles.badgeDetailLabel}>STATUS</Text>
              <Text style={[styles.badgeDetailValue, { color: UI_COLORS.SUCCESS }]}>ACTIVE</Text>
            </View>
          </View>
        </Animated.View>

        {/* Done button */}
        <Animated.View style={{ opacity: successOpacityAnim, width: '100%', paddingHorizontal: 32 }}>
          <TouchableOpacity style={styles.doneButton} onPress={onBack} activeOpacity={0.85}>
            <Text style={styles.doneButtonText}>Done</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    );
  }

  // ─── Render: ERROR ───────────────────────────────────────────────────

  return (
    <View style={[styles.container, styles.centerContent, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16 }]}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

      <ErrorIcon size={64} />

      <View style={styles.errorCard}>
        <Text style={styles.errorTitle}>Enrollment Failed</Text>
        <Text style={styles.errorDescription}>
          An error occurred while saving biometric data. Please ensure good lighting and try again.
        </Text>

        <View style={styles.errorDivider} />

        <TouchableOpacity
          style={styles.retryButton}
          onPress={() => setState({ step: 'FORM', capturedCount: 0, embeddings: [] })}
          activeOpacity={0.85}
        >
          <Text style={styles.retryButtonText}>↻ Try Again</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.cancelButton}
          onPress={onBack}
          activeOpacity={0.7}
        >
          <Text style={styles.cancelButtonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: UI_COLORS.BACKGROUND },
  formContent: { padding: 24, paddingBottom: 40 },
  centerContent: { alignItems: 'center', justifyContent: 'center', padding: 32 },

  // Back
  backBtn: { marginBottom: 20, alignSelf: 'flex-start' },
  backText: { color: UI_COLORS.TEXT_SECONDARY, fontSize: 15, fontWeight: '600' },

  // Icon
  iconContainer: { alignItems: 'center', marginBottom: 20 },
  iconGlow: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: UI_COLORS.GLOW_ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: UI_COLORS.BORDER_ACCENT,
  },

  // Title
  title: {
    fontSize: 30,
    fontWeight: '800',
    color: UI_COLORS.TEXT_PRIMARY,
    marginBottom: 8,
    textAlign: 'center',
    letterSpacing: -0.5,
  },
  titleAccent: {
    color: UI_COLORS.ACCENT,
  },
  subtitle: {
    fontSize: 14,
    color: UI_COLORS.TEXT_SECONDARY,
    marginBottom: 24,
    lineHeight: 20,
    textAlign: 'center',
  },

  // Info card
  infoCard: {
    flexDirection: 'row',
    backgroundColor: UI_COLORS.SURFACE,
    borderRadius: 14,
    padding: 14,
    marginBottom: 28,
    borderWidth: 1,
    borderColor: UI_COLORS.BORDER,
    alignItems: 'center',
  },
  infoIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: UI_COLORS.ACCENT_LIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  infoIcon: { fontSize: 18 },
  infoTextWrap: { flex: 1 },
  infoTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: UI_COLORS.TEXT_PRIMARY,
    marginBottom: 2,
    letterSpacing: 0.2,
  },
  infoDesc: {
    fontSize: 12,
    color: UI_COLORS.TEXT_SECONDARY,
    lineHeight: 17,
  },

  // Inputs
  inputGroup: { marginBottom: 20 },
  label: {
    fontSize: 11,
    color: UI_COLORS.TEXT_SECONDARY,
    marginBottom: 8,
    fontWeight: '700',
    letterSpacing: 1.2,
  },
  input: {
    backgroundColor: UI_COLORS.SURFACE,
    borderRadius: 14,
    paddingHorizontal: 18,
    paddingVertical: 16,
    color: UI_COLORS.TEXT_PRIMARY,
    fontSize: 16,
    borderWidth: 1.5,
    borderColor: UI_COLORS.BORDER,
    fontWeight: '500',
  },
  inputFocused: {
    borderColor: UI_COLORS.ACCENT,
    backgroundColor: UI_COLORS.SURFACE_ELEVATED,
  },

  // Start button
  startButton: {
    backgroundColor: UI_COLORS.ACCENT,
    borderRadius: 16,
    marginTop: 8,
    overflow: 'hidden',
    // Simulate gradient with a layered effect
    shadowColor: UI_COLORS.ACCENT,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 8,
  },
  startButtonInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 18,
    paddingHorizontal: 24,
  },
  startButtonText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  startButtonArrow: {
    color: '#FFF',
    fontSize: 18,
    fontWeight: '700',
    marginLeft: 8,
    opacity: 0.8,
  },

  // ─── Capture overlay ──────────────────────────────────────────────
  captureTopContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  captureBottomContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  dashboardCard: {
    backgroundColor: 'rgba(18, 18, 42, 0.85)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 16,
    padding: 12,
    width: '90%',
    marginBottom: 14,
    alignItems: 'center',
  },
  dashboardTitle: {
    fontSize: 9,
    fontWeight: '800',
    color: UI_COLORS.TEXT_SECONDARY,
    letterSpacing: 1.5,
    marginBottom: 10,
  },
  metricsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    width: '100%',
  },
  metricItem: {
    alignItems: 'center',
    flexDirection: 'column',
    flex: 1,
  },
  metricDot: {
    fontSize: 8,
    marginBottom: 2,
  },
  metricDotGreen: {
    color: UI_COLORS.SUCCESS,
  },
  metricDotRed: {
    color: UI_COLORS.ERROR,
  },
  metricLabel: {
    fontSize: 8,
    fontWeight: '700',
    color: UI_COLORS.TEXT_TERTIARY,
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  metricValue: {
    fontSize: 11,
    fontWeight: '800',
  },
  metricDivider: {
    width: 1,
    height: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  textGreen: {
    color: UI_COLORS.SUCCESS,
  },
  textRed: {
    color: UI_COLORS.ERROR,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    marginBottom: 12,
  },
  statusPillDot: {
    color: UI_COLORS.ACCENT,
    marginRight: 6,
    fontSize: 10,
  },
  statusPillText: {
    color: '#FFF',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  captureTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    marginBottom: 16,
  },
  captureBackBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  captureBackText: {
    color: UI_COLORS.TEXT_PRIMARY,
    fontSize: 16,
    fontWeight: '600',
  },
  captureBadge: {
    backgroundColor: UI_COLORS.ACCENT_LIGHT,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: UI_COLORS.BORDER_ACCENT,
  },
  captureBadgeText: {
    color: UI_COLORS.ACCENT,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.5,
  },
  captureTitle: {
    color: UI_COLORS.TEXT_PRIMARY,
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 6,
    textAlign: 'center',
    letterSpacing: -0.3,
  },
  captureSubtitleInfo: {
    color: UI_COLORS.TEXT_SECONDARY,
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 12,
  },

  // Face guide
  scanLine: {
    position: 'absolute',
    height: 2.5,
    backgroundColor: UI_COLORS.ACCENT,
    opacity: 0.5,
    borderRadius: 1,
  },

  // Sample counter
  sampleCountContainer: {
    alignItems: 'center',
    marginTop: 16,
  },
  sampleCountLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: UI_COLORS.TEXT_SECONDARY,
    letterSpacing: 2,
    marginBottom: 2,
  },
  sampleCountValue: {
    fontSize: 36,
    fontWeight: '800',
    color: UI_COLORS.TEXT_PRIMARY,
  },
  sampleCountTotal: {
    fontSize: 20,
    fontWeight: '600',
    color: UI_COLORS.TEXT_SECONDARY,
  },

  // Progress dots
  progressRow: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 16,
    alignItems: 'center',
  },
  progressDotContainer: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  progressDotDone: {
    backgroundColor: UI_COLORS.SUCCESS,
    borderColor: UI_COLORS.SUCCESS,
  },
  progressDotActive: {
    borderColor: UI_COLORS.ACCENT,
    backgroundColor: UI_COLORS.ACCENT_LIGHT,
  },
  progressDotCheck: {
    position: 'absolute',
    color: '#FFF',
    fontSize: 11,
    fontWeight: '700',
  },
  captureSubtext: {
    color: UI_COLORS.TEXT_SECONDARY,
    fontSize: 14,
    fontWeight: '500',
  },

  // ─── Done ─────────────────────────────────────────────────────────
  successIconContainer: {
    marginBottom: 24,
  },

  clearanceBadge: {
    backgroundColor: UI_COLORS.SURFACE,
    borderRadius: 20,
    paddingVertical: 24,
    paddingHorizontal: 28,
    width: '100%',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: UI_COLORS.BORDER,
    marginBottom: 32,
  },
  badgeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  badgeHeaderText: {
    fontSize: 11,
    fontWeight: '800',
    color: UI_COLORS.SUCCESS,
    letterSpacing: 2,
    marginHorizontal: 8,
  },
  badgeDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: UI_COLORS.SUCCESS,
  },
  badgeDivider: {
    width: '100%',
    height: 1,
    backgroundColor: UI_COLORS.BORDER,
    marginVertical: 14,
  },
  badgeName: {
    fontSize: 24,
    fontWeight: '800',
    color: UI_COLORS.TEXT_PRIMARY,
    textAlign: 'center',
    letterSpacing: -0.3,
  },
  badgeId: {
    fontSize: 14,
    color: UI_COLORS.TEXT_SECONDARY,
    fontWeight: '600',
    marginTop: 4,
    letterSpacing: 0.5,
  },
  encryptedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 14,
  },
  encryptedText: {
    fontSize: 12,
    color: UI_COLORS.SUCCESS,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  badgeDetailsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeDetail: {
    alignItems: 'center',
    paddingHorizontal: 14,
  },
  badgeDetailLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: UI_COLORS.TEXT_TERTIARY,
    letterSpacing: 1,
    marginBottom: 4,
  },
  badgeDetailValue: {
    fontSize: 13,
    fontWeight: '700',
    color: UI_COLORS.TEXT_PRIMARY,
  },
  badgeDetailSeparator: {
    width: 1,
    height: 24,
    backgroundColor: UI_COLORS.BORDER,
  },

  doneButton: {
    backgroundColor: UI_COLORS.SUCCESS,
    borderRadius: 16,
    paddingVertical: 18,
    alignItems: 'center',
    shadowColor: UI_COLORS.SUCCESS,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
  doneButtonText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.3,
  },

  // ─── Error ────────────────────────────────────────────────────────
  errorCard: {
    backgroundColor: UI_COLORS.SURFACE,
    borderRadius: 20,
    padding: 28,
    width: '100%',
    alignItems: 'center',
    marginTop: 24,
    borderWidth: 1,
    borderColor: UI_COLORS.BORDER,
  },
  errorTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: UI_COLORS.ERROR,
    marginBottom: 8,
    letterSpacing: -0.3,
  },
  errorDescription: {
    fontSize: 14,
    color: UI_COLORS.TEXT_SECONDARY,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 4,
  },
  errorDivider: {
    width: '100%',
    height: 1,
    backgroundColor: UI_COLORS.BORDER,
    marginVertical: 20,
  },
  retryButton: {
    backgroundColor: UI_COLORS.ACCENT,
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 40,
    width: '100%',
    alignItems: 'center',
    marginBottom: 12,
    shadowColor: UI_COLORS.ACCENT,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  retryButtonText: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: '700',
  },
  cancelButton: {
    paddingVertical: 12,
  },
  cancelButtonText: {
    color: UI_COLORS.TEXT_SECONDARY,
    fontSize: 14,
    fontWeight: '600',
  },
});

const EnrollCameraFeed: React.FC<{
  isActive: boolean;
  frameProcessor: any;
  onCancel: () => void;
  onCameraLoaded: (loaded: boolean) => void;
  hasPermission: boolean;
}> = ({ isActive, frameProcessor, onCancel, onCameraLoaded, hasPermission }) => {
  const device = useCameraDevice('front');
  const [timedOut, setTimedOut] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  useEffect(() => {
    if (!device || !hasPermission) {
      onCameraLoaded(false);
      const timer = setTimeout(() => setTimedOut(true), 5000);
      return () => clearTimeout(timer);
    } else {
      setTimedOut(false);
      setCameraError(null);
      onCameraLoaded(true);
    }
  }, [device, hasPermission, onCameraLoaded]);

  if (!hasPermission || !device) {
    return (
      <View style={[StyleSheet.absoluteFill, { backgroundColor: UI_COLORS.BACKGROUND, alignItems: 'center', justifyContent: 'center' }]}>
        {timedOut ? (
          <>
            <Text style={{ fontSize: 48, marginBottom: 16 }}>📷</Text>
            <Text style={{ color: UI_COLORS.TEXT_PRIMARY, fontSize: 16, fontWeight: '700' }}>
              {!hasPermission ? 'Camera permission required' : 'No front camera found'}
            </Text>
            <Text style={{ color: UI_COLORS.TEXT_SECONDARY, fontSize: 13, marginTop: 6, marginBottom: 20, textAlign: 'center', paddingHorizontal: 32 }}>
              {!hasPermission
                ? 'Please grant camera permission in your device settings and try again.'
                : 'Please check your camera settings and try again.'}
            </Text>
          </>
        ) : (
          <>
            <ActivityIndicator color={UI_COLORS.ACCENT} size="large" />
            <Text style={{ color: UI_COLORS.TEXT_SECONDARY, marginTop: 12, marginBottom: 20 }}>Initializing camera...</Text>
          </>
        )}
        <TouchableOpacity
          onPress={onCancel}
          style={{
            paddingHorizontal: 20,
            paddingVertical: 10,
            borderRadius: 8,
            backgroundColor: 'rgba(255,255,255,0.1)',
            borderWidth: 1,
            borderColor: 'rgba(255,255,255,0.15)',
          }}
        >
          <Text style={{ color: '#FFF', fontWeight: '600' }}>Cancel</Text>
        </TouchableOpacity>
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
      onError={(error) => {
        console.error('[EnrollCameraFeed] Camera error:', error);
        setCameraError(error.message);
      }}
      onInitialized={() => {
        console.log('[EnrollCameraFeed] Camera initialized successfully');
        onCameraLoaded(true);
      }}
    />
  );
};

