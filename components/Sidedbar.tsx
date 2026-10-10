import React, { useState, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Dimensions,
  Animated,
  Image,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { useAuthStore } from "@/src/store/useStore";
import { useSettingsStore } from "@/src/store/useSettingsStore";
import Avatar from "@/components/Avatar";
import { Colors } from "@/constants/colors";
import { HugeiconsIcon } from "@hugeicons/react-native";
import {
  MoreHorizontalCircleIcon,
  Alert01Icon,
  UserIcon,
  Settings01Icon,
  CrownIcon,
  GiftIcon,
  HelpCircleIcon,
  Logout01Icon,
  ChevronRight,
  Plus,
  Contact,
  IdentityCardFreeIcons,
  SearchIcon,
  Route01Icon,
  Trophy,
} from "@hugeicons/core-free-icons";
import FindDriverModal from "./FindDriverModal";
// import { withDangerousMod } from "expo/config-plugins";
import { Glass, iosAlert } from "@/components/ios";

const SIDEBAR_WIDTH = 340;
const { height: SCREEN_HEIGHT } = Dimensions.get("window");

interface SidebarItem {
  id: string;
  icon: React.ComponentType<any>;
  label: string;
  badge?: number;
  onPress: () => void;
  danger?: boolean;
}

export default function SidedBar() {
  const { isAuthenticated, user, logout } = useAuthStore();
  const insets = useSafeAreaInsets();
  const { theme } = useSettingsStore();
  
  const [menuOpen, setMenuOpen] = useState(false);
  const menuAnim = useRef(new Animated.Value(0)).current;

  const [finderVisible, setFinderVisible] = useState(false);

  // WhatsApp-style Spring & Fade Animation
  const toggleMenu = () => {
    if (menuOpen) {
      Animated.timing(menuAnim, {
        toValue: 0,
        duration: 150,
        useNativeDriver: true,
      }).start(() => setMenuOpen(false));
    } else {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setMenuOpen(true);
      Animated.spring(menuAnim, {
        toValue: 1,
        friction: 8,
        tension: 80,
        useNativeDriver: true,
      }).start();
    }
  };

  const toggleSearch = () => {
    setFinderVisible(true);
  };

  const handleLogout = () => {
    iosAlert("Sign Out", "Are you sure?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign Out",
        style: "destructive",
        onPress: async () => {
          const { signOut } = await import("@/src/services/supabase");
          await signOut();
          logout();
          router.replace("/(auth)/login");
        },
      },
    ]);
  };

  const navItems: SidebarItem[] = [
    // { id: "home", icon: Home01Icon as any, label: "Home", onPress: () => router.push("/(main)") },
    { id: "profile", icon: UserIcon as any, label: "My Profile", onPress: () => router.navigate("/(main)/messages") },
    // { id: "messages", icon: Message02Icon as any, label: "Messages", onPress: () => router.push("/(main)/messages") },
    // {
    //   id: "trips",
    //   icon: Navigation01Icon as any,
    //   label: "Trip History",
    //   onPress: () => {
    //     const role = user?.role;
    //     if (role === "driver") router.push("/(driver)/history");
    //     else router.push("/(passenger)/history");
    //   },
    // },
    { id: "settings", icon: Settings01Icon as any, label: "Settings", onPress: () => router.navigate("/settings/account") },
    { id: "tiers", icon: CrownIcon as any, label: "Go Premium", onPress: () => router.push("/tiers") },
    { id: "program", icon: Trophy as any, label: "Join the Program", onPress: () => router.push("/program") },
    // { id: "free-rides", icon: Navigation01Icon as any, label: "Free Rides", onPress: () => router.push("/free-rides" as any) },
    { id: "route-history", icon: Route01Icon as any, label: "Route History", onPress: () => router.push("/route-history" as any) },
    { id: "referral", icon: GiftIcon as any, label: "Refer a Friend", onPress: () => iosAlert("Refer", "Coming soon!") },
    { id: "help", icon: HelpCircleIcon as any, label: "Help Centre", onPress: () => iosAlert("Help", "Support coming soon.") },
    // Dev-only: live reference for the iOS component kit (src/ui/). Stripped
    // from release bundles along with the __DEV__ branch.
    // ...(__DEV__
    //   ? [
    //       {
    //         id: "ios-kit",
    //         icon: SearchIcon as any,
    //         label: "iOS UI Kit (dev)",
    //         onPress: () => router.push("/ios-kit-demo" as any),
    //       } as SidebarItem,
    //     ]
    //   : []),
    { id: "logout", icon: Logout01Icon as any, label: "Sign Out", danger: true, onPress: handleLogout },
  ];

  const filteredNavItems = !isAuthenticated ? navItems.filter((i) => i.id !== "logout") : navItems;

  const isDark = theme === "dark";
  const textColor = isDark ? Colors.textWhite : Colors.text;
  const subTextColor = isDark ? Colors.textSecondary : Colors.textTertiary;
  
  // WhatsApp context menus must be solid to overlay background content cleanly
  const menuBgColor = isDark ? Colors.text : "#FFFFFF"; 
  const bg = isDark ? Colors.background : Colors.textWhite;
  const cardBg = isDark ? Colors.background : "#FFFFFF";
  const borderColor = isDark ? "rgba(255,255,255,0.08)" : "#E8ECF0";

  return (
    <View style={[styles.drawerTop, styles.containerTop, { backgroundColor: bg, paddingTop: insets.top + 5, paddingBottom: insets.bottom }, {borderTopLeftRadius: 50, borderBottomLeftRadius: 50, }]}>
      
      {/* WhatsApp style Invisible Dismiss Overlay */}
      {menuOpen && (
        <Pressable 
          style={[StyleSheet.absoluteFill, { zIndex: 9 }]} 
          onPress={toggleMenu} 
        />
      )}

      <View style={styles.drawer}>        
        <View style={{paddingBottom:42}}>
          <Image
            source={
              isDark
                ? require("../assets/images/emilgo_logo_white.png")
                : require("../assets/images/emilgo_logo_black.png")
            }
            style={styles.photoImg}
            resizeMode="contain"
          />
        </View>

        <Pressable onPress={toggleSearch} style={[styles.searchList, ]}>
          <HugeiconsIcon icon={SearchIcon} size={20} color={textColor} />
        </Pressable>

        <ScrollView style={{ flex: 1 ,borderTopWidth: 1, borderTopColor: "#6B6B6B3B", width: 260, marginLeft: 20  }}>
            {isAuthenticated ? (
              <View style={[styles.navList, styles.navListcontainer]}>
                {filteredNavItems.map((item) => (
                  <Pressable key={item.id} style={styles.navItem} onPress={() => { Haptics.impactAsync(); item.onPress(); }}>
                    <View style={styles.navIconBox}>
                      <HugeiconsIcon icon={item.icon as any} size={18} color={item.danger ? "#EF4444" : textColor} />
                    </View>
                    <Text style={[styles.navLabel, { color: item.danger ? "#EF4444" : textColor }]}>{item.label}</Text>
                    {!item.danger && <HugeiconsIcon icon={ChevronRight} size={14} color={subTextColor} />}
                  </Pressable>
                ))}
              </View>
            ) : (
              <Pressable style={[styles.signInContainer, {backgroundColor: cardBg },]} onPress={() => router.push("/(auth)/login")}>
                <HugeiconsIcon icon={Alert01Icon} size={45} color={Colors.gold} />
                <Text style={[styles.signInText, { color: subTextColor }]}>You are not Signed In !!</Text>
                <Text style={[styles.signInsubText, { color: Colors.gold }]}>Sign In</Text>
              </Pressable>
            )}
        </ScrollView>
      </View>

      <View style={[styles.drawerHeader, { backgroundColor: 'transparent' }]}>
          <View style={{ flexDirection: "row", gap: 8, justifyContent: 'space-between' }}>
              <View
                style={[
                  styles.avatarActive, { backgroundColor: borderColor },
                ]}
              >
                <Avatar
                  name={user?.full_name || "U"}
                  style={[ { margin: 1}]}
                  photoUri={user?.profile_photo}
                  size={35}
                />
              </View>

              
              <View style={{ flexDirection: "column", justifyContent: "flex-start" }}>
                <Text style={[styles.userName, { color: textColor }]}>{user?.full_name || "No user"}</Text>
                <View style={styles.roleContainer}>
                  <HugeiconsIcon icon={IdentityCardFreeIcons} size={16} color={Colors.primary} />
                  <Text style={[styles.userRole, { color: Colors.primary }]}>
                    {user?.role ? user.role.charAt(0).toUpperCase() + user.role.slice(1) : "no role"}
                  </Text>
                </View>
              </View>
          </View>
          
          <View style={styles.drawerRightIcon}>
          <Pressable onPress={toggleMenu} style={styles.menuList}>
              <HugeiconsIcon icon={MoreHorizontalCircleIcon} fill={textColor} size={25} color={textColor} />
            </Pressable>
            

            
            {/* WhatsApp Styled Animated Dropdown */}
            {menuOpen && (
              <Animated.View 
                style={[
                  styles.dropdown, 
                  { 
                    backgroundColor: menuBgColor, borderColor,
                    opacity: menuAnim,
                    transform: [
                      {
                        scale: menuAnim.interpolate({
                          inputRange: [0, 1],
                          outputRange: [0.6, 1],
                        })
                      },
                      {
                        translateX: menuAnim.interpolate({
                          inputRange: [0, 1],
                          outputRange: [80, 0], // Grows from the right edge
                        })
                      },
                      {
                        translateY: menuAnim.interpolate({
                          inputRange: [0, 1],
                          outputRange: [80, 0], // Grows from the bottom edge
                        })
                      }
                    ]
                  }
                ]}
            >
                <Glass
                    variant="regular"
                    interactive
                    radius={26}
                    style={StyleSheet.absoluteFill}
                    pointerEvents="none"
                    fallbackIntensity={40}
                    fallbackTint={isDark ? Colors.overlayLight : Colors.border}
                  />
                <Pressable 
                  style={({ pressed }) => [styles.dropdownItem, pressed && { backgroundColor: isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.03)" }]} 
                  onPress={() => { toggleMenu(); router.push("/(auth)/register"); }}
                >
                  <HugeiconsIcon icon={Plus} size={22} color={textColor} />
                  <Text style={[styles.dropdownText, { color: textColor }]}>Create New Account</Text>
                </Pressable>
                
                <View style={[styles.divider, { backgroundColor: isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.08)" }]} />
                
                <Pressable 
                  style={({ pressed }) => [styles.dropdownItem, pressed && { backgroundColor: isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.03)" }]} 
                  onPress={() => { toggleMenu(); router.push("/(auth)/login"); }}
                >
                  <HugeiconsIcon icon={Contact} size={22} color={textColor} />
                  <Text style={[styles.dropdownText, { color: textColor }]}>Add Existing Account</Text>
                </Pressable>
              </Animated.View>
            )}
          </View>
      </View>
      <Text style={[styles.version, { color: subTextColor }]}>Teqil v1.0.0</Text>

      <FindDriverModal
        visible={finderVisible}
        onClose={() => setFinderVisible(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  drawerTop: { position: "absolute", top: 0, bottom: 0, left: 0, height: SCREEN_HEIGHT, width: SIDEBAR_WIDTH, zIndex: 2, paddingRight: 40 },
  containerTop: { flex: 1, flexDirection: 'column', justifyContent: 'space-between' },
  drawer: { flex: 1 , flexDirection: 'column', zIndex: 2 },
  drawerHeader: { width: 260, marginLeft: 20, paddingHorizontal: 10, paddingLeft: 2, paddingVertical: 30, paddingBottom: 20, flexDirection: "row", justifyContent: "space-between", zIndex: 10, },
  avatarActive: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 100,
    // borderWidth: .5,
    padding: 0
  },


  // WhatsApp Style Dropdown UI
  dropdown: { 
    position: "absolute", 
    bottom: 50, 
    right: -10, 
    width: 260, 
    borderRadius: 26, 
    borderWidth: 1,
    paddingVertical: 8, 
    shadowColor: "#000", 
    shadowOpacity: 0.15, 
    shadowRadius: 18, 
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
    zIndex: 100 
  },
  dropdownItem: {
    paddingVertical: 20, 
    paddingHorizontal: 18,
    flexDirection: 'row', 
    gap: 16, 
    alignItems: 'center', 
    justifyContent: 'flex-start'
  },
  dropdownText: {
    fontFamily: "Poppins_400Regular", 
    fontSize: 15,
  },
  divider: {
    height: StyleSheet.hairlineWidth, 
    width: '90%',
    alignSelf: 'center'
  },

  roleContainer: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4
  },
  userName: { fontFamily: "Poppins_700Bold", fontSize: 16 },
  userRole: { fontFamily: "Poppins_400Regular", fontSize: 11, },
  drawerRightIcon: { justifyContent: "space-between", alignItems:'flex-start', flexDirection: 'row', gap: 16 },
  menuList: { alignItems: 'center', },
  searchList: {
    position: 'absolute',
    top: 45,
    left: 250,
    borderRadius: 30,
    padding: 6, 
    alignItems: 'center', 
    justifyContent:'center',
    // borderWidth: 1,
    zIndex: 500
  },
  photoImg: { width: 50, height: 50, alignSelf: "center" },
  navListcontainer: { borderRadius: 30, padding: 0, },
  navList: { paddingHorizontal: 0, marginVertical: 20, },
  navItem: { flexDirection: "row", alignItems: "center", borderRadius: 14, paddingHorizontal: 12, paddingVertical: 12, gap: 12, marginRight: 20 },
  navIconBox: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  navLabel: { flex: 1, fontFamily: "Poppins_500Medium", fontSize: 14 },
  signInContainer: {
    alignItems: "center", 
    borderRadius: 40, 
    marginTop: 30, 
    marginHorizontal: 20, 
    paddingVertical: 60
  },
  signInText: { fontFamily: "Poppins_600Semi", fontSize: 18, marginVertical: 15 },
  signInsubText: { fontFamily: "Poppins_600SemiBold", fontSize: 16 },
  version: { textAlign: "center", padding: 30, paddingVertical: 12, fontSize: 11 },
});