// src/components/PerformanceMonitor.tsx
// Floating live benchmark overlay for hackathon demo

import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Benchmark } from '../utils/Benchmark';

interface Props {
  visible: boolean;
}

export const PerformanceMonitor: React.FC<Props> = ({ visible }) => {
  const [stats, setStats] = useState({
    detection: 0,
    liveness: 0,
    recognition: 0,
    total: 0,
  });

  useEffect(() => {
    if (!visible) return;
    const interval = setInterval(() => {
      const d = Benchmark.getStats('detection').avg;
      const l = Benchmark.getStats('liveness').avg;
      const r = Benchmark.getStats('recognition').avg;
      setStats({ detection: d, liveness: l, recognition: r, total: d + l + r });
    }, 500);
    return () => clearInterval(interval);
  }, [visible]);

  if (!visible) return null;

  const totalColor =
    stats.total === 0 ? '#888' :
    stats.total < 400 ? '#00C897' :
    stats.total < 800 ? '#FFB347' : '#FF4757';

  return (
    <View style={styles.container}>
      <Text style={styles.title}>⚡ LIVE</Text>
      <Row label="Detect" value={stats.detection} />
      <Row label="Liveness" value={stats.liveness} />
      <Row label="Recog." value={stats.recognition} />
      <View style={styles.divider} />
      <Text style={[styles.total, { color: totalColor }]}>
        {stats.total > 0 ? `${stats.total}ms` : '---'}
      </Text>
    </View>
  );
};

const Row = ({ label, value }: { label: string; value: number }) => (
  <View style={styles.row}>
    <Text style={styles.label}>{label}</Text>
    <Text style={styles.value}>{value > 0 ? `${value}ms` : '---'}</Text>
  </View>
);

const styles = StyleSheet.create({
  container: {
    position: 'absolute', bottom: 160, left: 12,
    backgroundColor: 'rgba(0,0,0,0.82)',
    borderRadius: 10, padding: 10, minWidth: 110,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
    zIndex: 999,
  },
  title: { color: '#FFB347', fontSize: 10, fontWeight: '800', letterSpacing: 1, marginBottom: 6 },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, marginBottom: 2 },
  label: { color: 'rgba(255,255,255,0.5)', fontSize: 10 },
  value: { color: '#FFF', fontSize: 10, fontWeight: '700' },
  divider: { height: 1, backgroundColor: 'rgba(255,255,255,0.1)', marginVertical: 5 },
  total: { fontSize: 14, fontWeight: '900', textAlign: 'center' },
});
