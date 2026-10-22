import { ActivityIndicator, Pressable, StyleSheet, Text } from "react-native";
import { colors, spacing } from "../theme";

type PrimaryButtonProps = {
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
};

// Shows a spinner and ignores taps while its request runs,
// so an impatient double-tap can't send the same request twice.
export function PrimaryButton({ title, onPress, loading = false, disabled = false }: PrimaryButtonProps) {
  const inactive = loading || disabled;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={inactive}
      style={({ pressed }) => [styles.primary, inactive && styles.inactive, pressed && styles.pressed]}
    >
      {loading ? <ActivityIndicator color={colors.primaryText} /> : <Text style={styles.primaryText}>{title}</Text>}
    </Pressable>
  );
}

type LinkButtonProps = {
  title: string;
  onPress: () => void;
  disabled?: boolean;
};

// A text-only button for secondary actions like "Change number".
export function LinkButton({ title, onPress, disabled = false }: LinkButtonProps) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} disabled={disabled} hitSlop={8}>
      <Text style={[styles.linkText, disabled && styles.linkDisabled]}>{title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  primary: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    minHeight: 50,
    justifyContent: "center",
  },
  inactive: { opacity: 0.6 },
  pressed: { opacity: 0.85 },
  primaryText: { color: colors.primaryText, fontSize: 16, fontWeight: "600" },
  linkText: { color: colors.primary, fontSize: 15, fontWeight: "600", paddingVertical: spacing.xs },
  linkDisabled: { color: colors.muted },
});
