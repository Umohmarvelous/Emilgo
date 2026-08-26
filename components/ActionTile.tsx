// import React, { useRef } from "react";
// import { View, Text, StyleSheet, Pressable, Animated } from "react-native";
// import { Ionicons } from "@expo/vector-icons";


// interface ActionTileProps {
//   icon: keyof typeof Ionicons.glyphMap;
//   label: string;
//   color: string;
//   onPress: () => void;
// }

// export default function ActionTile({ icon, label, color, onPress }: ActionTileProps) {
//   const scale = useRef(new Animated.Value(1)).current;

//   const animateIn = () => {
//     Animated.spring(scale, {
//       toValue: 0.92,
//       damping: 12,
//       stiffness: 200,
//       useNativeDriver: true,
//     }).start();
//   };

//   const animateOut = () => {
//     Animated.spring(scale, {
//       toValue: 1,
//       damping: 10,
//       stiffness: 180,
//       useNativeDriver: true,
//     }).start();
//   };

//   return (
//     <Animated.View style={styles.actionTile}>
//       <Pressable
//         onPress={onPress}
//         onPressIn={animateIn}
//         onPressOut={animateOut}
//         style={styles.actionTileInner}
//       >
//         <View style={[styles.actionIconWrap]}>
//           <Ionicons name={icon} size={25} color={color} />
//           <Text style={[styles.actionLabel, { color: color }]}>{label}</Text>
//         </View>
//       </Pressable>
//     </Animated.View>
//   );
// }

// const styles = StyleSheet.create({
//   actionTile: {
//     // width: (W - 32 - 36 - 24) / 3,
//     alignItems: 'center',
//     justifyContent: 'center',
//   },
//   actionTileInner: {
//     alignItems: "center",
//     gap: 0
//   },
//   actionIconWrap: {
//     width: 60,
//     height: 60,
//     // padding: 6,
//     gap: 5,
//     borderRadius: 56,
//     alignItems: "center",
//     justifyContent: "center",
//   },
//   actionLabel: {
//     fontFamily: "Poppins_500Medium",
//     fontSize: 10,
//     textAlign: "center",
//     color: "#000",
//     // lineHeight: 10,
//   },
// });


// import React, { useRef } from "react";
// import { View, Text, StyleSheet, Pressable, Animated } from "react-native";
// import { Ionicons } from "@expo/vector-icons";


// interface ActionTileProps {
//   icon: keyof typeof Ionicons.glyphMap;
//   label: string;
//   color: string;
//   onPress: () => void;
// }

// export default function ActionTile({ icon, label, color, onPress }: ActionTileProps) {
//   const scale = useRef(new Animated.Value(1)).current;

//   const animateIn = () => {
//     Animated.spring(scale, {
//       toValue: 0.92,
//       damping: 12,
//       stiffness: 200,
//       useNativeDriver: true,
//     }).start();
//   };

//   const animateOut = () => {
//     Animated.spring(scale, {
//       toValue: 1,
//       damping: 10,
//       stiffness: 180,
//       useNativeDriver: true,
//     }).start();
//   };

//   return (
//     <Animated.View style={styles.actionTile}>
//       <Pressable
//         onPress={onPress}
//         onPressIn={animateIn}
//         onPressOut={animateOut}
//         style={styles.actionTileInner}
//       >
//         <View style={[styles.actionIconWrap]}>
//           <Ionicons name={icon} size={25} color={color} />
//           <Text style={[styles.actionLabel, { color: color }]}>{label}</Text>
//         </View>
//       </Pressable>
//     </Animated.View>
//   );
// }

// const styles = StyleSheet.create({
//   actionTile: {
//     // width: (W - 32 - 36 - 24) / 3,
//     alignItems: 'center',
//     justifyContent: 'center',
//   },
//   actionTileInner: {
//     alignItems: "center",
//     gap: 0
//   },
//   actionIconWrap: {
//     width: 60,
//     height: 60,
//     // padding: 6,
//     gap: 5,
//     borderRadius: 56,
//     alignItems: "center",
//     justifyContent: "center",
//   },
//   actionLabel: {
//     fontFamily: "Poppins_500Medium",
//     fontSize: 10,
//     textAlign: "center",
//     color: "#000",
//     // lineHeight: 10,
//   },
// });



// components/ActionTile.tsx
import React, { useRef } from "react";
import { View, Text, StyleSheet, Pressable, Animated } from "react-native";
import { HugeiconsIcon } from "@hugeicons/react-native";
import { Colors } from "@/constants/colors";
import { useSettingsStore } from "@/src/store/useSettingsStore";
import { Glass } from "./ios";

// We'll pass the icon component directly instead of name string
interface ActionTileProps {
  icon: React.ComponentType<any>; // Hugeicons icon component
  label: string;
  color: string;
  onPress: () => void;
}

export default function ActionTile({ icon: IconComponent, label, color, onPress }: ActionTileProps) {
  const { theme } = useSettingsStore();

  const isDark = theme === "dark";
  // const ActionTileIcon = isDark ? "rgba(120,120,128,0.22)" : "rgba(120,120,128,0.12)";
  const ActionTileIcon = isDark ? Colors.overlay : Colors.background;
  const textColor = isDark ? Colors.textWhite : Colors.text;
  const borderColor = isDark ? "rgba(255,255,255,0.08)" : "#E8ECF0";

  const scale = useRef(new Animated.Value(1)).current;

  const animateIn = () => {
    Animated.spring(scale, {
      toValue: 0.92,
      damping: 12,
      stiffness: 200,
      useNativeDriver: true,
    }).start();
  };

  const animateOut = () => {
    Animated.spring(scale, {
      toValue: 1,
      damping: 10,
      stiffness: 180,
      useNativeDriver: true,
    }).start();
  };

  return (
    <Animated.View style={styles.actionTile}>
      <Pressable
        onPress={onPress}
        onPressIn={animateIn}
        onPressOut={animateOut}
        style={styles.actionTileInner}
      >
        <View style={[styles.actionIconWrap]}>
          <View style={{  backgroundColor: ActionTileIcon, borderWidth: 4, borderColor: borderColor, padding: 9, borderRadius: 50, opacity: isDark ? 9 : 9 }} >
            <Glass
              variant="regular"
              interactive
              radius={50}
              style={StyleSheet.absoluteFill}
              pointerEvents="none"
              fallbackIntensity={40}
              fallbackTint={isDark ? Colors.overlayLight : Colors.border}
            />
            <HugeiconsIcon icon={IconComponent as any}  size={26} color={color}/>
          </View>
          <Text style={[styles.actionLabel, { color: textColor }]}>{label}</Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  actionTile: {
    alignItems: "center",
    justifyContent: "center",
    // borderWidth: 2, borderColor: 'red',
  },
  actionTileInner: {
    alignItems: "center",
    gap: 0,
    // marginBottom: 15
  },
  actionIconWrap: {
    width: 60,
    height: 'auto',
    gap: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  actionLabel: {
    fontFamily: "Poppins_500Medium",
    fontSize: 10,
    textAlign: "center", 
  },
});

