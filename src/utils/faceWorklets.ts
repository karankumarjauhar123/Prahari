// src/utils/faceWorklets.ts
// Standalone worklet functions for face processing inside VisionCamera frame processors.
// These run synchronously on the worklet (camera) thread — no ArrayBuffer crosses to JS.

import { MODEL_CONFIG, QUALITY_CONFIG } from '../constants';
import type { FaceDetection, FaceLandmarks, QualityResult, Point } from '../types';

// ─── Bilinear Resize ────────────────────────────────────────────────────────

export function wBilinearResize(
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

// ─── YOLO Face Detection Output Parser ──────────────────────────────────────

export function wParseYOLOFaceOutput(
  output: Float32Array,
  origW: number,
  origH: number,
  inputSize: number
): FaceDetection | null {
  'worklet';
  const numPredictions = 8400;
  let bestConf = MODEL_CONFIG.DETECTION_CONFIDENCE_THRESHOLD;
  let bestFace: FaceDetection | null = null;
  const scaleX = origW / inputSize;
  const scaleY = origH / inputSize;

  for (let i = 0; i < numPredictions; i++) {
    const conf = output[4 * numPredictions + i];
    if (conf < bestConf) continue;

    const cx = output[0 * numPredictions + i] * scaleX;
    const cy = output[1 * numPredictions + i] * scaleY;
    const w = output[2 * numPredictions + i] * scaleX;
    const h = output[3 * numPredictions + i] * scaleY;
    const x = cx - w / 2;
    const y = cy - h / 2;

    const landmarks: FaceLandmarks = {
      leftEye:   { x: output[5 * numPredictions + i] * scaleX,  y: output[6 * numPredictions + i] * scaleY },
      rightEye:  { x: output[7 * numPredictions + i] * scaleX,  y: output[8 * numPredictions + i] * scaleY },
      nose:      { x: output[9 * numPredictions + i] * scaleX,  y: output[10 * numPredictions + i] * scaleY },
      leftMouth: { x: output[11 * numPredictions + i] * scaleX, y: output[12 * numPredictions + i] * scaleY },
      rightMouth:{ x: output[13 * numPredictions + i] * scaleX, y: output[14 * numPredictions + i] * scaleY },
    };

    bestConf = conf;
    bestFace = { x, y, width: w, height: h, confidence: conf, landmarks };
  }
  return bestFace;
}

// ─── Face Quality Check ─────────────────────────────────────────────────────

export function wCheckFaceQuality(
  pixelBuffer: Float32Array,
  face: FaceDetection,
  frameWidth: number,
  frameHeight: number
): QualityResult {
  'worklet';
  const faceSize = Math.min(face.width, face.height);
  if (faceSize < QUALITY_CONFIG.MIN_FACE_SIZE_PX) {
    return { pass: false, score: 0, reason: 'Move closer to camera', blur: 0, brightness: 0, faceSize };
  }

  const centerX = face.x + face.width / 2;
  const centerY = face.y + face.height / 2;
  const dx = Math.abs(centerX / frameWidth - 0.5);
  const dy = Math.abs(centerY / frameHeight - 0.5);
  if (dx > QUALITY_CONFIG.FACE_CENTER_TOLERANCE || dy > QUALITY_CONFIG.FACE_CENTER_TOLERANCE) {
    return { pass: false, score: 0.3, reason: 'Center your face', blur: 0, brightness: 0, faceSize };
  }

  const roiW = Math.min(frameWidth - Math.max(0, Math.floor(face.x)), Math.ceil(face.width));
  const roiH = Math.min(frameHeight - Math.max(0, Math.floor(face.y)), Math.ceil(face.height));
  const roi = wExtractROI(pixelBuffer, face, frameWidth, frameHeight);

  const brightness = roi.reduce((a: number, b: number) => a + b, 0) / roi.length;
  if (brightness < QUALITY_CONFIG.MIN_BRIGHTNESS) {
    return { pass: false, score: 0.4, reason: 'Too dark — find better lighting', blur: 0, brightness, faceSize };
  }
  if (brightness > QUALITY_CONFIG.MAX_BRIGHTNESS) {
    return { pass: false, score: 0.4, reason: 'Too bright — avoid direct light', blur: 0, brightness, faceSize };
  }

  const blur = wLaplacianVariance(roi, roiW, roiH);
  if (blur < QUALITY_CONFIG.MIN_BLUR_SCORE) {
    return { pass: false, score: 0.5, reason: 'Image too blurry — hold still', blur, brightness, faceSize };
  }

  const score = Math.min(1.0,
    (blur / 300) * 0.4 + ((brightness - 35) / 185) * 0.3 + (faceSize / 200) * 0.3
  );
  return { pass: true, score, blur, brightness, faceSize };
}

// ─── Extract ROI ────────────────────────────────────────────────────────────

export function wExtractROI(
  pixels: Float32Array, face: FaceDetection,
  frameWidth: number, frameHeight: number
): Float32Array {
  'worklet';
  const x = Math.max(0, Math.floor(face.x));
  const y = Math.max(0, Math.floor(face.y));
  const w = Math.min(frameWidth - x, Math.ceil(face.width));
  const h = Math.min(frameHeight - y, Math.ceil(face.height));
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

// ─── Laplacian Variance (blur detection) ────────────────────────────────────

export function wLaplacianVariance(pixels: Float32Array, width: number, height: number): number {
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
          const gray = pixels[pidx * 3] * 0.299 + pixels[pidx * 3 + 1] * 0.587 + pixels[pidx * 3 + 2] * 0.114;
          laplacian += gray * kernel[(ky + 1) * 3 + (kx + 1)];
        }
      }
      sum += laplacian;
      sumSq += laplacian * laplacian;
    }
  }
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

// ─── Similarity Transform Estimation ────────────────────────────────────────

export function wEstimateSimilarityTransform(src: Point[], dst: Point[]) {
  'worklet';
  const srcMean = {
    x: src.reduce((s: number, p: Point) => s + p.x, 0) / src.length,
    y: src.reduce((s: number, p: Point) => s + p.y, 0) / src.length,
  };
  const dstMean = {
    x: dst.reduce((s: number, p: Point) => s + p.x, 0) / dst.length,
    y: dst.reduce((s: number, p: Point) => s + p.y, 0) / dst.length,
  };
  let num = 0, den = 0;
  for (let i = 0; i < src.length; i++) {
    const sx = src[i].x - srcMean.x, sy = src[i].y - srcMean.y;
    const ddx = dst[i].x - dstMean.x, ddy = dst[i].y - dstMean.y;
    num += sx * ddy - sy * ddx;
    den += sx * ddx + sy * ddy;
  }
  const angle = Math.atan2(num, den);
  const scale = Math.sqrt(num * num + den * den) /
    src.reduce((s: number, p: Point) => s + (p.x - srcMean.x) ** 2 + (p.y - srcMean.y) ** 2, 0);
  return {
    angle, scale,
    tx: dstMean.x - scale * (Math.cos(angle) * srcMean.x - Math.sin(angle) * srcMean.y),
    ty: dstMean.y - scale * (Math.sin(angle) * srcMean.x + Math.cos(angle) * srcMean.y),
  };
}

// ─── Face Alignment (5-point) ───────────────────────────────────────────────

export function wAlignFace(
  pixels: Float32Array, face: FaceDetection, frameWidth: number
): Float32Array {
  'worklet';
  const frameHeight = pixels.length / (frameWidth * 3);
  const refPoints = [
    { x: 30.2946, y: 51.6963 }, { x: 65.5318, y: 51.5014 },
    { x: 48.0252, y: 71.7366 }, { x: 33.5493, y: 92.3655 },
    { x: 62.7299, y: 92.2041 },
  ];
  const srcPoints = [
    face.landmarks.leftEye, face.landmarks.rightEye,
    face.landmarks.nose, face.landmarks.leftMouth, face.landmarks.rightMouth,
  ];
  const { scale, angle, tx, ty } = wEstimateSimilarityTransform(srcPoints, refPoints);
  const output = new Float32Array(112 * 112 * 3);
  const cos = Math.cos(-angle) * scale;
  const sin = Math.sin(-angle) * scale;
  for (let dy = 0; dy < 112; dy++) {
    for (let dx = 0; dx < 112; dx++) {
      const srcX = cos * (dx - tx) - sin * (dy - ty);
      const srcY = sin * (dx - tx) + cos * (dy - ty);
      const sx = Math.round(srcX), sy = Math.round(srcY);
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

// ─── L2 Normalize ───────────────────────────────────────────────────────────

export function wL2Normalize(v: number[]): number[] {
  'worklet';
  const norm = Math.sqrt(v.reduce((sum: number, x: number) => sum + x * x, 0));
  return v.map((x: number) => x / (norm + 1e-10));
}

// ─── Cosine Similarity ──────────────────────────────────────────────────────

export function wCosineSimilarity(a: number[], b: number[]): number {
  'worklet';
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

// ─── Crop and Resize (for anti-spoof / face mesh) ───────────────────────────

export function wCropResize(
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

// ─── Full face detection pipeline (sync, worklet) ───────────────────────────

export function wDetectFace(
  pixels: Float32Array, width: number, height: number,
  detectionModel: any
): FaceDetection | null {
  'worklet';
  const inputSize = MODEL_CONFIG.DETECTION_INPUT_SIZE;
  const resized = wBilinearResize(pixels, width, height, inputSize, inputSize);
  const normalized = new Float32Array(inputSize * inputSize * 3);
  for (let i = 0; i < normalized.length; i++) normalized[i] = resized[i] / 255.0;
  const outputs = detectionModel.runSync([normalized]);
  return wParseYOLOFaceOutput(outputs[0] as Float32Array, width, height, inputSize);
}

// ─── Full embedding extraction pipeline (sync, worklet) ─────────────────────

export function wExtractEmbedding(
  pixels: Float32Array, face: FaceDetection, frameWidth: number,
  recognitionModel: any
): number[] {
  'worklet';
  const aligned = wAlignFace(pixels, face, frameWidth);
  const normalized = new Float32Array(112 * 112 * 3);
  for (let i = 0; i < 112 * 112 * 3; i++) normalized[i] = (aligned[i] / 127.5) - 1.0;
  const outputs = recognitionModel.runSync([normalized]);
  return wL2Normalize(Array.from(outputs[0] as Float32Array));
}
