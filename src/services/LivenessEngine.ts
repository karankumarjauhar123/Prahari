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

  // Optical flow state (Shared values to synchronize between JS and Worklet threads)
  public prevFrameShared = Worklets.createSharedValue<Float32Array | null>(null);
  public prevFrameWShared = Worklets.createSharedValue<number>(0);

  // Active challenge state (Shared values to synchronize between JS and Worklet threads)
  public currentChallengesShared = Worklets.createSharedValue<LivenessChallenge[]>([]);
  public challengeIndexShared = Worklets.createSharedValue<number>(0);
  public blinkFrameCountShared = Worklets.createSharedValue<number>(0);
  public smileFrameCountShared = Worklets.createSharedValue<number>(0);
  public headTurnDetectedShared = Worklets.createSharedValue<boolean>(false);
  public challengeStartTimeShared = Worklets.createSharedValue<number>(0);
  public nodBaselineShared = Worklets.createSharedValue<number>(-1);

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
    const x = Math.max(0, Math.min(frameWidth, face.x - face.width * pad));
    const y = Math.max(0, Math.min(frameHeight, face.y - face.height * pad));
    const w = Math.max(0, Math.min(frameWidth - x, face.width * (1 + 2 * pad)));
    const h = Math.max(0, Math.min(frameHeight - y, face.height * (1 + 2 * pad)));

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
    frameHeight: number,
    antiSpoofModel: TensorflowModel
  ): number {
    'worklet';
    const scores: number[] = [];

    // A) Anti-spoof deep model score
    scores.push(LivenessEngine.antiSpoofScoreSync(pixels, face, frameWidth, frameHeight, antiSpoofModel));

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
    frameHeight: number,
    antiSpoofModel: TensorflowModel
  ): number {
    'worklet';
    if (!antiSpoofModel) return 0.5;

    // Crop face with 20% padding
    const pad = 0.2;
    const x = Math.max(0, Math.min(frameWidth, face.x - face.width * pad));
    const y = Math.max(0, Math.min(frameHeight, face.y - face.height * pad));
    const w = Math.max(0, Math.min(frameWidth - x, face.width * (1 + 2 * pad)));
    const h = Math.max(0, Math.min(frameHeight - y, face.height * (1 + 2 * pad)));

    const crop = LivenessEngine.cropResize(pixels, x, y, w, h, frameWidth, 80);

    // Normalize to [0,1]
    const input = new Float32Array(80 * 80 * 3);
    for (let i = 0; i < input.length; i++) input[i] = crop[i] / 255.0;

    const output = antiSpoofModel.runSync([input]);
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
    if (!LivenessEngine.prevFrameShared.value || LivenessEngine.prevFrameWShared.value !== frameWidth || LivenessEngine.prevFrameShared.value.length !== pixels.length) {
      LivenessEngine.prevFrameShared.value = new Float32Array(pixels);
      LivenessEngine.prevFrameWShared.value = frameWidth;
      return 0.5; // neutral on first frame
    }

    // Compute grayscale difference (proxy for motion)
    let totalMotion = 0;
    const step = 8; // Sample every 8th pixel for speed
    let count = 0;

    const prevFrame = LivenessEngine.prevFrameShared.value;
    for (let i = 0; i < pixels.length - 2; i += step * 3) {
      const currGray = pixels[i] * 0.299 + pixels[i+1] * 0.587 + pixels[i+2] * 0.114;
      const prevGray = prevFrame[i] * 0.299 + prevFrame[i+1] * 0.587 + prevFrame[i+2] * 0.114;
      if (!Number.isNaN(currGray) && !Number.isNaN(prevGray)) {
        totalMotion += Math.abs(currGray - prevGray);
        count++;
      }
    }

    LivenessEngine.prevFrameShared.value.set(pixels);
    const avgMotion = count > 0 ? totalMotion / (count * 255) : 0;

    if (Number.isNaN(avgMotion)) return 0.5;

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
    const frameHeight = Math.floor(pixels.length / (frameWidth * 3));
    if (frameWidth <= 2 || frameHeight <= 2) return 0.1;
    const x = Math.max(1, Math.min(frameWidth - 2, Math.floor(face.x)));
    const y = Math.max(1, Math.min(frameHeight - 2, Math.floor(face.y)));
    const w = Math.max(1, Math.min(frameWidth - 1 - x, Math.floor(face.width)));
    const h = Math.max(1, Math.min(frameHeight - 1 - y, Math.floor(face.height)));

    const histSize = 256;
    const hist = new Uint32Array(histSize);
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
    if (totalPixels === 0) return 0.1;
    for (let i = 0; i < histSize; i++) {
      if (hist[i] > 0) {
        const p = hist[i] / totalPixels;
        entropy -= p * Math.log2(p);
      }
    }

    // Printed/screen face: low entropy (uniform texture)
    // Real face: high entropy (organic texture variation)
    const normalizedEntropy = entropy / Math.log2(histSize); // normalize to [0,1]
    if (Number.isNaN(normalizedEntropy)) return 0.5;
    return normalizedEntropy > 0.6 ? 0.85 : normalizedEntropy < 0.35 ? 0.15 : normalizedEntropy;
  }

  private getGray(pixels: Float32Array, x: number, y: number, w: number): number {
    'worklet';
    const idx = (y * w + x) * 3;
    const r = pixels[idx] ?? 0;
    const g = pixels[idx+1] ?? 0;
    const b = pixels[idx+2] ?? 0;
    return r * 0.299 + g * 0.587 + b * 0.114;
  }

  // ─── Stage 2: Active Challenge ────────────────────────────────────────────

  startChallenge(seed?: number): LivenessChallenge[] {
    'worklet';
    // Seed-based randomization ensures challenges are unpredictable
    const s = seed ?? (Date.now() % 10000);
    const all: LivenessChallenge[] = ['BLINK', 'SMILE', 'TURN_LEFT', 'TURN_RIGHT', 'NOD'];
    const shuffled = LivenessEngine.seededShuffle(all, s);
    LivenessEngine.currentChallengesShared.value = shuffled.slice(0, LivenessEngine.challengeCountShared.value);
    LivenessEngine.challengeIndexShared.value = 0;
    LivenessEngine.blinkFrameCountShared.value = 0;
    LivenessEngine.smileFrameCountShared.value = 0;
    LivenessEngine.headTurnDetectedShared.value = false;
    LivenessEngine.nodBaselineShared.value = -1;
    LivenessEngine.challengeStartTimeShared.value = Date.now();
    return LivenessEngine.currentChallengesShared.value;
  }

  getCurrentChallenge(): LivenessChallenge | null {
    'worklet';
    if (LivenessEngine.challengeIndexShared.value >= LivenessEngine.currentChallengesShared.value.length) return null;
    return LivenessEngine.currentChallengesShared.value[LivenessEngine.challengeIndexShared.value];
  }

  // Check challenge progress (Async version for JS context)
  async checkChallenge(
    pixels: Float32Array,
    face: FaceDetection,
    frameWidth: number,
    frameHeight: number
  ): Promise<{ completed: boolean; timedOut: boolean; currentChallenge: LivenessChallenge | null }> {
    const elapsed = Date.now() - this.challengeStartTimeShared.value;
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
      this.challengeIndexShared.value++;
      this.blinkFrameCountShared.value = 0;
      this.smileFrameCountShared.value = 0;
      this.headTurnDetectedShared.value = false;
      this.nodBaselineShared.value = -1;
      this.challengeStartTimeShared.value = Date.now(); // reset timer for next challenge
    }

    const allDone = this.challengeIndexShared.value >= this.currentChallengesShared.value.length;
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

    const x = Math.max(0, Math.min(frameWidth, face.x));
    const y = Math.max(0, Math.min(frameHeight, face.y));
    const w = Math.max(0, Math.min(frameWidth - x, face.width));
    const h = Math.max(0, Math.min(frameHeight - y, face.height));

    const crop = this.cropResize(
      pixels, x, y, w, h, frameWidth, 192
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
    frameHeight: number,
    faceMeshModel: TensorflowModel
  ): { completed: boolean; timedOut: boolean; currentChallenge: LivenessChallenge | null } {
    'worklet';
    const elapsed = Date.now() - LivenessEngine.challengeStartTimeShared.value;
    if (elapsed > LIVENESS_CONFIG.CHALLENGE_TIMEOUT_MS) {
      return { completed: false, timedOut: true, currentChallenge: null };
    }

    const mesh = LivenessEngine.getFaceMeshSync(pixels, face, frameWidth, frameHeight, faceMeshModel);
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
      LivenessEngine.challengeIndexShared.value++;
      LivenessEngine.blinkFrameCountShared.value = 0;
      LivenessEngine.smileFrameCountShared.value = 0;
      LivenessEngine.headTurnDetectedShared.value = false;
      LivenessEngine.nodBaselineShared.value = -1;
      LivenessEngine.challengeStartTimeShared.value = Date.now(); // reset timer for next challenge
    }

    const allDone = LivenessEngine.challengeIndexShared.value >= LivenessEngine.currentChallengesShared.value.length;
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
    frameHeight: number,
    faceMeshModel: TensorflowModel
  ): FaceMeshLandmarks | null {
    'worklet';
    if (!faceMeshModel) return null;

    const x = Math.max(0, Math.min(frameWidth, face.x));
    const y = Math.max(0, Math.min(frameHeight, face.y));
    const w = Math.max(0, Math.min(frameWidth - x, face.width));
    const h = Math.max(0, Math.min(frameHeight - y, face.height));

    const crop = LivenessEngine.cropResize(
      pixels, x, y, w, h, frameWidth, 192
    );
    const input = new Float32Array(192 * 192 * 3);
    for (let i = 0; i < input.length; i++) input[i] = crop[i] / 255.0;

    const outputs = faceMeshModel.runSync([input]);
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
    if (mesh.leftEyePoints.length < 14 || mesh.rightEyePoints.length < 14) return false;

    // Left Eye 6-Point EAR Map
    // p1 = 362 (index 0),  p2 = 385 (index 13), p3 = 387 (index 11)
    // p4 = 263 (index 8),  p5 = 381 (index 2),  p6 = 374 (index 4)
    const leftA = LivenessEngine.dist(mesh.leftEyePoints[13], mesh.leftEyePoints[4]);
    const leftB = LivenessEngine.dist(mesh.leftEyePoints[11], mesh.leftEyePoints[2]);
    const leftC = LivenessEngine.dist(mesh.leftEyePoints[0], mesh.leftEyePoints[8]);
    const leftEAR = (leftA + leftB) / (2.0 * Math.max(leftC, 1));

    // Right Eye 6-Point EAR Map
    // p1 = 33 (index 0),   p2 = 160 (index 13), p3 = 158 (index 11)
    // p4 = 133 (index 8),  p5 = 153 (index 5),  p6 = 145 (index 4)
    const rightA = LivenessEngine.dist(mesh.rightEyePoints[13], mesh.rightEyePoints[4]);
    const rightB = LivenessEngine.dist(mesh.rightEyePoints[11], mesh.rightEyePoints[5]);
    const rightC = LivenessEngine.dist(mesh.rightEyePoints[0], mesh.rightEyePoints[8]);
    const rightEAR = (rightA + rightB) / (2.0 * Math.max(rightC, 1));

    const avgEAR = (leftEAR + rightEAR) / 2;

    if (avgEAR < LIVENESS_CONFIG.EAR_BLINK_THRESHOLD) {
      LivenessEngine.blinkFrameCountShared.value++;
    } else {
      if (LivenessEngine.blinkFrameCountShared.value >= LIVENESS_CONFIG.EAR_CONSECUTIVE_FRAMES) {
        return true; // blink completed
      }
      LivenessEngine.blinkFrameCountShared.value = 0;
    }
    return false;
  }

  private checkSmile(mesh: FaceMeshLandmarks): boolean {
    'worklet';
    if (mesh.lipPoints.length < 12) return false;
    // Ratio of mouth width to inter-eye distance
    // mouth corner left: lipPoints[0] (61), right: lipPoints[10] (291)
    const mouthWidth = LivenessEngine.dist(mesh.lipPoints[0], mesh.lipPoints[10]);
    const eyeWidth = LivenessEngine.dist(
      mesh.leftEyePoints[0], // LEFT_EYE inner corner (362, index 0)
      mesh.rightEyePoints[8] // RIGHT_EYE inner corner (133, index 8)
    );
    const ratio = mouthWidth / Math.max(eyeWidth, 1);

    if (ratio > LIVENESS_CONFIG.SMILE_THRESHOLD) {
      LivenessEngine.smileFrameCountShared.value++;
      if (LivenessEngine.smileFrameCountShared.value >= 3) return true;
    } else {
      LivenessEngine.smileFrameCountShared.value = 0;
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
    
    if (LivenessEngine.nodBaselineShared.value < 0) {
      LivenessEngine.nodBaselineShared.value = normalizedDist;
      return false;
    }
    const deviation = Math.abs(normalizedDist - LivenessEngine.nodBaselineShared.value);
    const nodThreshold = 0.15; // 15% change in vertical nose-eye ratio
    return deviation > nodThreshold;
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
    activeCompleted: boolean,
    antiSpoofModel: TensorflowModel
  ): LivenessResult {
    'worklet';
    const passiveScore = LivenessEngine.runPassiveLivenessSync(pixels, face, frameWidth, frameHeight, antiSpoofModel);
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
    const len = Math.max(points.length, 1);
    return {
      x: points.reduce((s, p) => s + p.x, 0) / len,
      y: points.reduce((s, p) => s + p.y, 0) / len,
    };
  }

  private cropResize(
    pixels: Float32Array, x: number, y: number,
    w: number, h: number, frameWidth: number, targetSize: number
  ): Float32Array {
    'worklet';
    const frameHeight = Math.floor(pixels.length / (frameWidth * 3));
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
          r = pixels[srcIdx] ?? 0;
          g = pixels[srcIdx+1] ?? 0;
          b = pixels[srcIdx+2] ?? 0;
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
    LivenessEngine.prevFrameShared.value = null;
  }
}

export const LivenessEngine = new LivenessEngineService();
