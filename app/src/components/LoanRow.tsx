import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import type { Loan } from "../api";
import { dueLabel, formatRupees } from "../format";
import { colors, spacing } from "../theme";

type Props = {
  loan: Loan;
  today: string; // "YYYY-MM-DD" in India, for labels like "Due tomorrow"
  repaying: boolean; // this row's "Mark repaid" request is running
  onMarkRepaid: (loan: Loan) => void;
};

// One loan in the list. Overdue loans get a red edge, a red tint and a badge,
// so they stand out even when scrolling quickly. Whether a loan is overdue is the
// server's decision (loan.isOverdue), so the list and the summary always agree.
export function LoanRow({ loan, today, repaying, onMarkRepaid }: Props) {
  const repaid = loan.repaidAt !== null;
  return (
    <View style={[styles.row, loan.isOverdue && styles.overdueRow, repaid && styles.repaidRow]}>
      <View style={styles.top}>
        <Text style={[styles.name, repaid && styles.mutedText]} numberOfLines={1}>
          {loan.friendName}
        </Text>
        <Text style={[styles.amount, repaid && styles.mutedText]}>{formatRupees(loan.amount)}</Text>
      </View>

      <View style={styles.bottom}>
        <Text style={[styles.label, loan.isOverdue && styles.overdueText, repaid && styles.repaidText]}>
          {dueLabel(loan, today)}
        </Text>
        {loan.isOverdue ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>OVERDUE</Text>
          </View>
        ) : null}
      </View>

      {!repaid ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => onMarkRepaid(loan)}
          disabled={repaying}
          style={({ pressed }) => [styles.repayButton, pressed && styles.pressed]}
        >
          {repaying ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Text style={styles.repayText}>Mark repaid</Text>
          )}
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderLeftWidth: 5,
    borderLeftColor: colors.border,
  },
  overdueRow: { borderLeftColor: colors.danger, backgroundColor: colors.dangerBackground },
  repaidRow: { borderLeftColor: colors.success },
  top: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  name: { flex: 1, fontSize: 17, fontWeight: "600", color: colors.text, marginRight: spacing.sm },
  amount: { fontSize: 17, fontWeight: "700", color: colors.text },
  mutedText: { color: colors.muted },
  bottom: { flexDirection: "row", alignItems: "center", marginTop: spacing.xs },
  label: { flex: 1, fontSize: 13, color: colors.muted },
  overdueText: { color: colors.danger, fontWeight: "600" },
  repaidText: { color: colors.success },
  badge: { backgroundColor: colors.danger, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  badgeText: { color: colors.primaryText, fontSize: 11, fontWeight: "700", letterSpacing: 0.5 },
  repayButton: {
    alignSelf: "flex-start",
    marginTop: spacing.sm,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    minWidth: 110,
    alignItems: "center",
  },
  pressed: { opacity: 0.7 },
  repayText: { color: colors.primary, fontWeight: "600", fontSize: 14 },
});
