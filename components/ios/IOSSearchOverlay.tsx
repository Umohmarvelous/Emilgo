// components/ios/IOSSearchOverlay.tsx
//
// Full-screen search, presented over whatever screen asked for it — the
// Spotlight pattern: one live field, a filter row, and results grouped by where
// they live, so a hit tells you both what it is and where it came from.
//
// ── Why an overlay and not an inline list ────────────────────────────────────
// The page underneath is a scroll view with its own tabs and pinned chrome.
// Growing a result list inside it would push that chrome around and leave the
// user searching inside the thing they're searching. An overlay suspends the
// page instead: the field is the only thing that matters while it's open.
//
// ── Presentation ─────────────────────────────────────────────────────────────
// `animationType="slide"`, deliberately, not "fade". A fade animates the
// modal's alpha, and this surface is full of glass — animating alpha above a
// GlassView renders the effect incorrectly (expo/expo#41024). Slide is a
// transform, so the glass survives the transition intact.
//
// ── Empty state ──────────────────────────────────────────────────────────────
// An empty field shows recents and suggestions rather than nothing. The first
// tap on a search field is usually a repeat of the last one, and a blank sheet
// makes the user retype it.

import React, { useMemo } from "react";
import {
  View,
  Text,
  Modal,
  Pressable,
  SectionList,
  StyleSheet,
  type ViewStyle,
  type StyleProp,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SymbolView, type SymbolViewProps } from "expo-symbols";

import { haptics } from "@/src/utils/haptics";
import { useIOSTheme, IOSAppFont, IOSFont, IOSMetrics } from "./theme";
import { Glass } from "./Glass";
import { IOSSearchBar } from "./IOSSearchBar";
import { IOSFilterChips, type IOSFilterChip } from "./IOSFilterChips";

export interface IOSSearchResult {
  id: string;
  title: string;
  subtitle?: string;
  /** SF Symbol name for the leading tile. */
  symbol?: string;
  /** Heading this result is listed under, e.g. "Account Settings". */
  group: string;
  /** Short trailing hint, e.g. "Opens Privacy". */
  hint?: string;
  onPress: () => void;
}

export interface IOSSearchOverlayProps<F extends string = string> {
  visible: boolean;
  onClose: () => void;

  query: string;
  onChangeQuery: (q: string) => void;
  placeholder?: string;

  filters?: IOSFilterChip<F>[];
  activeFilter?: F;
  onChangeFilter?: (key: F) => void;

  results: IOSSearchResult[];

  /** Previous queries, most recent first. */
  recents?: string[];
  onSelectRecent?: (q: string) => void;
  onClearRecents?: () => void;
  /** Things worth searching for that the user may not know exist. */
  suggestions?: string[];

  /** Extra copy under the "no results" glyph. */
  emptyHint?: string;
  style?: StyleProp<ViewStyle>;
}

export function IOSSearchOverlay<F extends string = string>({
  visible,
  onClose,
  query,
  onChangeQuery,
  placeholder = "Search",
  filters,
  activeFilter,
  onChangeFilter,
  results,
  recents,
  onSelectRecent,
  onClearRecents,
  suggestions,
  emptyHint,
  style,
}: IOSSearchOverlayProps<F>) {
  const theme = useIOSTheme();
  const insets = useSafeAreaInsets();

  // Group in declaration order rather than alphabetically: the index that fed
  // us the results already ranked them, and re-sorting would throw that away.
  const sections = useMemo(() => {
    const order: string[] = [];
    const buckets = new Map<string, IOSSearchResult[]>();

    for (const r of results) {
      if (!buckets.has(r.group)) {
        buckets.set(r.group, []);
        order.push(r.group);
      }
      buckets.get(r.group)!.push(r);
    }

    return order.map((title) => ({ title, data: buckets.get(title)! }));
  }, [results]);

  const searching = query.trim().length > 0;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={[styles.root, { backgroundColor: theme.systemGroupedBackground }, style]}>
        {/* A blurred wash rather than a flat fill, so the surface still reads as
            floating above the page it was opened from. */}
        <Glass
          variant="regular"
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
          fallbackIntensity={90}
          fallbackTint={
            theme.scheme === "dark" ? "rgba(7,7,7,0.94)" : "rgba(255,255,255,0.94)"
          }
          androidTint={theme.scheme === "dark" ? "rgba(7,7,7,0.98)" : "rgba(255,255,255,0.98)"}
        />

        <View style={[styles.header, { paddingTop: insets.top + 8,  paddingHorizontal: IOSMetrics.groupedInset, 
 }]}>
          <IOSSearchBar
            value={query}
            onChangeText={onChangeQuery}
            placeholder={placeholder}
            active
            autoFocusOnMount
            onCancel={onClose}
          />

          {filters && activeFilter !== undefined && onChangeFilter ? (
            <IOSFilterChips
              chips={filters}
              active={activeFilter}
              onChange={onChangeFilter}
              style={styles.chips}
            />
          ) : null}
        </View>

        <SectionList
          sections={searching ? sections : []}
          keyExtractor={(item) => item.id}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[
            styles.list,
            { paddingBottom: insets.bottom + 40 },
          ]}
          stickySectionHeadersEnabled={false}
          renderSectionHeader={({ section }) => (
            <Text style={[IOSAppFont.sectionTitle, styles.sectionTitle, { color: theme.secondaryLabel }]}>
              {section.title.toUpperCase()}
            </Text>
          )}
          renderItem={({ item }) => (
            <ResultRow
              item={item}
              onPress={() => {
                haptics.tap();
                item.onPress();
              }}
            />
          )}
          ListEmptyComponent={
            searching ? (
              <View style={styles.empty}>
                <SymbolView
                  name="magnifyingglass"
                  size={44}
                  tintColor={theme.tertiaryLabel}
                  fallback={null}
                />
                <Text style={[IOSFont.headline, { color: theme.label }]}>
                  No results for “{query.trim()}”
                </Text>
                {emptyHint ? (
                  <Text
                    style={[
                      IOSAppFont.description,
                      styles.centre,
                      { color: theme.secondaryLabel },
                    ]}
                  >
                    {emptyHint}
                  </Text>
                ) : null}
              </View>
            ) : (
              <IdleState
                recents={recents}
                suggestions={suggestions}
                onSelect={(q) => {
                  haptics.tap();
                  (onSelectRecent ?? onChangeQuery)(q);
                }}
                onClearRecents={onClearRecents}
              />
            )
          }
        />
      </View>
    </Modal>
  );
}

// ─── Row ─────────────────────────────────────────────────────────────────────

function ResultRow({ item, onPress }: { item: IOSSearchResult; onPress: () => void }) {
  const theme = useIOSTheme();

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: pressed ? theme.systemFill : "transparent" },
      ]}
      accessibilityRole="button"
      accessibilityLabel={item.subtitle ? `${item.title}. ${item.subtitle}` : item.title}
    >
      <View style={[styles.tile]}>
        <Glass
          variant="clear"
          radius={11}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
          fallbackIntensity={25}
          fallbackTint={theme.secondarySystemBackground}
          // fallbackTint={theme.systemBackground}
        />
        <SymbolView
          name={(item.symbol ?? "magnifyingglass") as SymbolViewProps["name"]}
          size={19}
          tintColor={theme.label}
          fallback={null}
        />
      </View>

      <View style={styles.rowText}>
        <Text numberOfLines={1} style={[IOSAppFont.label, { color: theme.label }]}>
          {item.title}
        </Text>
        {item.subtitle ? (
          <Text
            numberOfLines={1}
            style={[IOSAppFont.description, { color: theme.secondaryLabel }]}
          >
            {item.subtitle}
          </Text>
        ) : null}
      </View>

      {item.hint ? (
        <Text style={[IOSAppFont.description, { color: theme.tertiaryLabel }]}>
          {item.hint}
        </Text>
      ) : null}

      <SymbolView
        name="chevron.right"
        size={13}
        tintColor={theme.tertiaryLabel}
        fallback={null}
      />
    </Pressable>
  );
}

// ─── Idle ────────────────────────────────────────────────────────────────────

function IdleState({
  recents,
  suggestions,
  onSelect,
  onClearRecents,
}: {
  recents?: string[];
  suggestions?: string[];
  onSelect: (q: string) => void;
  onClearRecents?: () => void;
}) {
  const theme = useIOSTheme();
  const hasRecents = !!recents?.length;

  return (
    <View style={styles.idle}>
      {hasRecents && (
        <>
          <View style={styles.idleHead}>
            <Text style={[IOSAppFont.sectionTitle, { color: theme.secondaryLabel }]}>
              RECENT
            </Text>
            {onClearRecents && (
              <Pressable onPress={onClearRecents} hitSlop={10}>
                <Text style={[IOSAppFont.label, { color: theme.tint }]}>Clear all</Text>
              </Pressable>
            )}
          </View>

          {recents!.map((q) => (
            <Pressable
              key={q}
              onPress={() => onSelect(q)}
              style={({ pressed }) => [
                styles.row,
                { backgroundColor: pressed ? theme.systemFill : "transparent" },
              ]}
            >
              <View style={styles.tile}>

                <SymbolView
                  name="clock.arrow.circlepath"
                  size={20}
                  tintColor={theme.secondaryLabel}
                  fallback={null}
                />
              </View>
              <Text style={[IOSAppFont.label, styles.rowText, { color: theme.label }]}>
                {q}
              </Text>
            </Pressable>
          ))}
        </>
      )}

      {/* {!!suggestions?.length && (
        <>
          <Text
            style={[
              IOSAppFont.sectionTitle,
              styles.sectionTitle,
              { color: theme.secondaryLabel, marginTop: hasRecents ? 22 : 4 },
            ]}
          >
            TRY SEARCHING FOR
          </Text>
          <View style={styles.suggestions}>
            {suggestions.map((s) => (
              <Pressable
                key={s}
                onPress={() => onSelect(s)}
                style={styles.suggestion}
                accessibilityRole="button"
              >
                <Glass
                  variant="clear"
                  radius={30}
                  interactive
                  style={StyleSheet.absoluteFill}
                  pointerEvents="none"
                  fallbackIntensity={24}
                  fallbackTint={theme.tertiarySystemFill}
                />
                <Text style={[IOSAppFont.label, { color: theme.label }]}>{s}</Text>
              </Pressable>
            ))}
          </View>
        </>
      )} */}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingBottom: 10, gap: 12 },
  chips: { marginTop: 2 },
  list: { paddingTop: 6 },
  sectionTitle: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 6 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 11,
    minHeight: 44,
  },
  tile: {
    width: 34,
    height: 34,
    borderRadius: 11,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  rowText: { flex: 1, gap: 1 },
  empty: { alignItems: "center", paddingTop: 90, paddingHorizontal: 40, gap: 12 },
  centre: { textAlign: "center" },
  idle: { paddingTop: 4 },
  idleHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 6,
  },
  suggestions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingHorizontal: 20,
  },
  suggestion: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 30,
    overflow: "hidden",
  },
});

export default IOSSearchOverlay;
