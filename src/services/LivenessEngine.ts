// src/services/LivenessEngine.ts
// Dual-Stage Liveness Detection:
// Stage 1 (Passive): Frequency analysis + Optical flow + LBP texture
// Stage 2 (Active): Randomized challenge-response (Blink/Smile/Turn)

import { loadTensorflowModel, TensorflowModel } from 'react-native-fast-tflite';
import { Worklets } from 'react-native-worklets-core';
import { LIVENESS_CONFIG, MODEL_CONFIG } from '../constants';
import type {
  LivenessChallenge,
  LivenessResult,
  FaceDetection,
  FaceMeshLandmarks,
  Point,
} from '../types';

class LivenessEngineService {
  public antiSpoofModel: TensorflowModel | null = null;
  public faceMeshModel: TensorflowModel | null = null;

  // Optical flow state
  public prevFrame: Float32Array | null = null;
  public prevFrameW = 0;

  // Active challenge state
  public currentChallenges: LivenessChallenge[] = [];
  public challengeIndex = 0;
  public blinkFrameCount = 0;
  public smileFrameCount = 0;
  public headTurnDetected = false;
  public challengeStartTime = 0;

  // Shared values to synchronize state between JS and Worklet threads
  public challengeCountShared = Worklets.createSharedValue<number>(LIVENESS_CONFIG.CHALLENGE_COUNT);
  public activeLivenessActive = Worklets.createSharedValue<boolean>(false);
  public strictModeShared = Worklets.createSharedValue<boolean>(false);
  public passiveLivenessEnabledShared = Worklets.createSharedValue<boolean>(true);

  setChallengeCount(count: number) {
    this.challengeCountShared.value = count;
    console.log(`[LivenessEngine] Challenge count set to: ${count}`);
  }

  setStrictMode(strict: boolean) {
    this.strictModeShared.value = strict;
    console.log(`[LivenessEngine] Strict mode: ${strict}`);
  }

  setPassiveLivenessEnabled(enabled: boolean) {
    this.passiveLivenessEnabledShared.value = enabled;
    console.log(`[LivenessEngine] Passive liveness: ${enabled}`);
  }

  // ─── Initialization ───────────────────────────────────────────────────────

  async initialize(): Promise<void> {
    this.antiSpoofModel = await loadTensorflowModel(
      require('../../models/antispoof_mobilenet_int8.tflite'), 'default'
    );
    // Load FaceMesh model for active liveness challenges (blink, smile, turn, nod)
    this.faceMeshModel = await loadTensorflowModel(
      require('../../models/face_mesh_lite.tflite'), 'default'
    );
    console.log('[LivenessEngine] ✅ Loaded (anti-spoof + face mesh active liveness)');
  }

  // ─── Stage 1: Passive Liveness (Async version for JS context) ─────────────

  async runPassiveLiveness(
    pixels: Float32Array,
    face: FaceDetection,
    frameWidth: number,
    frameHeight: number
  ): Promise<number> {
    const scores: number[] = [];

    // A) Anti-spoof deep model score
    scores.push(await this.antiSpoofScore(pixels, face, frameWidth, frameHeight));

    // B) Optical flow — real face has natural micro-movements
    scores.push(this.opticalFlowScore(pixels, frameWidth, frameHeight));

    // C) LBP texture — screens/prints have uniform texture
    scores.push(this.lbpTextureScore(pixels, face, frameWidth));

    // Weighted average
    const passiveScore = scores[0] * 0.5 + scores[1] * 0.3 + scores[2] * 0.2;
    return passiveScore;
  }

  private async antiSpoofScore(
    pixels: Float32Array,
    face: FaceDetection,
    frameWidth: number,
    frameHeight: number
  ): Promise<number> {
    if (!this.antiSpoofModel) return 0.5;

    // Crop face with 20% padding
    const pad = 0.2;
    const x = Math.max(0, face.x - face.width * pad);
    const y = Math.max(0, face.y - face.height * pad);
    const w = Math.min(frameWidth - x, face.width * (1 + 2 * pad));
    const h = Math.min(frameHeight - y, face.height * (1 + 2 * pad));

    const crop = this.cropResize(pixels, x, y, w, h, frameWidth, 80);

    // Normalize to [0,1]
    const input = new Float32Array(80 * 80 * 3);
    for (let i = 0; i < input.length; i++) input[i] = crop[i] / 255.0;

    const output = await this.antiSpoofModel.run([input]);
    const result = output[0] as Float32Array;
    return result[0];
  }

  // ─── Stage 1: Passive Liveness (Sync version for Worklet context) ──────────

  runPassiveLivenessSync(
    pixels: Float32Array,
    face: FaceDetection,
    frameWidth: number,
    frameHeight: number
  ): number {
    'worklet';
    const scores: number[] = [];

    // A) Anti-spoof deep model score
    scores.push(LivenessEngine.antiSpoofScoreSync(pixels, face, frameWidth, frameHeight));

    // B) Optical flow — real face has natural micro-movements
    scores.push(LivenessEngine.opticalFlowScore(pixels, frameWidth, frameHeight));

    // C) LBP texture — screens/prints have uniform texture
    scores.push(LivenessEngine.lbpTextureScore(pixels, face, frameWidth));

    // Weighted average
    const passiveScore = scores[0] * 0.5 + scores[1] * 0.3 + scores[2] * 0.2;
    return passiveScore;
  }

  private antiSpoofScoreSync(
    pixels: Float32Array,
    face: FaceDetection,
    frameWidth: number,
    frameHeight: number
  ): number {
    'worklet';
    if (!LivenessEngine.antiSpoofModel) return 0.5;

    // Crop face with 20% padding
    const pad = 0.2;
    const x = Math.max(0, face.x - face.width * pad);
    const y = Math.max(0, face.y - face.height * pad);
    const w = Math.min(frameWidth - x, face.width * (1 + 2 * pad));
    const h = Math.min(frameHeight - y, face.height * (1 + 2 * pad));

    const crop = LivenessEngine.cropResize(pixels, x, y, w, h, frameWidth, 80);

    // Normalize to [0,1]
    const input = new Float32Array(80 * 80 * 3);
    for (let i = 0; i < input.length; i++) input[i] = crop[i] / 255.0;

    const output = LivenessEngine.antiSpoofModel.runSync([input]);
    const result = output[0] as Float32Array;
    return result[0];
  }

  // Optical flow using Lucas-Kanade approximation
  public opticalFlowScore(
    pixels: Float32Array,
    frameWidth: number,
    frameHeight: number
  ): number {
    'worklet';
    if (!LivenessEngine.prevFrame || LivenessEngine.prevFrameW !== frameWidth) {
      LivenessEngine.prevFrame = new Float32Array(pixels);
      LivenessEngine.prevFrameW = frameWidth;
      return 0.5; // neutral on first frame
    }

    // Compute grayscale difference (proxy for motion)
    let totalMotion = 0;
    const step = 8; // Sample every 8th pixel for speed
    let count = 0;

    for (let i = 0; i < pixels.length - 2; i += step * 3) {
      const currGray = pixels[i] * 0.299 + pixels[i+1] * 0.587 + pixels[i+2] * 0.114;
      const prevGray = LivenessEngine.prevFrame[i] * 0.299 + LivenessEngine.prevFrame[i+1] * 0.587 + LivenessEngine.prevFrame[i+2] * 0.114;
      totalMotion += Math.abs(currGray - prevGray);
      count++;
    }

    LivenessEngine.prevFrame = new Float32Array(pixels);
    const avgMotion = totalMotion / (count * 255);

    // Real face: small but non-zero motion (0.05–0.3 range)
    // Static photo: near zero motion (< 0.02)
    // Video replay: can have motion but usually systematic
    if (avgMotion < LIVENESS_CONFIG.MAX_OPTICAL_FLOW_SPOOF) return 0.1; // likely spoof
    if (avgMotion > LIVENESS_CONFIG.MIN_OPTICAL_FLOW_REAL) return 0.9; // likely real
    return 0.5 + avgMotion * 5; // interpolate
  }

  // Local Binary Pattern texture analysis
  public lbpTextureScore(
    pixels: Float32Array,
    face: FaceDetection,
    frameWidth: number
  ): number {
    'worklet';
    const frameHeight = pixels.length / (frameWidth * 3);
    const x = Math.max(1, Math.floor(face.x));
    const y = Math.max(1, Math.floor(face.y));
    const w = Math.min(frameWidth - 1 - x, Math.floor(face.width));
    const h = Math.min(frameHeight - 1 - y, Math.floor(face.height));

    const histSize = 256;
    const hist = new Array(histSize).fill(0);
    let totalPixels = 0;

    // Compute LBP for each pixel in face ROI
    for (let py = y + 1; py < y + h - 1; py += 2) {
      for (let px = x + 1; px < x + w - 1; px += 2) {
        const centerIdx = (py * frameWidth + px) * 3;
        const center = pixels[centerIdx] * 0.299 + pixels[centerIdx+1] * 0.587 + pixels[centerIdx+2] * 0.114;

        let lbp = 0;
        if (LivenessEngine.getGray(pixels, px-1, py-1, frameWidth) >= center) lbp |= (1 << 0);
        if (LivenessEngine.getGray(pixels, px,   py-1, frameWidth) >= center) lbp |= (1 << 1);
        if (LivenessEngine.getGray(pixels, px+1, py-1, frameWidth) >= center) lbp |= (1 << 2);
        if (LivenessEngine.getGray(pixels, px+1, py,   frameWidth) >= center) lbp |= (1 << 3);
        if (LivenessEngine.getGray(pixels, px+1, py+1, frameWidth) >= center) lbp |= (1 << 4);
        if (LivenessEngine.getGray(pixels, px,   py+1, frameWidth) >= center) lbp |= (1 << 5);
        if (LivenessEngine.getGray(pixels, px-1, py+1, frameWidth) >= center) lbp |= (1 << 6);
        if (LivenessEngine.getGray(pixels, px-1, py,   frameWidth) >= center) lbp |= (1 << 7);
        hist[lbp]++;
        totalPixels++;
      }
    }

    // Entropy of LBP histogram — real skin has higher entropy
    let entropy = 0;
    for (let i = 0; i < histSize; i++) {
      if (hist[i] > 0) {
        const p = hist[i] / totalPixels;
        entropy -= p * Math.log2(p);
      }
    }

    // Printed/screen face: low entropy (uniform texture)
    // Real face: high entropy (organic texture variation)
    const normalizedEntropy = entropy / Math.log2(histSize); // normalize to [0,1]
    return normalizedEntropy > 0.6 ? 0.85 : normalizedEntropy < 0.35 ? 0.15 : normalizedEntropy;
  }

  private getGray(pixels: Float32Array, x: number, y: number, w: number): number {
    'worklet';
    const idx = (y * w + x) * 3;
    return pixels[idx] * 0.299 + pixels[idx+1] * 0.587 + pixels[idx+2] * 0.114;
  }

  // ─── Stage 2: Active Challenge ────────────────────────────────────────────

  startChallenge(seed?: number): LivenessChallenge[] {
    'worklet';
    // Seed-based randomization ensures challenges are unpredictable
    const s = seed ?? (Date.now() % 10000);
    const all: LivenessChallenge[] = ['BLINK', 'SMILE', 'TURN_LEFT', 'TURN_RIGHT', 'NOD'];
    const shuffled = LivenessEngine.seededShuffle(all, s);
    LivenessEngine.currentChallenges = shuffled.slice(0, LivenessEngine.challengeCountShared.value);
    LivenessEngine.challengeIndex = 0;
    LivenessEngine.blinkFrameCount = 0;
    LivenessEngine.smileFrameCount = 0;
    LivenessEngine.headTurnDetected = false;
    LivenessEngine.challengeStartTime = Date.now();
    return LivenessEngine.currentChallenges;
  }

  getCurrentChallenge(): LivenessChallenge | null {
    'worklet';
    if (LivenessEngine.challengeIndex >= LivenessEngine.currentChallenges.length) return null;
    return LivenessEngine.currentChallenges[LivenessEngine.challengeIndex];
  }

  // Check challenge progress (Async version for JS context)
  async checkChallenge(
    pixels: Float32Array,
    face: FaceDetection,
    frameWidth: number,
    frameHeight: number
  ): Promise<{ completed: boolean; timedOut: boolean; currentChallenge: LivenessChallenge | null }> {
    const elapsed = Date.now() - this.challengeStartTime;
    if (elapsed > LIVENESS_CONFIG.CHALLENGE_TIMEOUT_MS) {
      return { completed: false, timedOut: true, currentChallenge: null };
    }

    const mesh = await this.getFaceMesh(pixels, face, frameWidth, frameHeight);
    if (!mesh) return { completed: false, timedOut: false, currentChallenge: this.getCurrentChallenge() };

    const challenge = this.getCurrentChallenge();
    if (!challenge) return { completed: true, timedOut: false, currentChallenge: null };

    let challengePassed = false;

    switch (challenge) {
      case 'BLINK':
        challengePassed = this.checkBlink(mesh);
        break;
      case 'SMILE':
        challengePassed = this.checkSmile(mesh);
        break;
      case 'TURN_LEFT':
        challengePassed = this.checkHeadTurn(mesh, 'LEFT');
        break;
      case 'TURN_RIGHT':
        challengePassed = this.checkHeadTurn(mesh, 'RIGHT');
        break;
      case 'NOD':
        challengePassed = this.checkNod(mesh);
        break;
    }

    if (challengePassed) {
      this.challengeIndex++;
      this.blinkFrameCount = 0;
      this.smileFrameCount = 0;
      this.headTurnDetected = false;
      this.challengeStartTime = Date.now(); // reset timer for next challenge
    }

    const allDone = this.challengeIndex >= this.currentChallenges.length;
    return {
      completed: allDone,
      timedOut: false,
      currentChallenge: this.getCurrentChallenge(),
    };
  }

  private async getFaceMesh(
    pixels: Float32Array,
    face: FaceDetection,
    frameWidth: number,
    frameHeight: number
  ): Promise<FaceMeshLandmarks | null> {
    if (!this.faceMeshModel) return null;

    const crop = this.cropResize(
      pixels, face.x, face.y, face.width, face.height, frameWidth, 192
    );
    const input = new Float32Array(192 * 192 * 3);
    for (let i = 0; i < input.length; i++) input[i] = crop[i] / 255.0;

    const outputs = await this.faceMeshModel.run([input]);
    const landmarks = outputs[0] as Float32Array;

    const points: Point[] = [];
    for (let i = 0; i < 468; i++) {
      points.push({
        x: landmarks[i * 3] * face.width + face.x,
        y: landmarks[i * 3 + 1] * face.height + face.y,
      });
    }

    const LEFT_EYE = [362,382,381,380,374,373,390,249,263,466,388,387,386,385,384,398];
    const RIGHT_EYE = [33,7,163,144,145,153,154,155,133,173,157,158,159,160,161,246];
    const LIPS = [61,185,40,39,37,0,267,269,270,409,291,146,91,181,84,17,314,405,321,375];
    const NOSE_TIP = [1, 4, 5];

    return {
      points,
      leftEyePoints: LEFT_EYE.map(i => points[i]),
      rightEyePoints: RIGHT_EYE.map(i => points[i]),
      lipPoints: LIPS.map(i => points[i]),
      nosePoints: NOSE_TIP.map(i => points[i]),
    };
  }

  // Check challenge progress (Sync version for Worklet context)
  checkChallengeSync(
    pixels: Float32Array,
    face: FaceDetection,
    frameWidth: number,
    frameHeight: number
  ): { completed: boolean; timedOut: boolean; currentChallenge: LivenessChallenge | null } {
    'worklet';
    const elapsed = Date.now() - LivenessEngine.challengeStartTime;
    if (elapsed > LIVENESS_CONFIG.CHALLENGE_TIMEOUT_MS) {
      return { completed: false, timedOut: true, currentChallenge: null };
    }

    const mesh = LivenessEngine.getFaceMeshSync(pixels, face, frameWidth, frameHeight);
    if (!mesh) return { completed: false, timedOut: false, currentChallenge: LivenessEngine.getCurrentChallenge() };

    const challenge = LivenessEngine.getCurrentChallenge();
    if (!challenge) return { completed: true, timedOut: false, currentChallenge: null };

    let challengePassed = false;

    switch (challenge) {
      case 'BLINK':
        challengePassed = LivenessEngine.checkBlink(mesh);
        break;
      case 'SMILE':
        challengePassed = LivenessEngine.checkSmile(mesh);
        break;
      case 'TURN_LEFT':
        challengePassed = LivenessEngine.checkHeadTurn(mesh, 'LEFT');
        break;
      case 'TURN_RIGHT':
        challengePassed = LivenessEngine.checkHeadTurn(mesh, 'RIGHT');
        break;
      case 'NOD':
        challengePassed = LivenessEngine.checkNod(mesh);
        break;
    }

    if (challengePassed) {
      LivenessEngine.challengeIndex++;
      LivenessEngine.blinkFrameCount = 0;
      LivenessEngine.smileFrameCount = 0;
      LivenessEngine.headTurnDetected = false;
      LivenessEngine.challengeStartTime = Date.now(); // reset timer for next challenge
    }

    const allDone = LivenessEngine.challengeIndex >= LivenessEngine.currentChallenges.length;
    return {
      completed: allDone,
      timedOut: false,
      currentChallenge: LivenessEngine.getCurrentChallenge(),
    };
  }

  private getFaceMeshSync(
    pixels: Float32Array,
    face: FaceDetection,
    frameWidth: number,
    frameHeight: number
  ): FaceMeshLandmarks | null {
    'worklet';
    if (!LivenessEngine.faceMeshModel) return null;

    const crop = LivenessEngine.cropResize(
      pixels, face.x, face.y, face.width, face.height, frameWidth, 192
    );
    const input = new Float32Array(192 * 192 * 3);
    for (let i = 0; i < input.length; i++) input[i] = crop[i] / 255.0;

    const outputs = LivenessEngine.faceMeshModel.runSync([input]);
    const landmarks = outputs[0] as Float32Array;

    const points: Point[] = [];
    for (let i = 0; i < 468; i++) {
      points.push({
        x: landmarks[i * 3] * face.width + face.x,
        y: landmarks[i * 3 + 1] * face.height + face.y,
      });
    }

    const LEFT_EYE = [362,382,381,380,374,373,390,249,263,466,388,387,386,385,384,398];
    const RIGHT_EYE = [33,7,163,144,145,153,154,155,133,173,157,158,159,160,161,246];
    const LIPS = [61,185,40,39,37,0,267,269,270,409,291,146,91,181,84,17,314,405,321,375];
    const NOSE_TIP = [1, 4, 5];

    return {
      points,
      leftEyePoints: LEFT_EYE.map(i => points[i]),
      rightEyePoints: RIGHT_EYE.map(i => points[i]),
      lipPoints: LIPS.map(i => points[i]),
      nosePoints: NOSE_TIP.map(i => points[i]),
    };
  }

  private checkBlink(mesh: FaceMeshLandmarks): boolean {
    'worklet';
    const leftEAR = LivenessEngine.eyeAspectRatio(mesh.leftEyePoints);
    const rightEAR = LivenessEngine.eyeAspectRatio(mesh.rightEyePoints);
    const avgEAR = (leftEAR + rightEAR) / 2;

    if (avgEAR < LIVENESS_CONFIG.EAR_BLINK_THRESHOLD) {
      LivenessEngine.blinkFrameCount++;
    } else {
      if (LivenessEngine.blinkFrameCount >= LIVENESS_CONFIG.EAR_CONSECUTIVE_FRAMES) {
        return true; // blink completed
      }
      LivenessEngine.blinkFrameCount = 0;
    }
    return false;
  }

  // Eye Aspect Ratio using 6 landmarks per eye
  private eyeAspectRatio(eyePoints: Point[]): number {
    'worklet';
    if (eyePoints.length < 6) return 0.3;
    const A = LivenessEngine.dist(eyePoints[1], eyePoints[5]);
    const B = LivenessEngine.dist(eyePoints[2], eyePoints[4]);
    const C = LivenessEngine.dist(eyePoints[0], eyePoints[3]);
    return (A + B) / (2.0 * C);
  }

  private checkSmile(mesh: FaceMeshLandmarks): boolean {
    'worklet';
    if (mesh.lipPoints.length < 12) return false;
    // Ratio of mouth width to inter-eye distance
    const mouthWidth = LivenessEngine.dist(mesh.lipPoints[0], mesh.lipPoints[6]);
    const eyeWidth = LivenessEngine.dist(
      mesh.leftEyePoints[0],
      mesh.rightEyePoints[3]
    );
    const ratio = mouthWidth / Math.max(eyeWidth, 1);

    if (ratio > LIVENESS_CONFIG.SMILE_THRESHOLD) {
      LivenessEngine.smileFrameCount++;
      if (LivenessEngine.smileFrameCount >= 3) return true;
    } else {
      LivenessEngine.smileFrameCount = 0;
    }
    return false;
  }

  private checkHeadTurn(mesh: FaceMeshLandmarks, direction: 'LEFT' | 'RIGHT'): boolean {
    'worklet';
    // Estimate yaw using nose tip relative to face midpoint
    const noseTip = mesh.nosePoints[0];
    const leftEyeCenter = LivenessEngine.centroid(mesh.leftEyePoints);
    const rightEyeCenter = LivenessEngine.centroid(mesh.rightEyePoints);
    const faceMidX = (leftEyeCenter.x + rightEyeCenter.x) / 2;
    const faceWidth = Math.abs(rightEyeCenter.x - leftEyeCenter.x);

    // Normalized nose offset: >0 = face turned right, <0 = turned left
    const noseOffset = (noseTip.x - faceMidX) / Math.max(faceWidth, 1);

    const threshold = LIVENESS_CONFIG.HEAD_TURN_ANGLE / 90;
    if (direction === 'RIGHT' && noseOffset > threshold) return true;
    if (direction === 'LEFT' && noseOffset < -threshold) return true;
    return false;
  }

  private checkNod(mesh: FaceMeshLandmarks): boolean {
    'worklet';
    if (mesh.nosePoints.length < 1) return false;
    const noseTip = mesh.nosePoints[0];
    const leftEye = LivenessEngine.centroid(mesh.leftEyePoints);
    const rightEye = LivenessEngine.centroid(mesh.rightEyePoints);
    const faceWidth = Math.abs(rightEye.x - leftEye.x);
    
    const noseToEyeDist = noseTip.y - leftEye.y;
    // Normalize nose-to-eye vertical distance by face width to make it scale-invariant
    const normalizedDist = noseToEyeDist / Math.max(faceWidth, 1);
    return normalizedDist > 0.65;
  }

  // ─── Full Liveness Assessment (Async version for JS context) ─────────────

  async assessLiveness(
    pixels: Float32Array,
    face: FaceDetection,
    frameWidth: number,
    frameHeight: number,
    activeCompleted: boolean
  ): Promise<LivenessResult> {
    const passiveScore = await this.runPassiveLiveness(pixels, face, frameWidth, frameHeight);
    const spoofDetected = passiveScore < MODEL_CONFIG.SPOOF_THRESHOLD;
    const activeScore = activeCompleted ? 1.0 : 0.0;
    const totalScore = passiveScore * 0.6 + activeScore * 0.4;

    return {
      passed: !spoofDetected && activeCompleted && totalScore > 0.65,
      score: totalScore,
      passiveScore,
      activeScore,
      spoofDetected,
    };
  }

  // ─── Full Liveness Assessment (Sync version for Worklet context) ──────────

  assessLivenessSync(
    pixels: Float32Array,
    face: FaceDetection,
    frameWidth: number,
    frameHeight: number,
    activeCompleted: boolean
  ): LivenessResult {
    'worklet';
    const passiveScore = LivenessEngine.runPassiveLivenessSync(pixels, face, frameWidth, frameHeight);
    const spoofDetected = passiveScore < MODEL_CONFIG.SPOOF_THRESHOLD;
    const activeScore = activeCompleted ? 1.0 : 0.0;
    const totalScore = passiveScore * 0.6 + activeScore * 0.4;

    return {
      passed: !spoofDetected && activeCompleted && totalScore > 0.65,
      score: totalScore,
      passiveScore,
      activeScore,
      spoofDetected,
    };
  }

  // ─── Helper Utilities ─────────────────────────────────────────────────────

  private dist(a: Point, b: Point): number {
    'worklet';
    return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
  }

  private centroid(points: Point[]): Point {
    'worklet';
    return {
      x: points.reduce((s, p) => s + p.x, 0) / points.length,
      y: points.reduce((s, p) => s + p.y, 0) / points.length,
    };
  }

  private cropResize(
    pixels: Float32Array, x: number, y: number,
    w: number, h: number, frameWidth: number, targetSize: number
  ): Float32Array {
    'worklet';
    const frameHeight = pixels.length / (frameWidth * 3);
    const output = new Float32Array(targetSize * targetSize * 3);
    const scaleX = w / targetSize, scaleY = h / targetSize;

    for (let dy = 0; dy < targetSize; dy++) {
      for (let dx = 0; dx < targetSize; dx++) {
        const sx = Math.round(x + dx * scaleX);
        const sy = Math.round(y + dy * scaleY);
        const dstIdx = (dy * targetSize + dx) * 3;
        
        let r = 0, g = 0, b = 0;
        if (sx >= 0 && sx < frameWidth && sy >= 0 && sy < frameHeight) {
          const srcIdx = (sy * frameWidth + sx) * 3;
          r = pixels[srcIdx];
          g = pixels[srcIdx+1];
          b = pixels[srcIdx+2];
        }
        
        output[dstIdx] = r;
        output[dstIdx+1] = g;
        output[dstIdx+2] = b;
      }
    }
    return output;
  }

  private seededShuffle<T>(arr: T[], seed: number): T[] {
    'worklet';
    const copy = [...arr];
    let s = seed;
    for (let i = copy.length - 1; i > 0; i--) {
      s = (s * 9301 + 49297) % 233280; // LCG
      const j = Math.floor((s / 233280) * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  resetOpticalFlow(): void {
    'worklet';
    LivenessEngine.prevFrame = null;
  }
}

export const LivenessEngine = new LivenessEngineService();
