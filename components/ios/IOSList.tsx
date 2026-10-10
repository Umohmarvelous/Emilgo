// components/ios/IOSList.tsx
//
// The app's grouped settings list.
//
//   <IOSListSection header="Privacy" footer="Free rides always track.">
//     <IOSListRow symbol="location.fill" label="Share Location"
//                 accessory={{ type: "switch", value: on, onValueChange: setOn }} />
//     <IOSListRow symbol="map" label="Route History" accessory={{ type: "disclosure" }}
//                 onPress={…} />
//   </IOSListSection>
//
// ── Design ───────────────────────────────────────────────────────────────────
// This follows EMILGO's own settings design, not Apple's inset-grouped table:
//
//   • 30pt card corners, not 10pt.
//   • Poppins throughout — 14pt medium labels, 12pt regular descriptions.
//   • 20pt horizontal / 16pt vertical row padding with a 15pt gap, so rows
//     breathe more than a system list.
//   • Full-width hairline separators between rows, not label-inset ones.
//
// The one thing that is NOT from the original: the icon tile. It used to be a
// bare 34pt box, and the iOS-kit version that replaced it was a solid coloured
// square with a white glyph. Both are gone — the tile is now a Liquid Glass
// surface with the glyph tinted on top, so it reads as translucent chrome
// rather than a block of colour.

import React, { Children, isValidElement, cloneElement } from "react";
import { View, Text, Pressable, StyleSheet, type ViewStyle } from "react-native";
import { SymbolView, type SymbolViewProps } from "expo-symbols";

import { useIOSTheme, IOSMetrics, IOSAppFont } from "./theme";
import { Glass } from "./Glass";
import { IOSToggle } from "./IOSToggle";
import { HugeiconsIcon } from "@hugeicons/react-native";
import { Colors } from "@/constants/colors";

// ─── Row ─────────────────────────────────────────────────────────────────────

export type IOSListAccessory =
  | { type: "disclosure" }
  | { type: "switch"; value: boolean; onValueChange: (v: boolean) => void }
  | { type: "checkmark"; checked: boolean }
  | { type: "detail"; text: string }
  | { type: "none" };

export interface IOSListRowProps {
  label: string;
  /** Secondary line under the label. */
  detail?: string;
  symbol?: SymbolViewProps["name"];
  /**
   * Glyph tint. Defaults to the label colour, matching the original design
   * where icons were monochrome rather than colour-coded.
   */
  symbolColor?: string;
  /** Render something other than an SF Symbol in the tile — e.g. a Hugeicon. */
  icon?: React.ReactNode;
  accessory?: IOSListAccessory;
  onPress?: () => void;
  destructive?: boolean;
  disabled?: boolean;
  /** Briefly tinted after a settings-search deep link. See useHighlight. */
  highlighted?: boolean;
  /** Injected by IOSListSection — don't set manually. */
  __isLast?: boolean;
}

export function IOSListRow({
  label,
  detail,
  symbol,
  symbolColor,
  icon,
  accessory = { type: "none" },
  onPress,
  destructive,
  disabled,
  highlighted,
  __isLast,
}: IOSListRowProps) {
  const theme = useIOSTheme();
  const labelColor = destructive ? theme.systemRed : theme.label;
  const glyphColor = destructive ? theme.systemRed : (symbolColor ?? theme.label);

  const interactive = !!onPress && accessory.type !== "switch";
  const hasTile = !!symbol || !!icon;

  const body = (
    <View >

      {/* <Text
        numberOfLines={1}
        style={[IOSAppFont.label, { color: labelColor, opacity: disabled ? 0.4 : 1 }]}
      >
        {label}
      </Text> */}
        
      <View style={[styles.rowInner,
        // { borderWidth: .5, borderColor: theme.opaqueSeparator, backgroundColor: theme.secondarySystemBackground, borderRadius: CARD_RADIUS }
      ]}>
        {/* <Glass
          variant="clear"
          radius={30}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
          fallbackIntensity={30}
          fallbackTint={theme.secondarySystemBackground}
        /> */}
        {hasTile && (
          <View style={styles.iconTile}>
            {/* Glass tile, not a coloured block. */}
            {/* <Glass
              variant="clear"
              radius={10}
              style={StyleSheet.absoluteFill}
              pointerEvents="none"
              fallbackIntensity={30}
              fallbackTint={theme.tertiarySystemFill}
            /> */}
            {icon ??
              (symbol ? (
                <>
                  <SymbolView name={symbol} size={24} tintColor={glyphColor} fallback={null} />
                {/* <HugeiconsIcon icon={symbol as any}  size={22}  />                 */}
                </>
              ) : null)}
          </View>
        )}



        <View style={styles.rowText}>
          <Text
            numberOfLines={1}
            style={[IOSAppFont.label, { color: labelColor, opacity: disabled ? 0.4 : 1 }]}
          >
            {label}
          </Text>

          {detail ? (
            <Text numberOfLines={3} style={[IOSAppFont.description, { color: theme.secondaryLabel }]}>
              {detail}
            </Text>
          ) : null}
        </View>

        {accessory.type === "switch" && (
          <IOSToggle
            value={accessory.value}
            onValueChange={accessory.onValueChange}
            disabled={disabled}
            accessibilityLabel={label}
          />
        )}
        {accessory.type === "detail" && (
          <Text style={[IOSAppFont.value, { color: theme.secondaryLabel }]}>{accessory.text}</Text>
        )}
        {accessory.type === "checkmark" && accessory.checked && (
          <SymbolView name="checkmark" size={16} tintColor={theme.tint} fallback={null} />
        )}
        {accessory.type === "disclosure" && (
          <SymbolView name="chevron.right" size={14} tintColor={theme.tertiaryLabel} fallback={null} />
        )}
      </View>
    </View>
    
  );

  return (
    <View>
      {interactive ? (
        <Pressable
          onPress={onPress}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityHint={detail}
          accessibilityState={{ disabled: !!disabled }}
          style={({ pressed }) => [
            styles.row,
            highlighted && { backgroundColor: theme.tint + "26" },
            // pressed && { backgroundColor: theme.systemFill },
            pressed && { backgroundColor: "transparent" },
          ]}
        >
          {body}
        </Pressable>
      ) : (
        <View style={[styles.row, highlighted && { backgroundColor: theme.tint + "26" }]}>
          {body}
        </View>
      )}

      {/* Full-bleed hairline between rows, as the original design had it. */}
      {!__isLast && <View style={[styles.separator, { backgroundColor: theme.separator }]} />}
    </View>
  );
}

// ─── Section ─────────────────────────────────────────────────────────────────

export interface IOSListSectionProps {
  children: React.ReactNode;
  /** Uppercase caption above the group. */
  header?: string;
  /** Explanatory text below the group. */
  footer?: string;
  /**
   * Render the group on an opaque card instead of Liquid Glass.
   *
   * Glass is the default here because these groups sit on the settings screens,
   * where the whole point of the redesign is that surfaces are translucent.
   * Turn it off for a group layered over another glass surface — glass on glass
   * is the one combination Apple singles out as breaking the effect.
   */
  opaque?: boolean;
  style?: ViewStyle;
}

export function IOSListSection({
  children,
  header,
  footer,
  opaque = false,
  style,
}: IOSListSectionProps) {
  const theme = useIOSTheme();

  const rows = Children.toArray(children).filter(isValidElement);
  const lastIndex = rows.length - 1;

  const body = rows.map((child, i) =>
    cloneElement(child as React.ReactElement<IOSListRowProps>, {
      key: i,
      __isLast: i === lastIndex,
    }),
  );

  return (
    <View style={[styles.section, style, { }]}>
      {header ? (
        <Text style={[IOSAppFont.sectionTitle, styles.header, { color: theme.label }]}>
          {header.toUpperCase()}
        </Text>
      ) : null}

      {opaque ? (
        <View style={[styles.group, { backgroundColor: theme.tertiarySystemFill}]}>
          {body}
        </View>
      ) : (
        // <Glass
        //   variant="none"
        //   radius={CARD_RADIUS}
        //   style={styles.group}
        //   // fallbackIntensity={0}
        //   fallbackTint={theme.tertiarySystemFill}
        //   >
        // </Glass>
        <View style={[styles.group, { backgroundColor: theme.tertiarySystemFill, borderRadius: CARD_RADIUS}]}>
          {body}
        </View>
      )}

      {footer ? (
        <Text style={[IOSAppFont.description, styles.footer, { color: theme.secondaryLabel }]}>
          {footer}
        </Text>
      ) : null}
    </View>
  );
}

/** The app's card radius — deliberately much rounder than a system list. */
const CARD_RADIUS = 30;

const styles = StyleSheet.create({
  section: { marginVertical: 5 },
  header: { paddingHorizontal: 4, marginVertical: 12 },
  footer: { marginHorizontal: 4, marginTop: 10 },
  group: { overflow: "hidden", paddingHorizontal: 20 },
  row: { minHeight: IOSMetrics.minTouchTarget, justifyContent: "center" },
  rowInner: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 22,
    gap: 15, 
  },
  iconTile: {
    // width: 34,
    // height: 34,
    // borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    flexShrink: 0,
  },
  rowText: { flex: 1 },
  separator: { height: StyleSheet.hairlineWidth, marginHorizontal: 20 },
});

export default IOSListSection;
