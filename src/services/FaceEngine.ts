// src/services/FaceEngine.ts
// Core AI inference engine — AdaFace + YOLOv8-face via TFLite

import { loadTensorflowModel, TensorflowModel } from 'react-native-fast-tflite';
import { Worklets } from 'react-native-worklets-core';
import { MODEL_CONFIG, QUALITY_CONFIG } from '../constants';
import type {
  FaceDetection,
  FaceEmbedding,
  QualityResult,
  RecognitionResult,
  FaceLandmarks,
  Point,
} from '../types';

class FaceEngineService {
  public detectionModel: TensorflowModel | null = null;
  public recognitionModel: TensorflowModel | null = null;
  private isInitialized = false;

  // Shared values to synchronize embeddings and threshold between JS and Worklet runtimes
  public storedEmbeddings = Worklets.createSharedValue<FaceEmbedding[]>([]);
  public recognitionThreshold = Worklets.createSharedValue<number>(MODEL_CONFIG.RECOGNITION_THRESHOLD);

  setThreshold(val: number) {
    this.recognitionThreshold.value = val;
    console.log(`[FaceEngine] Recognition threshold set to: ${val}`);
  }

  // ─── Initialization ───────────────────────────────────────────────────────

  async initialize(): Promise<void> {
    if (this.isInitialized) return;
    try {
      console.log('[FaceEngine] Loading models...');

      // Load models from app bundle assets
      this.detectionModel = await loadTensorflowModel(
        require('../../models/yolov8_face_nano_int8.tflite'),
        'default' // uses NNAPI on Android, CoreML on iOS automatically
      );

      this.recognitionModel = await loadTensorflowModel(
        require('../../models/adaface_mobilone_s0_int8.tflite'),
        'default'
      );

      this.isInitialized = true;
      console.log('[FaceEngine] ✅ Models loaded successfully');
    } catch (error) {
      console.error('[FaceEngine] ❌ Model loading failed:', error);
      throw new Error('Failed to initialize face recognition engine');
    }
  }

  // ─── Face Detection (Async version for JS context) ─────────────────────────

  async detectFace(
    pixelBuffer: Float32Array,
    frameWidth: number,
    frameHeight: number
  ): Promise<FaceDetection | null> {
    if (!this.detectionModel) throw new Error('Detection model not loaded');

    const inputSize = MODEL_CONFIG.DETECTION_INPUT_SIZE;

    // Resize frame to 320x320 for YOLOv8-face nano
    const resizedBuffer = this.bilinearResize(
      pixelBuffer, frameWidth, frameHeight, inputSize, inputSize
    );

    // Normalize to [0, 1]
    const normalizedInput = new Float32Array(inputSize * inputSize * 3);
    for (let i = 0; i < normalizedInput.length; i++) {
      normalizedInput[i] = resizedBuffer[i] / 255.0;
    }

    // Run inference — YOLOv8-face output: [1, 20, 8400] (cx,cy,w,h,conf,lm1x,lm1y,...5landmarks)
    const outputs = await this.detectionModel.run([normalizedInput]);
    const detections = outputs[0] as Float32Array;

    return this.parseYOLOFaceOutput(
      detections, frameWidth, frameHeight, inputSize
    );
  }

  // ─── Face Detection (Sync version for Worklet context) ─────────────────────

  detectFaceSync(
    pixelBuffer: Float32Array,
    frameWidth: number,
    frameHeight: number
  ): FaceDetection | null {
    'worklet';
    if (!FaceEngine.detectionModel) return null;

    const inputSize = MODEL_CONFIG.DETECTION_INPUT_SIZE;

    // Resize frame to 320x320 for YOLOv8-face nano
    const resizedBuffer = FaceEngine.bilinearResize(
      pixelBuffer, frameWidth, frameHeight, inputSize, inputSize
    );

    // Normalize to [0, 1]
    const normalizedInput = new Float32Array(inputSize * inputSize * 3);
    for (let i = 0; i < normalizedInput.length; i++) {
      normalizedInput[i] = resizedBuffer[i] / 255.0;
    }

    // Run inference synchronously inside worklet
    const outputs = FaceEngine.detectionModel.runSync([normalizedInput]);
    const detections = outputs[0] as Float32Array;

    return FaceEngine.parseYOLOFaceOutput(
      detections, frameWidth, frameHeight, inputSize
    );
  }

  private parseYOLOFaceOutput(
    output: Float32Array,
    origW: number,
    origH: number,
    inputSize: number
  ): FaceDetection | null {
    'worklet';
    // output shape: [20, 8400] transposed → we iterate predictions
    // Each col: [cx, cy, w, h, conf, lm0x, lm0y, lm1x, lm1y, ... lm4x, lm4y]
    const numPredictions = 8400;
    const bestConfThreshold = MODEL_CONFIG.DETECTION_CONFIDENCE_THRESHOLD;
    let bestConf = bestConfThreshold;
    let bestFace: FaceDetection | null = null;

    const scaleX = origW / inputSize;
    const scaleY = origH / inputSize;

    for (let i = 0; i < numPredictions; i++) {
      const conf = output[4 * numPredictions + i]; // confidence at index 4
      if (conf < bestConf) continue;

      const cx = output[0 * numPredictions + i] * scaleX;
      const cy = output[1 * numPredictions + i] * scaleY;
      const w = output[2 * numPredictions + i] * scaleX;
      const h = output[3 * numPredictions + i] * scaleY;

      const x = cx - w / 2;
      const y = cy - h / 2;

      // 5 landmark points (skipping visibility/confidence rows)
      const landmarks: FaceLandmarks = {
        leftEye: {
          x: output[5 * numPredictions + i] * scaleX,
          y: output[6 * numPredictions + i] * scaleY,
        },
        rightEye: {
          x: output[8 * numPredictions + i] * scaleX,
          y: output[9 * numPredictions + i] * scaleY,
        },
        nose: {
          x: output[11 * numPredictions + i] * scaleX,
          y: output[12 * numPredictions + i] * scaleY,
        },
        leftMouth: {
          x: output[14 * numPredictions + i] * scaleX,
          y: output[15 * numPredictions + i] * scaleY,
        },
        rightMouth: {
          x: output[17 * numPredictions + i] * scaleX,
          y: output[18 * numPredictions + i] * scaleY,
        },
      };

      bestConf = conf;
      bestFace = { x, y, width: w, height: h, confidence: conf, landmarks };
    }

    return bestFace;
  }

  // ─── Face Quality Check ────────────────────────────────────────────────────

  checkFaceQuality(
    pixelBuffer: Float32Array,
    face: FaceDetection,
    frameWidth: number,
    frameHeight: number
  ): QualityResult {
    'worklet';
    // 1. Size check
    const faceSize = Math.min(face.width, face.height);
    if (faceSize < QUALITY_CONFIG.MIN_FACE_SIZE_PX) {
      return { pass: false, score: 0, reason: 'Move closer to camera',
               blur: 0, brightness: 0, faceSize };
    }

    // 2. Center check — face should be roughly centered
    const centerX = face.x + face.width / 2;
    const centerY = face.y + face.height / 2;
    const dx = Math.abs(centerX / frameWidth - 0.5);
    const dy = Math.abs(centerY / frameHeight - 0.5);
    if (dx > QUALITY_CONFIG.FACE_CENTER_TOLERANCE ||
        dy > QUALITY_CONFIG.FACE_CENTER_TOLERANCE) {
      return { pass: false, score: 0.3, reason: 'Center your face',
               blur: 0, brightness: 0, faceSize };
    }

    // 3. Extract face ROI pixels
    const roiX = Math.max(0, Math.floor(face.x));
    const roiY = Math.max(0, Math.floor(face.y));
    const roiW = Math.min(frameWidth - roiX, Math.ceil(face.width));
    const roiH = Math.min(frameHeight - roiY, Math.ceil(face.height));
    const roi = FaceEngine.extractROI(pixelBuffer, face, frameWidth, frameHeight);

    // 4. Brightness check (mean pixel value)
    const brightness = roi.reduce((a, b) => a + b, 0) / roi.length;
    if (brightness < QUALITY_CONFIG.MIN_BRIGHTNESS) {
      return { pass: false, score: 0.4, reason: 'Too dark — find better lighting',
               blur: 0, brightness, faceSize };
    }
    if (brightness > QUALITY_CONFIG.MAX_BRIGHTNESS) {
      return { pass: false, score: 0.4, reason: 'Too bright — avoid direct light',
               blur: 0, brightness, faceSize };
    }

    // 5. Blur check — Laplacian variance (using integer bounds roiW and roiH)
    const blur = FaceEngine.laplacianVariance(roi, roiW, roiH);
    if (blur < QUALITY_CONFIG.MIN_BLUR_SCORE) {
      return { pass: false, score: 0.5, reason: 'Image too blurry — hold still',
               blur, brightness, faceSize };
    }

    const score = Math.min(1.0,
      (blur / 300) * 0.4 + ((brightness - 35) / 185) * 0.3 + (faceSize / 200) * 0.3
    );

    return { pass: true, score, blur, brightness, faceSize };
  }

  // Laplacian variance for blur detection
  private laplacianVariance(pixels: Float32Array, width: number, height: number): number {
    'worklet';
    const kernel = [0, 1, 0, 1, -4, 1, 0, 1, 0];
    let sum = 0, sumSq = 0;
    const n = (width - 2) * (height - 2);
    if (n <= 0) return 0;

    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        let laplacian = 0;
        for (let ky = -1; ky <= 1; ky++) {
          for (let kx = -1; kx <= 1; kx++) {
            const pidx = (y + ky) * width + (x + kx);
            // Average RGB channels for grayscale approximation
            const gray = (pixels[pidx * 3] * 0.299 +
                          pixels[pidx * 3 + 1] * 0.587 +
                          pixels[pidx * 3 + 2] * 0.114);
            laplacian += gray * kernel[(ky + 1) * 3 + (kx + 1)];
          }
        }
        sum += laplacian;
        sumSq += laplacian * laplacian;
      }
    }
    const mean = sum / n;
    return sumSq / n - mean * mean; // variance
  }

  // ─── Face Recognition (Async version for JS context) ──────────────────────

  async extractEmbedding(
    pixelBuffer: Float32Array,
    face: FaceDetection,
    frameWidth: number
  ): Promise<number[]> {
    if (!this.recognitionModel) throw new Error('Recognition model not loaded');

    // 1. Align face using 5-point landmarks (similarity transform)
    const aligned = this.alignFace(pixelBuffer, face, frameWidth);

    // 2. Normalize to [-1, 1] for AdaFace
    const normalized = new Float32Array(112 * 112 * 3);
    for (let i = 0; i < 112 * 112 * 3; i++) {
      normalized[i] = (aligned[i] / 127.5) - 1.0;
    }

    // 3. Run AdaFace inference
    const outputs = await this.recognitionModel.run([normalized]);
    const rawEmbedding = Array.from(outputs[0] as Float32Array);

    // 4. L2 normalize embedding
    return this.l2Normalize(rawEmbedding);
  }

  async recognizeFace(
    pixelBuffer: Float32Array,
    face: FaceDetection,
    frameWidth: number
  ): Promise<RecognitionResult> {
    const startTime = Date.now();

    if (this.storedEmbeddings.value.length === 0) {
      return { matched: false, confidence: 0, processingTimeMs: Date.now() - startTime };
    }

    const queryEmbedding = await this.extractEmbedding(pixelBuffer, face, frameWidth);

    let bestMatch: FaceEmbedding | null = null;
    let bestScore = -1;

    for (const stored of this.storedEmbeddings.value) {
      const similarity = this.cosineSimilarity(queryEmbedding, stored.embedding);
      if (similarity > bestScore) {
        bestScore = similarity;
        bestMatch = stored;
      }
    }

    const processingTimeMs = Date.now() - startTime;

    if (bestScore >= this.recognitionThreshold.value && bestMatch) {
      return {
        matched: true,
        userId: bestMatch.userId,
        userName: bestMatch.userName,
        employeeId: bestMatch.employeeId,
        confidence: bestScore,
        processingTimeMs,
      };
    }

    return { matched: false, confidence: bestScore, processingTimeMs };
  }

  // ─── Face Recognition (Sync version for Worklet context) ──────────────────

  extractEmbeddingSync(
    pixelBuffer: Float32Array,
    face: FaceDetection,
    frameWidth: number
  ): number[] {
    'worklet';
    if (!FaceEngine.recognitionModel) return [];

    // 1. Align face using 5-point landmarks (similarity transform)
    const aligned = FaceEngine.alignFace(pixelBuffer, face, frameWidth);

    // 2. Normalize to [-1, 1] for AdaFace
    const normalized = new Float32Array(112 * 112 * 3);
    for (let i = 0; i < 112 * 112 * 3; i++) {
      normalized[i] = (aligned[i] / 127.5) - 1.0;
    }

    // 3. Run AdaFace inference synchronously
    const outputs = FaceEngine.recognitionModel.runSync([normalized]);
    const rawEmbedding = Array.from(outputs[0] as Float32Array);

    // 4. L2 normalize embedding
    return FaceEngine.l2Normalize(rawEmbedding);
  }

  recognizeFaceSync(
    pixelBuffer: Float32Array,
    face: FaceDetection,
    frameWidth: number
  ): RecognitionResult {
    'worklet';
    const startTime = Date.now();

    if (FaceEngine.storedEmbeddings.value.length === 0) {
      return { matched: false, confidence: 0, processingTimeMs: Date.now() - startTime };
    }

    const queryEmbedding = FaceEngine.extractEmbeddingSync(pixelBuffer, face, frameWidth);
    if (queryEmbedding.length === 0) {
      return { matched: false, confidence: 0, processingTimeMs: Date.now() - startTime };
    }

    let bestMatch: FaceEmbedding | null = null;
    let bestScore = -1;

    for (const stored of FaceEngine.storedEmbeddings.value) {
      const similarity = FaceEngine.cosineSimilarity(queryEmbedding, stored.embedding);
      if (similarity > bestScore) {
        bestScore = similarity;
        bestMatch = stored;
      }
    }

    const processingTimeMs = Date.now() - startTime;

    if (bestScore >= FaceEngine.recognitionThreshold.value && bestMatch) {
      return {
        matched: true,
        userId: bestMatch.userId,
        userName: bestMatch.userName,
        employeeId: bestMatch.employeeId,
        confidence: bestScore,
        processingTimeMs,
      };
    }

    return { matched: false, confidence: bestScore, processingTimeMs };
  }

  // ─── Match pre-computed embedding against stored (JS thread) ────────────

  matchEmbedding(queryEmbedding: number[]): RecognitionResult {
    const startTime = Date.now();

    if (this.storedEmbeddings.value.length === 0) {
      return { matched: false, confidence: 0, processingTimeMs: Date.now() - startTime };
    }

    let bestMatch: FaceEmbedding | null = null;
    let bestScore = -1;

    for (const stored of this.storedEmbeddings.value) {
      const similarity = this.cosineSimilarity(queryEmbedding, stored.embedding);
      if (similarity > bestScore) {
        bestScore = similarity;
        bestMatch = stored;
      }
    }

    const processingTimeMs = Date.now() - startTime;

    if (bestScore >= this.recognitionThreshold.value && bestMatch) {
      return {
        matched: true,
        userId: bestMatch.userId,
        userName: bestMatch.userName,
        employeeId: bestMatch.employeeId,
        confidence: bestScore,
        processingTimeMs,
      };
    }

    return { matched: false, confidence: bestScore, processingTimeMs };
  }

  // ─── Math Utilities ────────────────────────────────────────────────────────

  private cosineSimilarity(a: number[], b: number[]): number {
    'worklet';
    let dot = 0;
    for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
    // Vectors are already L2-normalized, so dot product = cosine similarity
    return dot;
  }

  private l2Normalize(v: number[]): number[] {
    'worklet';
    const norm = Math.sqrt(v.reduce((sum, x) => sum + x * x, 0));
    return v.map(x => x / (norm + 1e-10));
  }

  // 5-point face alignment via similarity transform
  private alignFace(
    pixels: Float32Array,
    face: FaceDetection,
    frameWidth: number
  ): Float32Array {
    'worklet';
    const frameHeight = pixels.length / (frameWidth * 3);
    // Standard aligned face coordinates for 112x112 (ArcFace standard)
    const refPoints = [
      { x: 30.2946, y: 51.6963 }, // left eye
      { x: 65.5318, y: 51.5014 }, // right eye
      { x: 48.0252, y: 71.7366 }, // nose
      { x: 33.5493, y: 92.3655 }, // left mouth
      { x: 62.7299, y: 92.2041 }, // right mouth
    ];
    const srcPoints = [
      face.landmarks.leftEye, face.landmarks.rightEye,
      face.landmarks.nose, face.landmarks.leftMouth, face.landmarks.rightMouth,
    ];

    // Estimate similarity transform (scale + rotation + translation)
    const { scale, angle, tx, ty } = FaceEngine.estimateSimilarityTransform(srcPoints, refPoints);

    // Apply transform and sample 112x112 crop
    const output = new Float32Array(112 * 112 * 3);
    const safeScale = Math.max(scale, 1e-6);
    const cos = Math.cos(-angle) / safeScale;
    const sin = Math.sin(-angle) / safeScale;

    for (let dy = 0; dy < 112; dy++) {
      for (let dx = 0; dx < 112; dx++) {
        // Inverse transform: dst → src
        const srcX = cos * (dx - tx) - sin * (dy - ty);
        const srcY = sin * (dx - tx) + cos * (dy - ty);

        const sx = Math.round(srcX);
        const sy = Math.round(srcY);
        const dstIdx = (dy * 112 + dx) * 3;

        if (sx >= 0 && sx < frameWidth && sy >= 0 && sy < frameHeight) {
          const srcIdx = (sy * frameWidth + sx) * 3;
          output[dstIdx] = pixels[srcIdx];
          output[dstIdx + 1] = pixels[srcIdx + 1];
          output[dstIdx + 2] = pixels[srcIdx + 2];
        }
      }
    }
    return output;
  }

  private estimateSimilarityTransform(src: Point[], dst: Point[]) {
    'worklet';
    // Mean-centered similarity transform estimation
    const srcMean = { x: src.reduce((s, p) => s + p.x, 0) / src.length,
                      y: src.reduce((s, p) => s + p.y, 0) / src.length };
    const dstMean = { x: dst.reduce((s, p) => s + p.x, 0) / dst.length,
                      y: dst.reduce((s, p) => s + p.y, 0) / dst.length };

    let num = 0, den = 0;
    for (let i = 0; i < src.length; i++) {
      const sx = src[i].x - srcMean.x, sy = src[i].y - srcMean.y;
      const dx = dst[i].x - dstMean.x, dy = dst[i].y - dstMean.y;
      num += sx * dy - sy * dx;
      den += sx * dx + sy * dy;
    }

    const angle = Math.atan2(num, den);
    const scale = Math.sqrt(num * num + den * den) /
                  src.reduce((s, p) => s + (p.x - srcMean.x) ** 2 + (p.y - srcMean.y) ** 2, 0);

    return {
      angle,
      scale,
      tx: dstMean.x - scale * (Math.cos(angle) * srcMean.x - Math.sin(angle) * srcMean.y),
      ty: dstMean.y - scale * (Math.sin(angle) * srcMean.x + Math.cos(angle) * srcMean.y),
    };
  }

  // Bilinear resize
  private bilinearResize(
    src: Float32Array, srcW: number, srcH: number,
    dstW: number, dstH: number
  ): Float32Array {
    'worklet';
    const dst = new Float32Array(dstW * dstH * 3);
    const scaleX = srcW / dstW, scaleY = srcH / dstH;

    for (let dy = 0; dy < dstH; dy++) {
      for (let dx = 0; dx < dstW; dx++) {
        const srcX = dx * scaleX, srcY = dy * scaleY;
        const x0 = Math.floor(srcX), y0 = Math.floor(srcY);
        const x1 = Math.min(x0 + 1, srcW - 1), y1 = Math.min(y0 + 1, srcH - 1);
        const fx = srcX - x0, fy = srcY - y0;

        for (let c = 0; c < 3; c++) {
          dst[(dy * dstW + dx) * 3 + c] =
            (1 - fx) * (1 - fy) * src[(y0 * srcW + x0) * 3 + c] +
            fx * (1 - fy) * src[(y0 * srcW + x1) * 3 + c] +
            (1 - fx) * fy * src[(y1 * srcW + x0) * 3 + c] +
            fx * fy * src[(y1 * srcW + x1) * 3 + c];
        }
      }
    }
    return dst;
  }

  private extractROI(
    pixels: Float32Array,
    face: FaceDetection,
    frameWidth: number,
    frameHeight: number
  ): Float32Array {
    'worklet';
    const x = Math.max(0, Math.min(frameWidth, Math.floor(face.x)));
    const y = Math.max(0, Math.min(frameHeight, Math.floor(face.y)));
    const w = Math.max(0, Math.min(frameWidth - x, Math.ceil(face.width)));
    const h = Math.max(0, Math.min(frameHeight - y, Math.ceil(face.height)));
    const roi = new Float32Array(w * h * 3);

    for (let row = 0; row < h; row++) {
      for (let col = 0; col < w; col++) {
        const srcIdx = ((y + row) * frameWidth + (x + col)) * 3;
        const dstIdx = (row * w + col) * 3;
        roi[dstIdx] = pixels[srcIdx];
        roi[dstIdx + 1] = pixels[srcIdx + 1];
        roi[dstIdx + 2] = pixels[srcIdx + 2];
      }
    }
    return roi;
  }

  // ─── Embedding Management ──────────────────────────────────────────────────

  loadEmbeddings(embeddings: FaceEmbedding[]): void {
    this.storedEmbeddings.value = embeddings;
    console.log(`[FaceEngine] Loaded ${embeddings.length} face embeddings`);
  }

  addEmbedding(embedding: FaceEmbedding): void {
    // Remove existing enrollment for same user if any
    this.storedEmbeddings.value = [
      ...this.storedEmbeddings.value.filter(e => e.userId !== embedding.userId),
      embedding
    ];
  }

  getEmbeddingCount(): number {
    return this.storedEmbeddings.value.length;
  }

  destroy(): void {
    this.detectionModel = null;
    this.recognitionModel = null;
    this.isInitialized = false;
  }
}

export const FaceEngine = new FaceEngineService();
