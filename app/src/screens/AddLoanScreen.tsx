import DateTimePicker from "@react-native-community/datetimepicker";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ApiError, api, type Loan } from "../api";
import { LinkButton, PrimaryButton } from "../components/Button";
import { TextField } from "../components/TextField";
import { addDays, dateInIndia, dueLabel, formatDate, fromIsoDate, toIsoDate } from "../format";
import { colors, spacing } from "../theme";

type Props = {
  token: string;
  onCancel: () => void;
  onSaved: (loan: Loan) => void;
  onSessionExpired: () => void;
};

type Field = "friendName" | "amount" | "dueDate";
type Errors = Partial<Record<Field, string>>;

// Udhaar is usually given for round periods, so offer them as one-tap choices.
const QUICK_DUE_DATES = [
  { label: "1 week", days: 7 },
  { label: "2 weeks", days: 14 },
  { label: "1 month", days: 30 },
];

// Instant checks, so obvious mistakes don't need a trip to the server.
// The server still checks everything (anyone can call the API without this app).
function validate(friendName: string, amount: string): Errors {
  const errors: Errors = {};
  if (!friendName.trim()) {
    errors.friendName = "Enter your friend's name";
  }
  if (!/^\d+(\.\d{1,2})?$/.test(amount.trim())) {
    errors.amount = "Enter an amount like 1500 or 250.50";
  } else if (Number(amount) <= 0) {
    errors.amount = "Amount must be more than ₹0";
  }
  return errors;
}

export function AddLoanScreen({ token, onCancel, onSaved, onSessionExpired }: Props) {
  const today = dateInIndia(new Date());
  const [friendName, setFriendName] = useState("");
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState(addDays(today, 7)); // default: a week from today
  const [showPicker, setShowPicker] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // The user tapped OK. (On Android the dialog closes itself; stop rendering it.)
  function onPickDate(picked: Date) {
    setShowPicker(false);
    setDueDate(toIsoDate(picked));
  }

  async function save() {
    const found = validate(friendName, amount);
    setErrors(found);
    setFormError(null);
    if (Object.keys(found).length > 0) {
      return;
    }

    setSaving(true);
    try {
      const loan = await api.createLoan(token, { friendName: friendName.trim(), amount: amount.trim(), dueDate });
      onSaved(loan);
    } catch (err) {
      setSaving(false);
      if (err instanceof ApiError && err.status === 401) {
        onSessionExpired();
      } else if (err instanceof ApiError && Object.keys(err.fields).length > 0) {
        // The server's message for each field goes under that field.
        setErrors({
          friendName: err.fields.friendName?.[0],
          amount: err.fields.amount?.[0],
          dueDate: err.fields.dueDate?.[0],
        });
      } else {
        setFormError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
      }
      // Whatever went wrong, the form keeps what was typed.
    }
  }

  const isPast = dueDate < today;

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <LinkButton title="Cancel" onPress={onCancel} disabled={saving} />
        <Text style={styles.title}>Add loan</Text>
        <View style={styles.headerSpacer} />
      </View>

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <TextField
            label="Friend's name"
            value={friendName}
            onChangeText={setFriendName}
            placeholder="e.g. Ramesh"
            autoCapitalize="words"
            maxLength={60}
            error={errors.friendName}
            autoFocus
          />

          <TextField
            label="Amount"
            prefix="₹"
            value={amount}
            onChangeText={setAmount}
            placeholder="1500"
            keyboardType="decimal-pad"
            maxLength={12}
            error={errors.amount}
          />

          <Text style={styles.label}>Due date</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => setShowPicker(true)}
            style={[styles.dateBox, errors.dueDate ? styles.dateBoxError : null]}
          >
            <Text style={styles.dateText}>{formatDate(dueDate)}</Text>
            <Text style={styles.change}>Change</Text>
          </Pressable>

          <View style={styles.chips}>
            {QUICK_DUE_DATES.map((choice) => {
              const value = addDays(today, choice.days);
              const selected = value === dueDate;
              return (
                <Pressable
                  key={choice.label}
                  accessibilityRole="button"
                  onPress={() => setDueDate(value)}
                  style={[styles.chip, selected && styles.chipSelected]}
                >
                  <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{choice.label}</Text>
                </Pressable>
              );
            })}
          </View>

          {errors.dueDate ? (
            <Text style={styles.error}>{errors.dueDate}</Text>
          ) : (
            <Text style={[styles.hint, isPast && styles.hintPast]}>
              {isPast
                ? "This date has passed, so the loan will show as overdue."
                : dueLabel({ dueDate, repaidAt: null }, today)}
            </Text>
          )}

          {formError ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{formError}</Text>
            </View>
          ) : null}

          <View style={styles.save}>
            <PrimaryButton title="Save loan" onPress={save} loading={saving} />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Past dates are allowed on purpose: you can record a loan you gave earlier. */}
      {showPicker ? (
        <DateTimePicker
          value={fromIsoDate(dueDate)}
          mode="date"
          onValueChange={(_event, picked) => onPickDate(picked)}
          onDismiss={() => setShowPicker(false)}
        />
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  title: { fontSize: 20, fontWeight: "700", color: colors.text },
  headerSpacer: { width: 50 }, // balances "Cancel" so the title stays centred
  content: { padding: spacing.lg },
  label: { fontSize: 14, fontWeight: "600", color: colors.text, marginBottom: spacing.xs },
  dateBox: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    backgroundColor: colors.card,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
  },
  dateBoxError: { borderColor: colors.danger },
  dateText: { fontSize: 17, color: colors.text },
  change: { fontSize: 15, fontWeight: "600", color: colors.primary },
  chips: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 20,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    backgroundColor: colors.card,
  },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 14, color: colors.text },
  chipTextSelected: { color: colors.primaryText, fontWeight: "600" },
  hint: { fontSize: 13, color: colors.muted, marginTop: spacing.sm },
  hintPast: { color: colors.danger },
  error: { fontSize: 13, color: colors.danger, marginTop: spacing.sm },
  errorBox: { backgroundColor: colors.dangerBackground, borderRadius: 8, padding: spacing.sm, marginTop: spacing.md },
  errorText: { color: colors.danger, fontSize: 14 },
  save: { marginTop: spacing.xl },
});
