// src/utils/CLAHEProcessor.ts
// Contrast Limited Adaptive Histogram Equalization — pure TypeScript
// No external dependencies. Fixes: harsh sunlight, shadows, low-light.
// Based on Karel Zuiderveld's CLAHE algorithm (1994)

export class CLAHEProcessor {
  private clipLimit: number;
  private tileGridSize: number;

  constructor(clipLimit = 2.0, tileGridSize = 8) {
    this.clipLimit = clipLimit;
    this.tileGridSize = tileGridSize;
  }

  // ─── Main Entry ───────────────────────────────────────────────────────────

  apply(
    grayPixels: Float32Array,
    width: number,
    height: number,
  ): Float32Array {
    const tilesX = this.tileGridSize;
    const tilesY = this.tileGridSize;
    const tileW = Math.floor(width / tilesX);
    const tileH = Math.floor(height / tilesY);

    // 1. Compute CDF LUT for each tile
    const luts: Uint8Array[][] = [];
    for (let ty = 0; ty < tilesY; ty++) {
      luts[ty] = [];
      for (let tx = 0; tx < tilesX; tx++) {
        const hist = this.computeTileHistogram(
          grayPixels, width,
          tx * tileW, ty * tileH,
          tileW, tileH,
        );
        this.clipHistogram(hist, tileW * tileH);
        luts[ty][tx] = this.histogramToCDF(hist);
      }
    }

    // 2. Bilinear interpolation between tile LUTs
    const output = new Float32Array(grayPixels.length);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        // Which tile context does this pixel belong to?
        // Tile "center" coordinate
        const txf = (x / tileW) - 0.5;
        const tyf = (y / tileH) - 0.5;

        const tx0 = Math.max(0, Math.min(tilesX - 1, Math.floor(txf)));
        const ty0 = Math.max(0, Math.min(tilesY - 1, Math.floor(tyf)));
        const tx1 = Math.min(tilesX - 1, tx0 + 1);
        const ty1 = Math.min(tilesY - 1, ty0 + 1);

        const xFrac = Math.max(0, Math.min(1, txf - tx0));
        const yFrac = Math.max(0, Math.min(1, tyf - ty0));

        const pix = Math.round(Math.max(0, Math.min(255, grayPixels[y * width + x])));

        // Bilinear interpolation of 4 surrounding tile LUTs
        const v00 = luts[ty0][tx0][pix];
        const v10 = luts[ty0][tx1][pix];
        const v01 = luts[ty1][tx0][pix];
        const v11 = luts[ty1][tx1][pix];

        output[y * width + x] =
          (1 - xFrac) * (1 - yFrac) * v00 +
          xFrac       * (1 - yFrac) * v10 +
          (1 - xFrac) * yFrac       * v01 +
          xFrac       * yFrac       * v11;
      }
    }

    return output;
  }

  // ─── Histogram Computation ────────────────────────────────────────────────

  private computeTileHistogram(
    pixels: Float32Array,
    frameWidth: number,
    tileX: number,
    tileY: number,
    tileW: number,
    tileH: number,
  ): Uint32Array {
    const hist = new Uint32Array(256);
    for (let row = 0; row < tileH; row++) {
      for (let col = 0; col < tileW; col++) {
        const px = tileX + col;
        const py = tileY + row;
        if (px < frameWidth) {
          const val = Math.round(
            Math.max(0, Math.min(255, pixels[py * frameWidth + px]))
          );
          hist[val]++;
        }
      }
    }
    return hist;
  }

  // ─── Clip Histogram ───────────────────────────────────────────────────────
  // Prevents over-amplification by limiting histogram bins

  private clipHistogram(hist: Uint32Array, tileArea: number): void {
    const clipValue = Math.max(
      1,
      Math.round(this.clipLimit * tileArea / 256)
    );

    let excess = 0;
    for (let i = 0; i < 256; i++) {
      if (hist[i] > clipValue) {
        excess += hist[i] - clipValue;
        hist[i] = clipValue;
      }
    }

    // Redistribute excess uniformly
    const perBin = Math.floor(excess / 256);
    const remainder = excess % 256;

    for (let i = 0; i < 256; i++) {
      hist[i] += perBin;
    }
    // Distribute remainder to first N bins
    for (let i = 0; i < remainder; i++) {
      hist[i]++;
    }
  }

  // ─── Histogram → CDF → LUT ────────────────────────────────────────────────

  private histogramToCDF(hist: Uint32Array): Uint8Array {
    const lut = new Uint8Array(256);
    let cumSum = 0;
    let total = 0;
    for (let i = 0; i < 256; i++) total += hist[i];

    for (let i = 0; i < 256; i++) {
      cumSum += hist[i];
      // Normalize CDF to [0, 255]
      lut[i] = total > 0
        ? Math.min(255, Math.round((cumSum / total) * 255))
        : i;
    }
    return lut;
  }
}
