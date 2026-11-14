# Teqil - Nigerian Commercial Transport App

## Overview
Teqil is a mobile app for Nigerian commercial drivers, passengers, and park owners. Drivers earn fuel coins by staying on live trips, passengers join trips using unique codes and get live tracking, and park owners monitor operations.

## Architecture
- **Frontend**: React Native with Expo (SDK 54), TypeScript, Expo Router (file-based routing)
- **Backend**: Express.js server (port 5001) with landing page
- **State**: Zustand (persisted with AsyncStorage)
- **Database**: AsyncStorage for local persistence, Supabase for cloud sync (optional)
- **i18n**: i18next with English + Nigerian Pidgin

## Navigation Structure
```
app/
  _layout.tsx              # Root layout (fonts, providers, auth check)
  index.tsx                # Auth redirect screen
  (auth)/                  # Auth modal flow
    welcome.tsx            # Role selection + landing
    login.tsx              # Sign in
    register.tsx           # Sign up
    driver-profile.tsx     # Driver profile completion (mandatory)
  (driver)/                # Driver tabs (NativeTabs/iOS 26 liquid glass)
    index.tsx              # Dashboard + stats
    create-trip.tsx        # Create new trip
    history.tsx            # Trip history
    messages.tsx           # Park broadcasts
  (passenger)/             # Passenger tabs
    index.tsx              # Dashboard
    find-trip.tsx          # Enter code + join trip
    history.tsx            # Trip history
  (park-owner)/            # Park owner tabs
    index.tsx              # Dashboard + broadcast
    drivers.tsx            # Driver management
    alerts.tsx             # Emergency alerts
  live-trip/
    [code].tsx             # Live trip view (driver + passenger)
```

## User Roles
1. **Driver** - Earns coins on trips, must Submit Details first, gets permanent Driver ID (DRV-XXXXXX)
2. **Passenger** - Joins trips via 6-char code, shares live location with emergency contacts
3. **Park Owner** - Monitors park drivers, sends broadcasts, sees emergency alerts

## Key Features (Step 1 Complete)
- Full navigation structure with beautiful green/white branding
- Role selection on welcome screen
- Authentication screens (login/register) with Supabase integration
- Driver profile completion flow with Driver ID display
- Driver dashboard with earnings counter and pulsing START TRIP button
- Passenger dashboard with FIND TRIP button and trip search
- Park owner dashboard with stats and broadcast system
- Live trip view with route visualization, SOS button, earnings counter
- Trip history for both drivers and passengers
- i18n: English + Nigerian Pidgin (Pidgin)
- AsyncStorage-based local storage (offline-first)
- Poppins font family throughout

## Design System
- **Primary**: #00A651 (Nigerian green)
- **Gold**: #F5A623 (coin/earnings color)
- **Font**: Poppins (400, 500, 600, 700)
- **Currency**: Nigerian Naira (₦)
- **Tab bars**: NativeTabs with liquid glass (iOS 26+), classic Tabs with BlurView otherwise

## Environment Variables
- `EXPO_PUBLIC_SUPABASE_URL` - Supabase project URL
- `EXPO_PUBLIC_SUPABASE_ANON_KEY` - Supabase anonymous key
- `EXPO_PUBLIC_DOMAIN` - Set automatically by Replit

## Next Steps (User-Confirmed Steps)
- Step 2: Full authentication flow with Supabase
- Step 3: Driver profile completion
- Step 4-6: Trip creation, join trip, live trip features
- Step 7: AI Journey Assistant
- Step 8: Emergency contacts & SMS
- Step 9: Ratings system
- Step 10: Park owner full dashboard
- Step 11: Multi-language refinement
- Step 12: Offline sync with WatermelonDB (if native build available)
- Step 13: Trip sharing with deep links

## Packages Installed
- @supabase/supabase-js, zustand, i18next, react-i18next
- react-hook-form, @hookform/resolvers
- @expo-google-fonts/poppins
- react-native-maps@1.18.0 (Expo Go compatible)
- All standard Expo Go packages
