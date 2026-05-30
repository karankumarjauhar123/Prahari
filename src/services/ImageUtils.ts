// src/services/ImageUtils.ts
// Image preprocessing utilities:
// - CLAHE low-light enhancement (no model, pure math)
// - Crop & resize
// - SHA-256 image fingerprint

import AesCrypto from 'react-native-aes-crypto';
import { CLAHEProcessor } from '../utils/CLAHEProcessor';

const clahe = new CLAHEProcessor(2.0, 8);

export class ImageUtils {
  // ─── CLAHE Enhancement ────────────────────────────────────────────────────
  // Fixes: harsh sunlight, deep shadows, low-light night conditions
  // Call this BEFORE running any model inference

  static claheEnhancement(
    pixels: Float32Array,
    width: number,
    height: number,
  ): Float32Array {
    // 1. Convert RGB → grayscale
    const gray = ImageUtils.rgbToGrayscale(pixels, width, height);

    // 2. Apply CLAHE on grayscale
    const enhanced = clahe.apply(gray, width, height);

    // 3. Map enhancement back to RGB channels
    // Compute per-pixel gain: enhanced / original (avoid div by zero)
    const output = new Float32Array(pixels.length);
    for (let i = 0; i < width * height; i++) {
      const origGray = gray[i];
      const gain = origGray > 5 ? enhanced[i] / origGray : 1.0;
      // Clamp gain to [0.3, 3.0] to avoid extreme shifts
      const clampedGain = Math.min(3.0, Math.max(0.3, gain));
      output[i * 3]     = Math.min(255, pixels[i * 3]     * clampedGain);
      output[i * 3 + 1] = Math.min(255, pixels[i * 3 + 1] * clampedGain);
      output[i * 3 + 2] = Math.min(255, pixels[i * 3 + 2] * clampedGain);
    }
    return output;
  }

  // ─── Grayscale Conversion ─────────────────────────────────────────────────

  static rgbToGrayscale(
    pixels: Float32Array,
    width: number,
    height: number,
  ): Float32Array {
    const gray = new Float32Array(width * height);
    for (let i = 0; i < width * height; i++) {
      gray[i] =
        pixels[i * 3]     * 0.299 +
        pixels[i * 3 + 1] * 0.587 +
        pixels[i * 3 + 2] * 0.114;
    }
    return gray;
  }

  // ─── Crop and Resize (bilinear) ───────────────────────────────────────────

  static cropAndResize(
    pixels: Float32Array,
    srcX: number,
    srcY: number,
    srcW: number,
    srcH: number,
    frameWidth: number,
    frameHeight: number,
    targetSize: number,
  ): Float32Array {
    const output = new Float32Array(targetSize * targetSize * 3);
    const scaleX = srcW / targetSize;
    const scaleY = srcH / targetSize;

    for (let dy = 0; dy < targetSize; dy++) {
      for (let dx = 0; dx < targetSize; dx++) {
        // Source position (float)
        const sx = srcX + dx * scaleX;
        const sy = srcY + dy * scaleY;

        // Bilinear interpolation
        const x0 = Math.floor(sx);
        const y0 = Math.floor(sy);
        const x0_clamped = Math.max(0, Math.min(x0, frameWidth - 1));
        const y0_clamped = Math.max(0, Math.min(y0, frameHeight - 1));
        const x1_clamped = Math.max(0, Math.min(x0 + 1, frameWidth - 1));
        const y1_clamped = Math.max(0, Math.min(y0 + 1, frameHeight - 1));
        const fx = sx - x0;
        const fy = sy - y0;

        const dstIdx = (dy * targetSize + dx) * 3;

        for (let c = 0; c < 3; c++) {
          const v00 = pixels[(y0_clamped * frameWidth + x0_clamped) * 3 + c] ?? 0;
          const v10 = pixels[(y0_clamped * frameWidth + x1_clamped) * 3 + c] ?? 0;
          const v01 = pixels[(y1_clamped * frameWidth + x0_clamped) * 3 + c] ?? 0;
          const v11 = pixels[(y1_clamped * frameWidth + x1_clamped) * 3 + c] ?? 0;

          output[dstIdx + c] =
            (1 - fx) * (1 - fy) * v00 +
            fx       * (1 - fy) * v10 +
            (1 - fx) * fy       * v01 +
            fx       * fy       * v11;
        }
      }
    }
    return output;
  }

  // ─── SHA-256 Image Fingerprint ────────────────────────────────────────────
  // Stores cryptographic hash of face — no raw image ever saved

  static async computeSHA256(pixels: Float32Array): Promise<string> {
    // Sample 2000 pixels evenly distributed across the face crop
    const stride = Math.max(1, Math.floor(pixels.length / 6000));
    let hexStr = '';
    for (let i = 0; i < pixels.length; i += stride) {
      hexStr += Math.round(pixels[i]).toString(16).padStart(2, '0');
    }
    return AesCrypto.sha256(hexStr);
  }

  // ─── Normalize for Model Input ────────────────────────────────────────────

  // Normalize to [-1, 1] — for AdaFace
  static normalizeAdaFace(pixels: Float32Array): Float32Array {
    const out = new Float32Array(pixels.length);
    for (let i = 0; i < pixels.length; i++) {
      out[i] = pixels[i] / 127.5 - 1.0;
    }
    return out;
  }

  // Normalize to [0, 1] — for YOLOv8 / anti-spoof
  static normalizeZeroOne(pixels: Float32Array): Float32Array {
    const out = new Float32Array(pixels.length);
    for (let i = 0; i < pixels.length; i++) {
      out[i] = pixels[i] / 255.0;
    }
    return out;
  }

  // ─── Brightness Stats ─────────────────────────────────────────────────────

  static getBrightnessStats(
    pixels: Float32Array,
    width: number,
    height: number,
  ): { mean: number; std: number; min: number; max: number } {
    const gray = ImageUtils.rgbToGrayscale(pixels, width, height);
    let sum = 0, sumSq = 0;
    let min = 255, max = 0;

    for (let i = 0; i < gray.length; i++) {
      sum += gray[i];
      sumSq += gray[i] * gray[i];
      if (gray[i] < min) min = gray[i];
      if (gray[i] > max) max = gray[i];
    }

    const mean = sum / gray.length;
    const std = Math.sqrt(sumSq / gray.length - mean * mean);
    return { mean, std, min, max };
  }
}
