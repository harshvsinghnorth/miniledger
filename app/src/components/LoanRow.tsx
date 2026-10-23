// expo-image, not React Native's <Image>: RN's Image didn't send our Authorization
// header on Android (the server log showed 401 for every thumbnail).
import { Image } from "expo-image";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { receiptImageSource, type Loan } from "../api";
import { dueLabel, formatRupees } from "../format";
import { colors, spacing } from "../theme";

type Props = {
  loan: Loan;
  token: string; // receipts load with the user's token
  today: string; // "YYYY-MM-DD" in India, for labels like "Due tomorrow"
  repaying: boolean; // this row's "Mark repaid" request is running
  uploading: boolean; // this row's receipt upload is running
  onMarkRepaid: (loan: Loan) => void;
  onAddReceipt: (loan: Loan) => void;
  onViewReceipt: (loan: Loan) => void;
};

// One loan in the list. Overdue loans get a red edge, a red tint and a badge,
// so they stand out even when scrolling quickly. Whether a loan is overdue is the
// server's decision (loan.isOverdue), so the list and the summary always agree.
export function LoanRow({ loan, token, today, repaying, uploading, onMarkRepaid, onAddReceipt, onViewReceipt }: Props) {
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

      <View style={styles.actions}>
        {!repaid ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => onMarkRepaid(loan)}
            disabled={repaying}
            style={({ pressed }) => [styles.actionButton, pressed && styles.pressed]}
          >
            {repaying ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Text style={styles.actionText}>Mark repaid</Text>
            )}
          </Pressable>
        ) : null}

        {uploading ? (
          <View style={styles.actionButton}>
            <ActivityIndicator size="small" color={colors.primary} />
          </View>
        ) : loan.receiptUrl ? (
          <Pressable accessibilityRole="imagebutton" accessibilityLabel="View receipt" onPress={() => onViewReceipt(loan)}>
            <Image source={receiptImageSource(token, loan.receiptUrl)} style={styles.thumbnail} contentFit="cover" />
          </Pressable>
        ) : (
          <Pressable
            accessibilityRole="button"
            onPress={() => onAddReceipt(loan)}
            style={({ pressed }) => [styles.actionButton, styles.secondaryButton, pressed && styles.pressed]}
          >
            <Text style={styles.secondaryText}>Add receipt</Text>
          </Pressable>
        )}
      </View>
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
  actions: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.sm },
  actionButton: {
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    minWidth: 110,
    minHeight: 34,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryButton: { borderColor: colors.border },
  pressed: { opacity: 0.7 },
  actionText: { color: colors.primary, fontWeight: "600", fontSize: 14 },
  secondaryText: { color: colors.text, fontWeight: "600", fontSize: 14 },
  thumbnail: { width: 44, height: 44, borderRadius: 6, backgroundColor: colors.border },
});
