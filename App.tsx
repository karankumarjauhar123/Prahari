// App.tsx — Navigation root + app initialization

import React, { useEffect, useState } from 'react';
import { StatusBar, View, Text, StyleSheet, ActivityIndicator, Animated } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { DatabaseService } from './src/services/DatabaseService';
import { SyncService } from './src/services/SyncService';
import { HomeScreen } from './src/screens/HomeScreen';
import { AuthScreen } from './src/screens/AuthScreen';
import { EnrollScreen } from './src/screens/EnrollScreen';
import { RecordsScreen } from './src/screens/RecordsScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { UI_COLORS } from './src/constants';

export type RootStackParamList = {
  Home: undefined;
  Auth: undefined;
  Enroll: undefined;
  Records: undefined;
  Settings: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

const App: React.FC = () => {
  const [isBootstrapped, setIsBootstrapped] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);
  const logoAnim = React.useRef(new Animated.Value(0)).current;
  const pulseAnim = React.useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    // Start logo animation
    Animated.timing(logoAnim, {
      toValue: 1, duration: 800, useNativeDriver: true,
    }).start();
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1, duration: 1000, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 0.4, duration: 1000, useNativeDriver: true }),
      ])
    ).start();
    bootstrap();
  }, []);

  const bootstrap = async () => {
    try {
      // 1. Initialize encrypted local database
      await DatabaseService.initialize();

      // 2. Start sync service — listens for connectivity events
      await SyncService.initialize();

      setIsBootstrapped(true);
    } catch (err: any) {
      console.error('[App] Bootstrap failed:', err);
      setBootError(err?.message ?? 'Startup failed');
    }
  };

  if (bootError) {
    return (
      <View style={styles.bootScreen}>
        <StatusBar barStyle="light-content" backgroundColor={UI_COLORS.BACKGROUND} />
        <View style={styles.errorCard}>
          <Text style={styles.errorIcon}>⚠️</Text>
          <Text style={styles.bootError}>{bootError}</Text>
          <Text style={styles.bootHint}>Please restart the application</Text>
        </View>
      </View>
    );
  }

  if (!isBootstrapped) {
    return (
      <View style={styles.bootScreen}>
        <StatusBar barStyle="light-content" backgroundColor={UI_COLORS.BACKGROUND} />
        {/* Subtle background glow */}
        <View style={styles.bootGlow} />

        <Animated.View style={[styles.bootLogoWrap, {
          opacity: logoAnim,
          transform: [{ scale: logoAnim.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1] }) }],
        }]}>
          <View style={styles.shieldIcon}>
            <Text style={styles.shieldEmoji}>🛡️</Text>
          </View>
          <Text style={styles.bootTitle}>PRAHARI</Text>
          <Text style={styles.bootTagline}>Secure • Offline • Edge AI</Text>
        </Animated.View>

        <View style={styles.bootLoaderWrap}>
          <Animated.View style={[styles.bootLoaderBar, { opacity: pulseAnim }]} />
          <Text style={styles.bootSubtitle}>Initializing secure vault...</Text>
        </View>

        <Text style={styles.bootVersion}>v1.0.0 — Hackathon 7.0</Text>
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />
        <NavigationContainer>
          <Stack.Navigator
            initialRouteName="Home"
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: UI_COLORS.BACKGROUND },
              animation: 'slide_from_right',
            }}
          >
            <Stack.Screen name="Home" component={HomeScreen} />
            <Stack.Screen
              name="Auth"
              component={AuthScreen}
              options={{ animation: 'fade' }}
            />
            <Stack.Screen name="Enroll" component={EnrollScreen} />
            <Stack.Screen name="Records" component={RecordsScreen} />
            <Stack.Screen name="Settings" component={SettingsScreen} />
          </Stack.Navigator>
        </NavigationContainer>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
};

const styles = StyleSheet.create({
  bootScreen: {
    flex: 1, backgroundColor: UI_COLORS.BACKGROUND,
    alignItems: 'center', justifyContent: 'center',
  },
  bootGlow: {
    position: 'absolute',
    width: 300, height: 300, borderRadius: 150,
    backgroundColor: 'rgba(233,69,96,0.06)',
    top: '25%',
  },
  bootLogoWrap: {
    alignItems: 'center',
  },
  shieldIcon: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: 'rgba(233,69,96,0.12)',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 20,
    borderWidth: 1, borderColor: 'rgba(233,69,96,0.25)',
  },
  shieldEmoji: { fontSize: 36 },
  bootTitle: {
    fontSize: 40, fontWeight: '900', color: '#FFFFFF',
    letterSpacing: 12,
  },
  bootTagline: {
    marginTop: 8, color: UI_COLORS.TEXT_SECONDARY, fontSize: 13,
    letterSpacing: 2.5, fontWeight: '500',
  },
  bootLoaderWrap: {
    marginTop: 48, alignItems: 'center',
  },
  bootLoaderBar: {
    width: 120, height: 3, borderRadius: 2,
    backgroundColor: UI_COLORS.ACCENT,
    marginBottom: 16,
  },
  bootSubtitle: {
    color: 'rgba(255,255,255,0.35)', fontSize: 12, letterSpacing: 0.5,
  },
  bootVersion: {
    position: 'absolute', bottom: 40,
    color: 'rgba(255,255,255,0.12)', fontSize: 11, letterSpacing: 0.5,
  },
  errorCard: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,71,87,0.08)',
    borderRadius: 20, padding: 32,
    borderWidth: 1, borderColor: 'rgba(255,71,87,0.2)',
    marginHorizontal: 32,
  },
  errorIcon: { fontSize: 48, marginBottom: 16 },
  bootError: { color: UI_COLORS.ERROR, fontSize: 16, textAlign: 'center' },
  bootHint: { color: UI_COLORS.TEXT_SECONDARY, fontSize: 13, marginTop: 8 },
});

export default App;
