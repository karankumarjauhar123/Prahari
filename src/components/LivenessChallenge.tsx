// src/components/LivenessChallenge.tsx
// Animated liveness challenge prompt

import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Dimensions } from 'react-native';
import type { LivenessChallenge as ChallengeType } from '../types';
import { UI_COLORS } from '../constants';

const { width: W, height: H } = Dimensions.get('window');

interface Props { challenge: ChallengeType }

const CHALLENGE_CONFIG: Record<ChallengeType, { emoji: string; text: string; color: string }> = {
  BLINK:      { emoji: '😉', text: 'BLINK',        color: '#4FC3F7' },
  SMILE:      { emoji: '😁', text: 'SMILE',        color: '#FFD54F' },
  TURN_LEFT:  { emoji: '👈', text: 'TURN LEFT',    color: '#CE93D8' },
  TURN_RIGHT: { emoji: '👉', text: 'TURN RIGHT',   color: '#CE93D8' },
  NOD:        { emoji: '↕️',  text: 'NOD',          color: '#80CBC4' },
};

export const LivenessChallenge: React.FC<Props> = ({ challenge }) => {
  const scaleAnim = useRef(new Animated.Value(0)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;
  const config = CHALLENGE_CONFIG[challenge];

  useEffect(() => {
    Animated.parallel([
      Animated.spring(scaleAnim, { toValue: 1, tension: 80, friction: 8, useNativeDriver: true }),
      Animated.timing(opacityAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
    ]).start();
    return () => { scaleAnim.setValue(0); opacityAnim.setValue(0); };
  }, [challenge]);

  return (
    <Animated.View
      style={[
        styles.container,
        { transform: [{ scale: scaleAnim }], opacity: opacityAnim }
      ]}
    >
      <View style={[styles.pill, { borderColor: config.color }]}>
        <Text style={styles.emoji}>{config.emoji}</Text>
        <Text style={[styles.text, { color: config.color }]}>{config.text}</Text>
      </View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: '18%',
    alignSelf: 'center',
    zIndex: 20,
  },
  pill: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.75)',
    borderRadius: 30, borderWidth: 1.5,
    paddingHorizontal: 20, paddingVertical: 10,
    gap: 10,
  },
  emoji: { fontSize: 26 },
  text: { fontSize: 18, fontWeight: '800', letterSpacing: 2 },
});


// ─── StatusBadge ──────────────────────────────────────────────────────────────

interface BadgeProps { isOnline: boolean; pendingCount: number }

export const StatusBadge: React.FC<BadgeProps> = ({ isOnline, pendingCount }) => {
  return (
    <View style={badge.container}>
      <View style={[badge.dot, { backgroundColor: isOnline ? UI_COLORS.SUCCESS : UI_COLORS.ERROR }]} />
      <Text style={badge.text}>
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
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
    gap: 6,
  },
  dot: { width: 7, height: 7, borderRadius: 4 },
  text: { color: 'rgba(255,255,255,0.8)', fontSize: 11, fontWeight: '700', letterSpacing: 1 },
});
