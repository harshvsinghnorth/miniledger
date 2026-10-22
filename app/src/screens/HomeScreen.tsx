import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ApiError, api, type User } from "../api";
import { LinkButton } from "../components/Button";
import { colors, spacing } from "../theme";

type Props = {
  token: string;
  onLogout: () => void;
};

// Placeholder for milestone 5: proves the saved token works. Milestone 6 adds the
// summary card and the loan list.
export function HomeScreen({ token, onLogout }: Props) {
  const [user, setUser] = useState<User | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .me(token)
      .then(setUser)
      .catch((err) => {
        // 401 = the token expired or is invalid: back to the login screen.
        if (err instanceof ApiError && err.status === 401) {
          onLogout();
        } else {
          setError(err instanceof ApiError ? err.message : "Something went wrong.");
        }
      });
  }, [token, onLogout]);

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.title}>MiniLedger</Text>
        <LinkButton title="Log out" onPress={onLogout} />
      </View>
      <View style={styles.body}>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {!user && !error ? <ActivityIndicator color={colors.primary} /> : null}
        {user ? <Text style={styles.text}>Logged in as {user.phone}</Text> : null}
      </View>
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
  title: { fontSize: 24, fontWeight: "800", color: colors.primary },
  body: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.lg },
  text: { fontSize: 17, color: colors.text },
  error: { fontSize: 15, color: colors.danger, textAlign: "center" },
});
