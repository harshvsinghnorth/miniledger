import { StyleSheet, Text, TextInput, View, type TextInputProps } from "react-native";
import { colors, spacing } from "../theme";

type Props = TextInputProps & {
  label: string;
  error?: string | null;
  prefix?: string; // fixed text in front of the input, e.g. "+91"
};

// A labelled input with its error message underneath.
// Any normal TextInput prop (keyboardType, maxLength, ...) passes straight through.
export function TextField({ label, error, prefix, style, ...inputProps }: Props) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={[styles.box, error ? styles.boxError : null]}>
        {prefix ? <Text style={styles.prefix}>{prefix}</Text> : null}
        <TextInput placeholderTextColor={colors.muted} style={[styles.input, style]} {...inputProps} />
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { marginBottom: spacing.md },
  label: { fontSize: 14, fontWeight: "600", color: colors.text, marginBottom: spacing.xs },
  box: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    backgroundColor: colors.card,
    paddingHorizontal: spacing.md,
  },
  boxError: { borderColor: colors.danger },
  prefix: { fontSize: 17, color: colors.muted, marginRight: spacing.sm },
  input: { flex: 1, fontSize: 17, paddingVertical: 12, color: colors.text },
  error: { color: colors.danger, fontSize: 13, marginTop: spacing.xs },
});
