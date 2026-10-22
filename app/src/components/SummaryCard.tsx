import { StyleSheet, Text, View } from "react-native";
import type { Summary } from "../api";
import { formatRupees } from "../format";
import { colors, spacing } from "../theme";

// The three totals at the top of the home screen. All numbers come from the server's
// /loans/summary endpoint (computed in SQL), not added up on the phone.
export function SummaryCard({ summary }: { summary: Summary }) {
  const hasOverdue = summary.overdueAmount > 0;
  return (
    <View style={styles.card}>
      <View style={styles.tile}>
        <Text style={styles.label}>Total lent</Text>
        <Text style={styles.value}>{formatRupees(summary.totalLent)}</Text>
      </View>
      <View style={styles.divider} />
      <View style={styles.tile}>
        <Text style={styles.label}>Repaid</Text>
        <Text style={[styles.value, styles.repaid]}>{formatRupees(summary.totalRepaid)}</Text>
      </View>
      <View style={styles.divider} />
      <View style={styles.tile}>
        <Text style={styles.label}>Overdue</Text>
        <Text style={[styles.value, hasOverdue && styles.overdue]}>{formatRupees(summary.overdueAmount)}</Text>
        {hasOverdue ? (
          <Text style={styles.caption}>
            {summary.overdueCount} {summary.overdueCount === 1 ? "loan" : "loans"}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    backgroundColor: colors.card,
    borderRadius: 16,
    paddingVertical: spacing.md,
    marginBottom: spacing.lg,
    elevation: 2,
  },
  tile: { flex: 1, alignItems: "center", paddingHorizontal: spacing.xs },
  divider: { width: 1, backgroundColor: colors.border },
  label: { fontSize: 13, color: colors.muted, marginBottom: spacing.xs },
  value: { fontSize: 17, fontWeight: "700", color: colors.text },
  repaid: { color: colors.success },
  overdue: { color: colors.danger },
  caption: { fontSize: 12, color: colors.danger, marginTop: 2 },
});
