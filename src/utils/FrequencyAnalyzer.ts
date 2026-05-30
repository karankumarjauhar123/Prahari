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
    const real = Array.from(data);
    const imag = new Array(size * size).fill(0);

    // Row-wise 1D FFT
    for (let y = 0; y < size; y++) {
      const rowReal = real.slice(y * size, y * size + size);
      const rowImag = imag.slice(y * size, y * size + size);
      this.fft1D(rowReal, rowImag);
      for (let x = 0; x < size; x++) {
        real[y * size + x] = rowReal[x];
        imag[y * size + x] = rowImag[x];
      }
    }

    // Column-wise 1D FFT
    for (let x = 0; x < size; x++) {
      const colReal = [];
      const colImag = [];
      for (let y = 0; y < size; y++) {
        colReal.push(real[y * size + x]);
        colImag.push(imag[y * size + x]);
      }
      this.fft1D(colReal, colImag);
      for (let y = 0; y < size; y++) {
        real[y * size + x] = colReal[y];
        imag[y * size + x] = colImag[y];
      }
    }

    // Magnitude spectrum (log scale for better discrimination)
    const mag = new Float32Array(size * size);
    for (let i = 0; i < size * size; i++) {
      mag[i] = Math.log1p(Math.sqrt(real[i] * real[i] + imag[i] * imag[i]));
    }

    // FFT shift — move zero frequency to center
    return this.fftShift(mag, size);
  }

  // ─── Cooley-Tukey Radix-2 FFT (in-place) ─────────────────────────────────

  private fft1D(real: number[], imag: number[]): void {
    const n = real.length;
    if (n <= 1) return;

    // Bit-reversal permutation
    let j = 0;
    for (let i = 1; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        [real[i], real[j]] = [real[j], real[i]];
        [imag[i], imag[j]] = [imag[j], imag[i]];
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
          const uR = real[i + k];
          const uI = imag[i + k];
          const vR = real[i + k + len / 2] * curReal - imag[i + k + len / 2] * curImag;
          const vI = real[i + k + len / 2] * curImag + imag[i + k + len / 2] * curReal;

          real[i + k]           = uR + vR;
          imag[i + k]           = uI + vI;
          real[i + k + len / 2] = uR - vR;
          imag[i + k + len / 2] = uI - vI;

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
    const totalEnergy = spectrum.reduce((s, v) => s + v, 0);
    if (totalEnergy < 1e-6) return 0.5;

    // Compute energy in mid-frequency band rings
    // Screen/print artifacts appear at specific spatial frequencies
    let peakEnergy = 0;
    let midBandEnergy = 0;
    const innerR = size * 0.1;   // inner radius (DC + low freq, always present)
    const outerR = size * 0.45;  // outer radius

    // Find peaks in spectrum (local maxima)
    const peaks: number[] = [];
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
          peaks.push(val);
          peakEnergy += val;
        }
      }
    }

    if (midBandEnergy < 1e-6) return 0.3;

    // Peak concentration ratio — screens have strong isolated peaks
    const peakConcentration = peakEnergy / midBandEnergy;

    // Count symmetric peak pairs (screens/prints have periodic symmetry)
    const symmetryScore = this.computeSymmetryScore(spectrum, size, peaks.length);

    // Combined regularity: high → likely spoof
    const regularity = peakConcentration * 0.6 + symmetryScore * 0.4;

    // Normalize to [0, 1]
    return Math.min(1.0, regularity * 2.5);
  }

  private computeSymmetryScore(
    spectrum: Float32Array,
    size: number,
    peakCount: number,
  ): number {
    if (peakCount < 2) return 0.1;
    // High symmetry in spectrum → periodic pattern in spatial domain
    let symmetricPairs = 0;
    const center = size / 2;
    const threshold = 0.7;

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const mirrorX = size - 1 - x;
        const mirrorY = size - 1 - y;
        const v1 = spectrum[y * size + x];
        const v2 = spectrum[mirrorY * size + mirrorX];
        if (v1 > 0.1 && v2 > 0.1) {
          const ratio = Math.min(v1, v2) / Math.max(v1, v2);
          if (ratio > threshold) symmetricPairs++;
        }
      }
    }

    // Normalize
    return Math.min(1.0, (symmetricPairs / (size * size)) * 20);
  }
}
