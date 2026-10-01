export function parseHexColor(hexColor?: string): {
  r: number;
  g: number;
  b: number;
} {
  if (!hexColor || typeof hexColor !== "string") {
    return { r: 30, g: 30, b: 30 };
  }

  let cleaned = hexColor.trim();
  if (cleaned.startsWith("#")) {
    cleaned = cleaned.slice(1);
  }

  if (cleaned.length === 3) {
    cleaned = cleaned[0] + cleaned[0] + cleaned[1] + cleaned[1] + cleaned[2] + cleaned[2];
  }

  if (cleaned.length > 6) {
    cleaned = cleaned.slice(0, 6);
  }

  const r = parseInt(cleaned.substring(0, 2), 16);
  const g = parseInt(cleaned.substring(2, 4), 16);
  const b = parseInt(cleaned.substring(4, 6), 16);

  if (isNaN(r) || isNaN(g) || isNaN(b)) {
    return { r: 30, g: 30, b: 30 };
  }

  return { r, g, b };
}

export function parseColorForHex(colorVar: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(
    colorVar,
  );
  if (value.startsWith("#")) {
    return value.slice(0, 7);
  }

  // Parse rgb/rgba
  const rgbValues = value
    .slice(value.startsWith("rgba") ? 5 : 4, -1)
    .split(",")
    .map((x) => x.trim())
    .filter((_, i) => i < 3) // Only take the first 3 values (RGB, ignore alpha)
    .map((x) => parseInt(x, 10));

  let hex =
    "#" +
    rgbValues
      .map((x) => x.toString(16))
      .map((x) => (x.length === 1 ? "0" + x : x))
      .join("");

  return hex;
}
