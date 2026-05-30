// App.tsx — Navigation root + app initialization

import React, { useEffect, useState } from 'react';
import { StatusBar, View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Amplify } from 'aws-amplify';
import awsConfig from './aws-exports';
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

  useEffect(() => {
    bootstrap();
  }, []);

  const bootstrap = async () => {
    try {
      // 1. Configure AWS Amplify (offline-safe — no network call at startup)
      Amplify.configure(awsConfig);

      // 2. Initialize encrypted local database
      await DatabaseService.initialize();

      // 3. Start sync service — listens for connectivity events
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
        <Text style={styles.bootError}>⚠️ {bootError}</Text>
        <Text style={styles.bootHint}>Please restart the application</Text>
      </View>
    );
  }

  if (!isBootstrapped) {
    return (
      <View style={styles.bootScreen}>
        <Text style={styles.bootTitle}>PRAHARI</Text>
        <ActivityIndicator color={UI_COLORS.ACCENT} size="large" style={{ marginTop: 24 }} />
        <Text style={styles.bootSubtitle}>Loading secure vault...</Text>
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
  bootTitle: {
    fontSize: 36, fontWeight: '900', color: '#FFFFFF',
    letterSpacing: 10,
  },
  bootSubtitle: {
    marginTop: 16, color: UI_COLORS.TEXT_SECONDARY, fontSize: 14,
  },
  bootError: { color: UI_COLORS.ERROR, fontSize: 16, textAlign: 'center', paddingHorizontal: 32 },
  bootHint: { color: UI_COLORS.TEXT_SECONDARY, fontSize: 13, marginTop: 8 },
});

export default App;
