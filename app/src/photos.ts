import { ImageManipulator, SaveFormat } from "expo-image-manipulator";

const MAX_SIDE = 1600; // pixels on the longest side: still easy to read a receipt
const JPEG_QUALITY = 0.7;

// Phone cameras take big photos (e.g. 3000 × 4000 pixels, often several MB), which are
// slow over a weak connection and can pass the server's 5 MB limit. Resizing and
// re-compressing on the phone brings a receipt down to a few hundred KB.
// Returns the file:// address of the smaller copy.
export async function shrinkPhoto(photo: { uri: string; width: number; height: number }): Promise<string> {
  const context = ImageManipulator.manipulate(photo.uri);
  if (Math.max(photo.width, photo.height) > MAX_SIDE) {
    context.resize(photo.width >= photo.height ? { width: MAX_SIDE } : { height: MAX_SIDE });
  }
  const image = await context.renderAsync();
  const saved = await image.saveAsync({ compress: JPEG_QUALITY, format: SaveFormat.JPEG });
  return saved.uri;
}
