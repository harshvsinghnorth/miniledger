import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { HomeScreen } from "./src/screens/HomeScreen";
import { LoginScreen } from "./src/screens/LoginScreen";
import { clearToken, loadToken, saveToken } from "./src/session";
import { colors } from "./src/theme";

// The root of the app. With only two screens, a plain "logged in?" check picks the
// screen; a navigation library (expo-router, React Navigation) would earn its place
// once there are more screens and a back stack.
export default function App() {
  const [token, setToken] = useState<string | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);

  // On launch, reuse a token saved by an earlier login.
  useEffect(() => {
    loadToken().then((saved) => {
      setToken(saved);
      setCheckingSession(false);
    });
  }, []);

  const handleLoggedIn = useCallback(async (newToken: string) => {
    await saveToken(newToken);
    setToken(newToken);
  }, []);

  // useCallback keeps this the same function between renders, so screens can
  // safely list it in their useEffect dependencies.
  const handleLogout = useCallback(async () => {
    await clearToken();
    setToken(null);
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      {checkingSession ? (
        <View style={styles.splash}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : token ? (
        <HomeScreen token={token} onLogout={handleLogout} />
      ) : (
        <LoginScreen onLoggedIn={handleLoggedIn} />
      )}
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  splash: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background },
});
