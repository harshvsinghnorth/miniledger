import * as SecureStore from "expo-secure-store";

const TOKEN_KEY = "miniledger.token";

// SecureStore keeps the token encrypted with a key from the Android Keystore, unlike
// AsyncStorage, which is plain text that other tools on a rooted phone could read.

export async function loadToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(TOKEN_KEY);
  } catch {
    return null; // unreadable (e.g. after a backup restore): treat as logged out
  }
}

export async function saveToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

export async function clearToken(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}
