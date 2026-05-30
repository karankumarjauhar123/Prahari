// src/screens/EnrollScreen.tsx
// Enroll a new field personnel — capture 5 frames, average embeddings

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, TextInput, StyleSheet, TouchableOpacity,
  Alert, ScrollView, ActivityIndicator,
} from 'react-native';
import {
  Camera, useCameraDevice, useFrameProcessor,
} from 'react-native-vision-camera';
import { runOnJS } from 'react-native-reanimated';
import { useNavigation } from '@react-navigation/native';
import DeviceInfo from 'react-native-device-info';
import { v4 as uuid } from 'uuid';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FaceEngine } from '../services/FaceEngine';
import { DatabaseService } from '../services/DatabaseService';
import { UI_COLORS } from '../constants';
import type { FaceEmbedding } from '../types';

const CAPTURE_COUNT = 5; // Capture 5 embeddings and average for robustness

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

  const device = useCameraDevice('front');
  const [name, setName] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [state, setState] = useState<EnrollState>({
    step: 'FORM', capturedCount: 0, embeddings: [],
  });
  const isCapturingRef = useRef(false);
  const capturedEmbeddingsRef = useRef<number[][]>([]);

  const handleCaptureFrameData = useCallback(async (buffer: ArrayBuffer, width: number, height: number) => {
    if (isCapturingRef.current) return;
    if (capturedEmbeddingsRef.current.length >= CAPTURE_COUNT) return;
    isCapturingRef.current = true;

    try {
      const pixels = new Float32Array(new Uint8Array(buffer));

      const face = await FaceEngine.detectFace(pixels, width, height);
      if (!face) { isCapturingRef.current = false; return; }

      const quality = FaceEngine.checkFaceQuality(pixels, face, width, height);
      if (!quality.pass) { isCapturingRef.current = false; return; }

      const embedding = await FaceEngine.extractEmbedding(pixels, face, width);
      capturedEmbeddingsRef.current.push(embedding);

      setState(prev => ({
        ...prev,
        capturedCount: capturedEmbeddingsRef.current.length,
      }));

      if (capturedEmbeddingsRef.current.length >= CAPTURE_COUNT) {
        await finalizeEnrollment(capturedEmbeddingsRef.current);
      }
    } catch (e) {
      console.error('[Enroll] Capture error:', e);
    } finally {
      // Delay between captures for diversity
      setTimeout(() => { isCapturingRef.current = false; }, 800);
    }
  }, [name, employeeId]);

  const frameProcessor = useFrameProcessor((frame) => {
    'worklet';
    if (state.step === 'CAPTURE') {
      const width = frame.width;
      const height = frame.height;
      const buffer = frame.toArrayBuffer();
      runOnJS(handleCaptureFrameData)(buffer, width, height);
    }
  }, [state.step, handleCaptureFrameData]);

  const finalizeEnrollment = async (embeddings: number[][]) => {
    setState(prev => ({ ...prev, step: 'PROCESSING' }));

    try {
      // Average the 5 embeddings → more robust than single capture
      const avgEmbedding = averageEmbeddings(embeddings);

      const userId = uuid();
      const deviceId = await DeviceInfo.getUniqueId();

      const faceEmbedding: FaceEmbedding = {
        id: uuid(),
        userId,
        userName: name.trim(),
        employeeId: employeeId.trim(),
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

  const startCapture = () => {
    if (!name.trim()) { Alert.alert('Error', 'Please enter name'); return; }
    if (!employeeId.trim()) { Alert.alert('Error', 'Please enter Employee ID'); return; }
    capturedEmbeddingsRef.current = [];
    setState({ step: 'CAPTURE', capturedCount: 0, embeddings: [] });
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  if (state.step === 'FORM') {
    return (
      <ScrollView
        style={styles.container}
        contentContainerStyle={[styles.formContent, { paddingTop: insets.top + 20 }]}
        keyboardShouldPersistTaps="handled"
      >
        <TouchableOpacity onPress={onBack} style={styles.backBtn}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>

        <Text style={styles.title}>Enroll New User</Text>
        <Text style={styles.subtitle}>
          We'll capture 5 face samples for maximum accuracy
        </Text>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Full Name</Text>
          <TextInput
            style={styles.input} value={name} onChangeText={setName}
            placeholder="e.g. Rajesh Kumar" placeholderTextColor="#666"
            autoCapitalize="words"
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Employee ID</Text>
          <TextInput
            style={styles.input} value={employeeId} onChangeText={setEmployeeId}
            placeholder="e.g. EMP-2024-001" placeholderTextColor="#666"
            autoCapitalize="characters"
          />
        </View>

        <TouchableOpacity style={styles.startButton} onPress={startCapture}>
          <Text style={styles.startButtonText}>Start Face Capture →</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  if (state.step === 'CAPTURE' || state.step === 'PROCESSING') {
    return (
      <View style={styles.container}>
        {device && (
          <Camera
            style={StyleSheet.absoluteFill}
            device={device} isActive={state.step === 'CAPTURE'}
            frameProcessor={frameProcessor}
            frameProcessorFps={2}
            pixelFormat="rgb"
          />
        )}

        <View style={[styles.captureOverlay, { paddingTop: insets.top + 16 }]}>
          <Text style={styles.captureTitle}>
            {state.step === 'PROCESSING' ? 'Saving...' : 'Look straight at the camera'}
          </Text>

          {/* Progress dots */}
          <View style={styles.progressRow}>
            {Array.from({ length: CAPTURE_COUNT }).map((_, i) => (
              <View
                key={i}
                style={[
                  styles.progressDot,
                  i < state.capturedCount && styles.progressDotDone,
                ]}
              />
            ))}
          </View>
          <Text style={styles.captureSubtext}>
            {state.step === 'PROCESSING'
              ? 'Saving encrypted embedding...'
              : `Sample ${state.capturedCount + 1} of ${CAPTURE_COUNT}`}
          </Text>

          {state.step === 'PROCESSING' && (
            <ActivityIndicator color={UI_COLORS.SUCCESS} size="large" style={{ marginTop: 20 }} />
          )}
        </View>
      </View>
    );
  }

  if (state.step === 'DONE') {
    return (
      <View style={[styles.container, styles.centerContent]}>
        <Text style={styles.doneEmoji}>✅</Text>
        <Text style={styles.doneTitle}>{name} Enrolled!</Text>
        <Text style={styles.doneSubtitle}>
          Face data encrypted and stored securely on device.
        </Text>
        <TouchableOpacity style={styles.startButton} onPress={onBack}>
          <Text style={styles.startButtonText}>Done</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[styles.container, styles.centerContent]}>
      <Text style={styles.errorText}>Enrollment failed. Please try again.</Text>
      <TouchableOpacity style={styles.startButton} onPress={() =>
        setState({ step: 'FORM', capturedCount: 0, embeddings: [] })
      }>
        <Text style={styles.startButtonText}>Try Again</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: UI_COLORS.BACKGROUND },
  formContent: { padding: 24 },
  centerContent: { alignItems: 'center', justifyContent: 'center', padding: 32 },
  backBtn: { marginBottom: 24 },
  backText: { color: UI_COLORS.ACCENT, fontSize: 16, fontWeight: '600' },
  title: { fontSize: 28, fontWeight: '800', color: '#FFF', marginBottom: 8 },
  subtitle: { fontSize: 14, color: UI_COLORS.TEXT_SECONDARY, marginBottom: 32, lineHeight: 20 },
  inputGroup: { marginBottom: 20 },
  label: { fontSize: 13, color: UI_COLORS.TEXT_SECONDARY, marginBottom: 8, fontWeight: '600', letterSpacing: 0.5 },
  input: {
    backgroundColor: UI_COLORS.SURFACE, borderRadius: 12,
    paddingHorizontal: 16, paddingVertical: 14, color: '#FFF',
    fontSize: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
  },
  startButton: {
    backgroundColor: UI_COLORS.ACCENT, borderRadius: 14,
    paddingVertical: 16, alignItems: 'center', marginTop: 16,
  },
  startButtonText: { color: '#FFF', fontSize: 16, fontWeight: '700' },
  captureOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center', justifyContent: 'flex-start',
    paddingHorizontal: 24,
  },
  captureTitle: { color: '#FFF', fontSize: 20, fontWeight: '700', marginBottom: 24, textAlign: 'center' },
  progressRow: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  progressDot: {
    width: 16, height: 16, borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.3)',
    borderWidth: 2, borderColor: 'rgba(255,255,255,0.5)',
  },
  progressDotDone: { backgroundColor: UI_COLORS.SUCCESS, borderColor: UI_COLORS.SUCCESS },
  captureSubtext: { color: UI_COLORS.TEXT_SECONDARY, fontSize: 14 },
  doneEmoji: { fontSize: 64, marginBottom: 16 },
  doneTitle: { fontSize: 26, fontWeight: '800', color: '#FFF', marginBottom: 8, textAlign: 'center' },
  doneSubtitle: { fontSize: 14, color: UI_COLORS.TEXT_SECONDARY, textAlign: 'center', marginBottom: 32, lineHeight: 20 },
  errorText: { color: UI_COLORS.ERROR, fontSize: 16, textAlign: 'center', marginBottom: 24 },
});
