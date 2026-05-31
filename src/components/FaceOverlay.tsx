// src/components/FaceOverlay.tsx
// SVG face oval guide with animated quality ring — Premium design

import React from 'react';
import {
  View, StyleSheet, Dimensions, Animated, Text,
} from 'react-native';
import Svg, {
  Defs, Mask, Rect, Ellipse, Circle, G,
} from 'react-native-svg';
import { UI_COLORS } from '../constants';

const { width: W, height: H } = Dimensions.get('window');

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

  const qualityColor = quality > 0.7 ? UI_COLORS.SUCCESS
    : quality > 0.4 ? UI_COLORS.WARNING
    : UI_COLORS.ERROR;

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
          fill="rgba(8,8,26,0.72)"
          mask="url(#ovalMask)"
        />

        {/* Outer glow ring */}
        <Ellipse
          cx={cx} cy={cy}
          rx={rx + 22} ry={ry + 22}
          fill="none"
          stroke={strokeColor}
          strokeWidth={0.5}
          opacity={0.15}
        />

        {/* Oval border */}
        <Ellipse
          cx={cx} cy={cy} rx={rx} ry={ry}
          fill="none"
          stroke={strokeColor}
          strokeWidth={2}
          opacity={0.85}
        />

        {/* Inner subtle ring */}
        <Ellipse
          cx={cx} cy={cy}
          rx={rx - 6} ry={ry - 6}
          fill="none"
          stroke={strokeColor}
          strokeWidth={0.5}
          opacity={0.2}
        />

        {/* Quality progress ring */}
        {quality > 0 && (
          <Ellipse
            cx={cx} cy={cy}
            rx={qualityRx} ry={qualityRy}
            fill="none"
            stroke={qualityColor}
            strokeWidth={3}
            strokeDasharray={`${circumference}`}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            transform={`rotate(-90 ${cx} ${cy})`}
            opacity={0.85}
          />
        )}

        {/* Corner accent markers (tech scanner feel) */}
        {/* Top-left */}
        <G>
          <Circle cx={cx - rx * 0.85} cy={cy - ry * 0.85} r={2} fill={strokeColor} opacity={0.5} />
          <Circle cx={cx + rx * 0.85} cy={cy - ry * 0.85} r={2} fill={strokeColor} opacity={0.5} />
          <Circle cx={cx - rx * 0.85} cy={cy + ry * 0.85} r={2} fill={strokeColor} opacity={0.5} />
          <Circle cx={cx + rx * 0.85} cy={cy + ry * 0.85} r={2} fill={strokeColor} opacity={0.5} />
        </G>

        {/* Crosshair dots at center */}
        <Circle cx={cx} cy={cy - ry - 8} r={2} fill={strokeColor} opacity={0.4} />
        <Circle cx={cx} cy={cy + ry + 8} r={2} fill={strokeColor} opacity={0.4} />
        <Circle cx={cx - rx - 8} cy={cy} r={2} fill={strokeColor} opacity={0.4} />
        <Circle cx={cx + rx + 8} cy={cy} r={2} fill={strokeColor} opacity={0.4} />
      </Svg>

      {/* Quality label */}
      {quality > 0 && (
        <View style={[styles.qualityLabel, { top: cy + ry + 24 }]}>
          <View style={[styles.qualityDot, { backgroundColor: qualityColor }]} />
          <Text style={[styles.qualityText, { color: qualityColor }]}>
            {Math.round(quality * 100)}% Quality
          </Text>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  qualityLabel: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4,
  },
  qualityDot: {
    width: 6, height: 6, borderRadius: 3,
  },
  qualityText: {
    fontSize: 11, fontWeight: '700', letterSpacing: 0.5,
  },
});
