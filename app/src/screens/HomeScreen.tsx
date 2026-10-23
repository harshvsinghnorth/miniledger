import { useNetInfo } from "@react-native-community/netinfo";
import { Image } from "expo-image"; // sends the Authorization header for receipts
import * as ImagePicker from "expo-image-picker";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  ToastAndroid,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { ApiError, api, receiptImageSource, type Loan, type Summary } from "../api";
import { LinkButton, PrimaryButton } from "../components/Button";
import { LoanRow } from "../components/LoanRow";
import { Logo } from "../components/Logo";
import { SummaryCard } from "../components/SummaryCard";
import { dateInIndia, formatPhone, formatRupees, reminderMessage } from "../format";
import { shrinkPhoto } from "../photos";
import { colors, spacing } from "../theme";
import { AddLoanScreen } from "./AddLoanScreen";

type Props = {
  token: string;
  onLogout: () => void;
};

type Data = { loans: Loan[]; summary: Summary; loadedAt: Date };

function errorMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : "Something went wrong.";
}

// "14:05" in the phone's local time
function formatTime(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function HomeScreen({ token, onLogout }: Props) {
  const [data, setData] = useState<Data | null>(null); // the last data that loaded successfully
  const [error, setError] = useState<string | null>(null); // the last load's error, if it failed
  const [refreshing, setRefreshing] = useState(false);
  const [repayingId, setRepayingId] = useState<number | null>(null);
  const [adding, setAdding] = useState(false); // the add-loan form is open
  const [uploadingId, setUploadingId] = useState<number | null>(null);
  const [viewing, setViewing] = useState<Loan | null>(null); // the receipt shown full screen
  const [phone, setPhone] = useState<string | null>(null); // shown in the header
  const { isConnected } = useNetInfo(); // true, false, or null while still checking

  // Whose ledger this is, for the header. Failures are ignored: load() handles a 401.
  useEffect(() => {
    api
      .me(token)
      .then((user) => setPhone(user.phone))
      .catch(() => undefined);
  }, [token]);

  // Fetch the list and the summary at the same time.
  const load = useCallback(async () => {
    try {
      const [{ loans }, summary] = await Promise.all([api.listLoans(token), api.summary(token)]);
      setData({ loans, summary, loadedAt: new Date() });
      setError(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onLogout(); // the token expired or is invalid: back to the login screen
        return;
      }
      setError(errorMessage(err)); // `data` keeps the last good copy, so the screen isn't wiped
    }
  }, [token, onLogout]);

  useEffect(() => {
    load();
  }, [load]);

  // When the phone comes back online, refresh without waiting for the user.
  const wasConnected = useRef(isConnected);
  useEffect(() => {
    if (wasConnected.current === false && isConnected === true) {
      load();
    }
    wasConnected.current = isConnected;
  }, [isConnected, load]);

  async function refresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  // Ask first: there's no "undo" for marking a loan repaid.
  function confirmMarkRepaid(loan: Loan) {
    Alert.alert("Mark as repaid?", `${loan.friendName} paid back ${formatRupees(loan.amount)}.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Mark repaid", onPress: () => markRepaid(loan) },
    ]);
  }

  async function markRepaid(loan: Loan) {
    setRepayingId(loan.id);
    try {
      await api.repay(token, loan.id);
      await load(); // fresh list and totals from the server
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onLogout();
        return;
      }
      // Trying again is safe: the server ignores a second "repay" of the same loan.
      Alert.alert("Couldn't mark as repaid", errorMessage(err));
    } finally {
      setRepayingId(null);
    }
  }

  // Opens WhatsApp with a ready-made message. We don't store friends' numbers, so a
  // wa.me link with only text lets the user pick the chat in WhatsApp itself.
  async function remind(loan: Loan) {
    const message = reminderMessage(loan, dateInIndia(new Date()));
    try {
      await Linking.openURL(`https://wa.me/?text=${encodeURIComponent(message)}`);
    } catch {
      Alert.alert("Couldn't open WhatsApp", "Check that WhatsApp is installed on this phone.");
    }
  }

  function toast(message: string) {
    if (Platform.OS === "android") {
      ToastAndroid.show(message, ToastAndroid.SHORT);
    }
  }

  function onLoanSaved(loan: Loan) {
    setAdding(false);
    load(); // the new loan appears in its place in the list, and the totals update
    toast(`Added ${formatRupees(loan.amount)} lent to ${loan.friendName}`);
  }

  function chooseReceipt(loan: Loan) {
    Alert.alert("Receipt photo", `For the ${formatRupees(loan.amount)} lent to ${loan.friendName}`, [
      { text: "Cancel", style: "cancel" },
      { text: "Gallery", onPress: () => uploadReceipt(loan, "gallery") },
      { text: "Camera", onPress: () => uploadReceipt(loan, "camera") },
    ]);
  }

  async function uploadReceipt(loan: Loan, source: "camera" | "gallery") {
    if (source === "camera") {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        Alert.alert("Camera access needed", "Allow camera access to photograph the receipt, or choose one from the gallery.");
        return;
      }
    }
    // quality 1 = no compression here; shrinkPhoto resizes and compresses it once, below.
    const options: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], quality: 1 };
    const result =
      source === "camera" ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
    if (result.canceled) {
      return;
    }

    setViewing(null);
    setUploadingId(loan.id);
    try {
      const photoUri = await shrinkPhoto(result.assets[0]);
      await api.uploadReceipt(token, loan.id, photoUri);
      await load(); // the row now shows the thumbnail
      toast("Receipt saved");
    } catch (err) {
      if (__DEV__) {
        console.warn("Receipt upload failed:", err);
      }
      if (err instanceof ApiError && err.status === 401) {
        onLogout();
        return;
      }
      Alert.alert("Couldn't upload the receipt", errorMessage(err));
    } finally {
      setUploadingId(null);
    }
  }

  function onSessionExpired() {
    setAdding(false);
    onLogout();
  }

  const header = (
    <View style={styles.header}>
      <View style={styles.brand}>
        <Logo size={36} />
        <View>
          <Text style={styles.title}>MiniLedger</Text>
          {phone ? <Text style={styles.subtitle}>{formatPhone(phone)}</Text> : null}
        </View>
      </View>
      <LinkButton title="Log out" onPress={onLogout} />
    </View>
  );

  // First load still running: nothing to show yet.
  if (!data && !error) {
    return (
      <SafeAreaView style={styles.screen}>
        {header}
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  // First load failed: explain why and offer a retry.
  if (!data) {
    return (
      <SafeAreaView style={styles.screen}>
        {header}
        <View style={styles.center}>
          <Text style={styles.errorTitle}>Couldn't load your loans</Text>
          <Text style={styles.errorText}>{error}</Text>
          <View style={styles.retry}>
            <PrimaryButton title="Try again" onPress={refresh} loading={refreshing} />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // Data loaded. If we're offline or the last refresh failed, keep the old data
  // on screen and say so, rather than hiding everything behind an error.
  let banner: string | null = null;
  if (isConnected === false) {
    banner = `You're offline. Showing data from ${formatTime(data.loadedAt)}.`;
  } else if (error) {
    banner = `Couldn't refresh: ${error} Pull down to try again.`;
  }

  const today = dateInIndia(new Date());

  // Group the server's list (already in order) under three headings. Empty groups are left out.
  // Only counts here: money totals come from the server's summary.
  const sections = [
    { key: "overdue", title: "Overdue", data: data.loans.filter((loan) => loan.isOverdue) },
    { key: "upcoming", title: "Upcoming", data: data.loans.filter((loan) => !loan.isOverdue && loan.repaidAt === null) },
    { key: "repaid", title: "Repaid", data: data.loans.filter((loan) => loan.repaidAt !== null) },
  ].filter((section) => section.data.length > 0);

  return (
    <SafeAreaView style={styles.screen}>
      {header}
      <SectionList
        sections={sections}
        keyExtractor={(loan) => String(loan.id)}
        renderItem={({ item }) => (
          <LoanRow
            loan={item}
            token={token}
            today={today}
            repaying={repayingId === item.id}
            uploading={uploadingId === item.id}
            onMarkRepaid={confirmMarkRepaid}
            onRemind={remind}
            onAddReceipt={chooseReceipt}
            onViewReceipt={setViewing}
          />
        )}
        renderSectionHeader={({ section }) => (
          <Text style={[styles.sectionTitle, section.key === "overdue" && styles.sectionOverdue]}>
            {section.title.toUpperCase()} · {section.data.length}
          </Text>
        )}
        stickySectionHeadersEnabled={false}
        ListHeaderComponent={
          <>
            {banner ? (
              <View style={styles.banner}>
                <Text style={styles.bannerText}>{banner}</Text>
              </View>
            ) : null}
            <SummaryCard summary={data.summary} />
          </>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No loans yet</Text>
            <Text style={styles.emptyText}>Tap "Add loan" to record money you've lent to a friend.</Text>
          </View>
        }
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} colors={[colors.primary]} />}
        contentContainerStyle={styles.list}
      />

      {/* A floating button, always reachable however far the list is scrolled. */}
      <Pressable
        accessibilityRole="button"
        onPress={() => setAdding(true)}
        style={({ pressed }) => [styles.addButton, pressed && styles.pressed]}
      >
        <Text style={styles.addButtonText}>+ Add loan</Text>
      </Pressable>

      {/* The form slides up over the list; Android's back button closes it (onRequestClose).
          A Modal is a separate native window, so it gets its own SafeAreaProvider. */}
      <Modal visible={adding} animationType="slide" onRequestClose={() => setAdding(false)}>
        <SafeAreaProvider>
          <AddLoanScreen
            token={token}
            onCancel={() => setAdding(false)}
            onSaved={onLoanSaved}
            onSessionExpired={onSessionExpired}
          />
        </SafeAreaProvider>
      </Modal>

      {/* Full-screen receipt. Android's back button closes it. */}
      <Modal visible={viewing !== null} transparent animationType="fade" onRequestClose={() => setViewing(null)}>
        <View style={styles.viewer}>
          {viewing?.receiptUrl ? (
            <Image
              source={receiptImageSource(token, viewing.receiptUrl)}
              style={styles.viewerImage}
              contentFit="contain"
            />
          ) : null}
          <View style={styles.viewerActions}>
            <Pressable accessibilityRole="button" onPress={() => viewing && chooseReceipt(viewing)} hitSlop={8}>
              <Text style={styles.viewerButton}>Replace</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => setViewing(null)} hitSlop={8}>
              <Text style={styles.viewerButton}>Close</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  brand: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  title: { fontSize: 22, fontWeight: "800", color: colors.primary },
  subtitle: { fontSize: 13, color: colors.muted },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.lg },
  errorTitle: { fontSize: 18, fontWeight: "700", color: colors.text, marginBottom: spacing.sm },
  errorText: { fontSize: 15, color: colors.muted, textAlign: "center" },
  retry: { alignSelf: "stretch", marginTop: spacing.lg },
  list: { paddingHorizontal: spacing.lg, paddingBottom: 96 }, // room for the floating button
  addButton: {
    position: "absolute",
    right: spacing.lg,
    bottom: spacing.xl,
    backgroundColor: colors.primary,
    borderRadius: 28,
    paddingHorizontal: spacing.lg,
    paddingVertical: 14,
    elevation: 4,
  },
  addButtonText: { color: colors.primaryText, fontSize: 16, fontWeight: "700" },
  pressed: { opacity: 0.85 },
  viewer: { flex: 1, backgroundColor: "rgba(0, 0, 0, 0.92)", justifyContent: "center" },
  viewerImage: { width: "100%", height: "80%" },
  viewerActions: {
    flexDirection: "row",
    justifyContent: "space-around",
    paddingVertical: spacing.lg,
  },
  viewerButton: { color: colors.primaryText, fontSize: 17, fontWeight: "600" },
  banner: { backgroundColor: "#FEF3C7", borderRadius: 10, padding: spacing.sm, marginBottom: spacing.md },
  bannerText: { color: "#92400E", fontSize: 14 },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.8,
    color: colors.muted,
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
  sectionOverdue: { color: colors.danger },
  empty: { alignItems: "center", paddingVertical: spacing.xl },
  emptyTitle: { fontSize: 17, fontWeight: "700", color: colors.text },
  emptyText: { fontSize: 14, color: colors.muted, marginTop: spacing.xs, textAlign: "center" },
});
