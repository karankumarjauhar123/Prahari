// src/components/LivenessChallenge.tsx
// Animated liveness challenge prompt — Premium glassmorphic design

import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Dimensions } from 'react-native';
import type { LivenessChallenge as ChallengeType } from '../types';
import { UI_COLORS } from '../constants';

const { width: W, height: H } = Dimensions.get('window');

interface Props { challenge: ChallengeType }

const CHALLENGE_CONFIG: Record<ChallengeType, { emoji: string; text: string; color: string; hint: string }> = {
  BLINK:      { emoji: '😉', text: 'BLINK',        color: '#4FC3F7', hint: 'Close both eyes briefly' },
  SMILE:      { emoji: '😁', text: 'SMILE',        color: '#FFD54F', hint: 'Show a natural smile' },
  TURN_LEFT:  { emoji: '👈', text: 'TURN LEFT',    color: '#B388FF', hint: 'Turn your head left' },
  TURN_RIGHT: { emoji: '👉', text: 'TURN RIGHT',   color: '#B388FF', hint: 'Turn your head right' },
  NOD:        { emoji: '↕️',  text: 'NOD',          color: '#64FFDA', hint: 'Nod your head slowly' },
};

export const LivenessChallenge: React.FC<Props> = ({ challenge }) => {
  const scaleAnim = useRef(new Animated.Value(0)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;
  const glowAnim = useRef(new Animated.Value(0.3)).current;
  const config = CHALLENGE_CONFIG[challenge];

  useEffect(() => {
    Animated.parallel([
      Animated.spring(scaleAnim, { toValue: 1, tension: 80, friction: 8, useNativeDriver: true }),
      Animated.timing(opacityAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
    ]).start();

    // Subtle glow pulse
    Animated.loop(
      Animated.sequence([
        Animated.timing(glowAnim, { toValue: 0.8, duration: 800, useNativeDriver: true }),
        Animated.timing(glowAnim, { toValue: 0.3, duration: 800, useNativeDriver: true }),
      ])
    ).start();

    return () => {
      scaleAnim.setValue(0);
      opacityAnim.setValue(0);
      glowAnim.stopAnimation();
    };
  }, [challenge]);

  return (
    <Animated.View
      style={[
        styles.container,
        { transform: [{ scale: scaleAnim }], opacity: opacityAnim }
      ]}
    >
      {/* Glow backdrop */}
      <Animated.View style={[styles.glow, {
        backgroundColor: config.color,
        opacity: glowAnim,
      }]} />

      <View style={[styles.pill, { borderColor: config.color + '60' }]}>
        <View style={[styles.emojiCircle, { backgroundColor: config.color + '20' }]}>
          <Text style={styles.emoji}>{config.emoji}</Text>
        </View>
        <View style={styles.textWrap}>
          <Text style={[styles.text, { color: config.color }]}>{config.text}</Text>
          <Text style={styles.hint}>{config.hint}</Text>
        </View>
      </View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: '16%',
    alignSelf: 'center',
    zIndex: 20,
  },
  glow: {
    position: 'absolute',
    width: 200, height: 60, borderRadius: 30,
    top: -5, alignSelf: 'center',
    opacity: 0.1,
  },
  pill: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(8,8,26,0.88)',
    borderRadius: 20, borderWidth: 1.5,
    paddingHorizontal: 16, paddingVertical: 10,
    gap: 12,
  },
  emojiCircle: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
  },
  emoji: { fontSize: 22 },
  textWrap: { gap: 2 },
  text: { fontSize: 16, fontWeight: '900', letterSpacing: 2 },
  hint: { fontSize: 10, color: 'rgba(255,255,255,0.4)', letterSpacing: 0.5 },
});


// ─── StatusBadge ──────────────────────────────────────────────────────────────

interface BadgeProps { isOnline: boolean; pendingCount: number }

export const StatusBadge: React.FC<BadgeProps> = ({ isOnline, pendingCount }) => {
  return (
    <View style={[badge.container, isOnline && badge.containerOnline]}>
      <View style={[badge.dot, { backgroundColor: isOnline ? UI_COLORS.SUCCESS : UI_COLORS.ERROR }]} />
      <Text style={[badge.text, { color: isOnline ? UI_COLORS.SUCCESS : 'rgba(255,255,255,0.5)' }]}>
        {isOnline ? 'ONLINE' : `OFFLINE${pendingCount > 0 ? ` · ${pendingCount}` : ''}`}
      </Text>
    </View>
  );
};

const badge = StyleSheet.create({
  container: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 12, paddingHorizontal: 10, paddingVertical: 5,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
    gap: 6,
  },
  containerOnline: {
    borderColor: 'rgba(0,214,143,0.25)',
    backgroundColor: 'rgba(0,214,143,0.08)',
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  text: { fontSize: 10, fontWeight: '800', letterSpacing: 1.2 },
});
