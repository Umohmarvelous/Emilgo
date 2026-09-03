import React, { useEffect } from "react";
import { View, Text, ActivityIndicator, StyleSheet } from "react-native";
import { router } from "expo-router";
import { useAuthStore } from "@/src/store/useStore";
import { Colors } from "@/constants/colors";
import { useIOSTheme } from "@/components/ios";

export default function IndexScreen() {
  const { isAuthenticated, user } = useAuthStore();
  const ios = useIOSTheme()

  useEffect(() => {
    if (!isAuthenticated || !user) {
      // Not logged in → go to login screen
      // router.replace("/(driver)/qr-receive");
      router.replace("/(main)");
      return;
    }

    // Authenticated: drivers need profile completion first, everyone else
    // goes to the unified (main) dashboard
    if (user.role === "driver" && !user.profile_complete) {
      // router.replace("/(auth)/driver-profile");      
      router.replace("/(main)");
      // return
    } else {
      // router.replace("/(driver)/qr-receive");
      router.replace("/(main)");
    }
  }, [isAuthenticated, user]);

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color={ios.systemBackground} />
      <Text style={{color: ios.systemBackground}}>Please wait...</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.primary,
    alignItems: "center",
    justifyContent: "center",
    gap: 10
  },
});