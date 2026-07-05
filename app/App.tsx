import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import MainScreen from './src/screens/MainScreen';
import { colors } from './src/theme';

export default function App() {
  return (
    <SafeAreaProvider>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
        <StatusBar style="light" />
        <MainScreen />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
