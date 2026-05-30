// src/components/FaceOverlay.tsx
// SVG face oval guide with animated quality ring

import React, { useEffect, useRef } from 'react';
import {
  View, StyleSheet, Dimensions, Animated,
} from 'react-native';
import Svg, {
  Defs, Mask, Rect, Ellipse, Circle, G,
} from 'react-native-svg';

const { width: W, height: H } = Dimensions.get('window');
const AnimatedEllipse = Animated.createAnimatedComponent(Ellipse);

interface Props {
  ovalWidth: number;
  ovalHeight: number;
  strokeColor: string;
  isAnimating: boolean;
  pulseAnim: Animated.Value;
  quality: number; // 0–1
}

export const FaceOverlay: React.FC<Props> = ({
  ovalWidth, ovalHeight, strokeColor, pulseAnim, quality,
}) => {
  const cx = W / 2;
  const cy = H / 2 - 40;
  const rx = ovalWidth / 2;
  const ry = ovalHeight / 2;

  // Quality ring circumference
  const qualityRx = rx + 14;
  const qualityRy = ry + 14;
  const circumference = Math.PI * (3 * (qualityRx + qualityRy) -
    Math.sqrt((3 * qualityRx + qualityRy) * (qualityRx + 3 * qualityRy)));
  const strokeDashoffset = circumference * (1 - quality);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg width={W} height={H}>
        <Defs>
          <Mask id="ovalMask">
            <Rect x="0" y="0" width={W} height={H} fill="white" />
            <Ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="black" />
          </Mask>
        </Defs>

        {/* Dark overlay with oval hole */}
        <Rect
          x="0" y="0" width={W} height={H}
          fill="rgba(10,10,20,0.68)"
          mask="url(#ovalMask)"
        />

        {/* Oval border */}
        <Ellipse
          cx={cx} cy={cy} rx={rx} ry={ry}
          fill="none"
          stroke={strokeColor}
          strokeWidth={2.5}
          opacity={0.9}
        />

        {/* Quality progress ring */}
        {quality > 0 && (
          <Ellipse
            cx={cx} cy={cy}
            rx={qualityRx} ry={qualityRy}
            fill="none"
            stroke={quality > 0.7 ? '#00C897' : quality > 0.4 ? '#FFB347' : '#FF4757'}
            strokeWidth={3}
            strokeDasharray={`${circumference}`}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            transform={`rotate(-90 ${cx} ${cy})`}
            opacity={0.85}
          />
        )}

        {/* Corner accent dots */}
        {[
          [cx - rx, cy - ry * 0.6],
          [cx - rx, cy + ry * 0.6],
          [cx + rx, cy - ry * 0.6],
          [cx + rx, cy + ry * 0.6],
        ].map(([x, y], i) => (
          <Circle
            key={i} cx={x} cy={y} r={4}
            fill={strokeColor} opacity={0.7}
          />
        ))}
      </Svg>
    </View>
  );
};
