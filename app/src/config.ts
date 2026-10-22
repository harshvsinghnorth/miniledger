import Constants from "expo-constants";

// Where the API lives, decided once when the app starts.
function apiUrl(): string {
  // 1. An explicit address, e.g. a deployed server. Expo builds EXPO_PUBLIC_* variables into the app.
  const fromEnv = process.env.EXPO_PUBLIC_API_URL;
  if (fromEnv) {
    return fromEnv;
  }

  // 2. In development: the laptop that sent this app to Expo Go. hostUri is that laptop's
  //    address as the phone sees it (e.g. "10.7.19.118:8081"), and the API runs on the same
  //    laptop on port 3000. So there's no IP address to look up and type in by hand.
  const laptop = Constants.expoConfig?.hostUri?.split(":")[0];
  if (laptop) {
    return `http://${laptop}:3000`;
  }

  return "http://localhost:3000";
}

export const API_URL = apiUrl();
