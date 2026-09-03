import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, AppState } from 'react-native';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '@/constants/colors';
import { IOSSheet, IOSButton } from '@/components/ios';

export default function LocationPromptModal() {
  const [visible, setVisible] = useState(false);
  const [appState, setAppState] = useState(AppState.currentState);

  const checkLocation = async () => {
    let enabled = await Location.hasServicesEnabledAsync();
    let { status } = await Location.getForegroundPermissionsAsync();

    if (!enabled || status !== 'granted') {
      setVisible(true);
    } else {
      setVisible(false);
    }
  };

  useEffect(() => {
    checkLocation();

    const subscription = AppState.addEventListener('change', nextAppState => {
      if (appState.match(/inactive|background/) && nextAppState === 'active') {
        checkLocation();
      }
      setAppState(nextAppState);
    });

    return () => {
      subscription.remove();
    };
  }, [appState]);

  const requestPermission = async () => {
    let { status } = await Location.requestForegroundPermissionsAsync();
    if (status === 'granted') {
      let enabled = await Location.hasServicesEnabledAsync();
      if (enabled) setVisible(false);
    }
  };

  return (
    // Presented as an iOS sheet, but NOT dismissible: this is a hard gate, so
    // swipe-down and tap-outside stay off until permission is actually granted.
    <IOSSheet
      visible={visible}
      onClose={() => {}}
      dismissible={false}
      showGrabber={false}
      detent="medium"
      contentStyle={styles.sheet}
    >
      <View style={styles.container}>
        <Ionicons name="location" size={72} color={Colors.primary} />
        <Text style={styles.title}>Location Required</Text>
        <Text style={styles.description}>
          Emilgo needs your location to track trips, ensure safety, and calculate accurate fares.
          Please enable location services in your device settings to continue.
        </Text>
        <IOSButton
          title="Enable Location"
          variant="borderless"
          size="large"
          fullWidth
          onPress={requestPermission}
          textStyle={styles.buttonText}
        />
      </View>
    </IOSSheet>
  );
}

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: Colors.overlayColored,
  },
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 30,
    paddingTop: 12,
    paddingBottom: 8,
  },
  title: {
    fontFamily: 'Poppins_700Bold',
    fontSize: 24,
    color: Colors.textWhite,
    marginTop: 20,
    marginBottom: 10,
    textAlign: 'center',
  },
  description: {
    fontFamily: 'Poppins_400Regular',
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginBottom: 32,
    lineHeight: 22,
  },
  buttonText: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 16, color:Colors.primary
  },
});
