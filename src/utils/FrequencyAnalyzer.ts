// src/utils/FrequencyAnalyzer.ts
// FFT-based spoof detection — screens and printed photos have
// characteristic high-frequency patterns that real skin does not.
// Pure TypeScript — no dependencies.

export class FrequencyAnalyzer {
  private readonly SAMPLE_SIZE = 64; // 64×64 center crop for FFT

  // ─── Main Entry ───────────────────────────────────────────────────────────
  // Returns score 0–1 (1 = likely real face, 0 = likely screen/print)

  analyzeFrame(
    pixels: Float32Array,
    width: number,
    height: number,
  ): number {
    // 1. Extract center 64×64 grayscale crop
    const cropSize = this.SAMPLE_SIZE;
    const startX = Math.max(0, Math.floor((width - cropSize) / 2));
    const startY = Math.max(0, Math.floor((height - cropSize) / 2));
    const gray = this.extractGrayCrop(pixels, width, startX, startY, cropSize);

    // 2. Apply Hanning window to reduce spectral leakage
    const windowed = this.applyHanningWindow(gray, cropSize);

    // 3. Compute 2D DFT magnitude spectrum
    const spectrum = this.computeMagnitudeSpectrum(windowed, cropSize);

    // 4. Analyze spectrum for regular grid artifacts
    const regularityScore = this.computeRegularityScore(spectrum, cropSize);

    // High regularity → screen/print artifacts present → return LOW score
    // Low regularity → organic texture → return HIGH score
    return 1.0 - regularityScore;
  }

  // ─── Grayscale Crop Extraction ────────────────────────────────────────────

  private extractGrayCrop(
    pixels: Float32Array,
    frameWidth: number,
    startX: number,
    startY: number,
    size: number,
  ): Float32Array {
    const frameHeight = pixels.length / (frameWidth * 3);
    const out = new Float32Array(size * size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const px = Math.max(0, Math.min(frameWidth - 1, startX + x));
        const py = Math.max(0, Math.min(frameHeight - 1, startY + y));
        const idx = (py * frameWidth + px) * 3;
        out[y * size + x] =
          pixels[idx]     * 0.299 +
          pixels[idx + 1] * 0.587 +
          pixels[idx + 2] * 0.114;
      }
    }
    return out;
  }

  // ─── Hanning Window ───────────────────────────────────────────────────────

  private applyHanningWindow(gray: Float32Array, size: number): Float32Array {
    const out = new Float32Array(size * size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const wx = 0.5 * (1 - Math.cos((2 * Math.PI * x) / (size - 1)));
        const wy = 0.5 * (1 - Math.cos((2 * Math.PI * y) / (size - 1)));
        out[y * size + x] = gray[y * size + x] * wx * wy;
      }
    }
    return out;
  }

  // ─── 2D DFT Magnitude Spectrum ────────────────────────────────────────────
  // Using row-column decomposition for efficiency

  private computeMagnitudeSpectrum(data: Float32Array, size: number): Float32Array {
    // Build complex arrays
    const real = new Float32Array(data);
    const imag = new Float32Array(size * size);

    // Row-wise 1D FFT
    for (let y = 0; y < size; y++) {
      this.fft1D(real, imag, y * size, 1, size);
    }

    // Column-wise 1D FFT
    for (let x = 0; x < size; x++) {
      this.fft1D(real, imag, x, size, size);
    }

    // Magnitude spectrum (log scale for better discrimination)
    const mag = new Float32Array(size * size);
    for (let i = 0; i < size * size; i++) {
      mag[i] = Math.log1p(Math.sqrt(real[i] * real[i] + imag[i] * imag[i]));
    }

    // FFT shift — move zero frequency to center
    return this.fftShift(mag, size);
  }

  // ─── Cooley-Tukey Radix-2 FFT (in-place with offset and stride) ──────────

  private fft1D(
    real: Float32Array,
    imag: Float32Array,
    offset: number,
    stride: number,
    n: number
  ): void {
    if (n <= 1) return;

    // Bit-reversal permutation
    let j = 0;
    for (let i = 1; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        const idxI = offset + i * stride;
        const idxJ = offset + j * stride;
        const tempR = real[idxI];
        real[idxI] = real[idxJ];
        real[idxJ] = tempR;

        const tempI = imag[idxI];
        imag[idxI] = imag[idxJ];
        imag[idxJ] = tempI;
      }
    }

    // Butterfly operations
    for (let len = 2; len <= n; len <<= 1) {
      const ang = (-2 * Math.PI) / len;
      const wReal = Math.cos(ang);
      const wImag = Math.sin(ang);

      for (let i = 0; i < n; i += len) {
        let curReal = 1, curImag = 0;
        for (let k = 0; k < len / 2; k++) {
          const idx1 = offset + (i + k) * stride;
          const idx2 = offset + (i + k + len / 2) * stride;

          const uR = real[idx1];
          const uI = imag[idx1];
          const vR = real[idx2] * curReal - imag[idx2] * curImag;
          const vI = real[idx2] * curImag + imag[idx2] * curReal;

          real[idx1] = uR + vR;
          imag[idx1] = uI + vI;
          real[idx2] = uR - vR;
          imag[idx2] = uI - vI;

          const nextReal = curReal * wReal - curImag * wImag;
          curImag = curReal * wImag + curImag * wReal;
          curReal = nextReal;
        }
      }
    }
  }

  // ─── FFT Shift ────────────────────────────────────────────────────────────

  private fftShift(spectrum: Float32Array, size: number): Float32Array {
    const shifted = new Float32Array(size * size);
    const half = size / 2;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const ny = (y + half) % size;
        const nx = (x + half) % size;
        shifted[ny * size + nx] = spectrum[y * size + x];
      }
    }
    return shifted;
  }

  // ─── Regularity Score ─────────────────────────────────────────────────────
  // Detects periodic patterns (screen pixels, print halftone dots)

  private computeRegularityScore(spectrum: Float32Array, size: number): number {
    const center = size / 2;
    let totalEnergy = 0;
    for (let i = 0; i < spectrum.length; i++) totalEnergy += spectrum[i];
    if (totalEnergy < 1e-6) return 0.5;

    // Compute energy in mid-frequency band rings
    // Screen/print artifacts appear at specific spatial frequencies
    let peakEnergy = 0;
    let midBandEnergy = 0;
    const innerR = size * 0.1;   // inner radius (DC + low freq, always present)
    const outerR = size * 0.45;  // outer radius

    // Find peaks in spectrum (local maxima)
    const peakCoords: { x: number; y: number; val: number }[] = [];
    for (let y = 1; y < size - 1; y++) {
      for (let x = 1; x < size - 1; x++) {
        const r = Math.sqrt((x - center) ** 2 + (y - center) ** 2);
        if (r < innerR || r > outerR) continue;

        const val = spectrum[y * size + x];
        midBandEnergy += val;

        // Is local maximum?
        const neighbors = [
          spectrum[(y-1)*size+x], spectrum[(y+1)*size+x],
          spectrum[y*size+(x-1)], spectrum[y*size+(x+1)],
        ];
        if (val > Math.max(...neighbors) * 1.5) {
          peakCoords.push({ x, y, val });
          peakEnergy += val;
        }
      }
    }

    if (midBandEnergy < 1e-6) return 0.3;

    // Peak concentration ratio — screens have strong isolated peaks
    const peakConcentration = peakEnergy / midBandEnergy;

    // Count symmetric peak pairs (screens/prints have periodic symmetry)
    const symmetryScore = this.computeSymmetryScore(size, peakCoords);

    // Combined regularity: high → likely spoof
    const regularity = peakConcentration * 0.6 + symmetryScore * 0.4;

    // Normalize to [0, 1]
    return Math.min(1.0, regularity * 2.5);
  }

  private computeSymmetryScore(
    size: number,
    peakCoords: { x: number; y: number; val: number }[]
  ): number {
    if (peakCoords.length < 2) return 0.1;

    let symmetricPeaks = 0;
    // For each peak, check if there is a corresponding peak at:
    // - Horizontal reflection: (size - x, y)
    // - Vertical reflection: (x, size - y)
    // We allow a tolerance of 1 pixel in x and y because FFT peaks might be slightly off.
    for (let i = 0; i < peakCoords.length; i++) {
      const p = peakCoords[i];
      let hasHorizontal = false;
      let hasVertical = false;
      for (let j = 0; j < peakCoords.length; j++) {
        if (i === j) continue;
        const q = peakCoords[j];
        if (Math.abs(q.x - (size - p.x)) <= 1 && Math.abs(q.y - p.y) <= 1) {
          hasHorizontal = true;
        }
        if (Math.abs(q.x - p.x) <= 1 && Math.abs(q.y - (size - p.y)) <= 1) {
          hasVertical = true;
        }
        if (hasHorizontal && hasVertical) break;
      }
      if (hasHorizontal || hasVertical) {
        symmetricPeaks++;
      }
    }

    return symmetricPeaks / peakCoords.length;
  }
}
