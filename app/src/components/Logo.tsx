import { StyleSheet, Text, View } from "react-native";
import { colors } from "../theme";

// The app's mark, the same as the app icon: a white rupee sign on a teal tile.
// Drawn with a View and Text, so there's no image to load.
export function Logo({ size = 40 }: { size?: number }) {
  return (
    <View style={[styles.tile, { width: size, height: size, borderRadius: size * 0.24 }]}>
      <Text style={[styles.symbol, { fontSize: size * 0.6, lineHeight: size * 0.8 }]}>₹</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  // includeFontPadding: Android adds extra space above text by default, which pushes it off-centre.
  symbol: { color: colors.primaryText, fontWeight: "800", includeFontPadding: false, textAlign: "center" },
});
