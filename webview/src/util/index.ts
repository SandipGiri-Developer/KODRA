// Common platform detection, keyboard modifier resolution, font size calculation, and runtime environment utilities.
type ProfileDescription = any;
import { KeyboardEvent as ReactKeyboardEvent } from "react";
import { getLocalStorage } from "./localStorage";

export type Platform = "mac" | "linux" | "windows" | "unknown";

// Determines the current operating system platform from the browser navigator.
export function getPlatform(): Platform {
  const platform = window.navigator.platform.toUpperCase();
  if (platform.indexOf("MAC") >= 0) {
    return "mac";
  } else if (platform.indexOf("LINUX") >= 0) {
    return "linux";
  } else if (platform.indexOf("WIN") >= 0) {
    return "windows";
  } else {
    return "unknown";
  }
}

// Checks whether the platform-appropriate primary modifier key (Command on Mac, Ctrl on Windows/Linux) was pressed.
export function isMetaEquivalentKeyPressed({
  metaKey,
  ctrlKey,
}: KeyboardEvent | ReactKeyboardEvent): boolean {
  const platform = getPlatform();
  switch (platform) {
    case "mac":
      return metaKey;
    case "linux":
    case "windows":
      return ctrlKey;
    default:
      return metaKey;
  }
}

// Returns the platform-specific visual label for the primary modifier key.
export function getMetaKeyLabel(): string {
  return getPlatform() === "mac" ? "⌘" : "Ctrl";
}

// Returns the platform-specific visual label for the alternate modifier key.
export function getAltKeyLabel(): string {
  const platform = getPlatform();
  switch (platform) {
    case "mac":
      return "⌥";
    default:
      return "Alt";
  }
}

// Retrieves the configured or default base font size in pixels.
export function getFontSize(): number {
  return getLocalStorage("fontSize") ?? (isJetBrains() ? 15 : 14);
}

// Computes a CSS pixel size string offset from the base font size.
export function fontSize(n: number): string {
  return `${getFontSize() + n}px`;
}

// Checks whether the webview is hosted within a JetBrains IDE.
export function isJetBrains() {
  return getLocalStorage("ide") === "jetbrains";
}

// Checks whether session sharing is supported in the current IDE environment.
export const isShareSessionSupported = () => !isJetBrains();

// Determines whether the application is running in a browser rather than an Electron wrapper.
export function isWebEnvironment(): boolean {
  return (
    typeof window !== "undefined" &&
    window.navigator &&
    window.navigator.userAgent.indexOf("Electron") === -1
  );
}

// Detects if the current extension release is a preview/prerelease build based on minor version parity.
export function isPrerelease() {
  const extensionVersion = getLocalStorage("extensionVersion");
  if (!extensionVersion) {
    console.warn(
      `Could not find extension version in local storage, assuming it's a prerelease`,
    );
    return true;
  }
  const minor = parseInt(extensionVersion.split(".")[1], 10);
  if (minor % 2 !== 0) {
    return true;
  }
  return false;
}

// Verifies whether a given profile configuration is stored locally.
export function isLocalProfile(_profile: ProfileDescription): boolean {
  return true;
}

export {
  ctxItemToRifWithContents,
  findUriInDirs,
  getContextItemsFromHistory,
  getFileExtensionFromBasename,
  getUriDescription,
  getUriPathBasename,
} from "./contextItems";

export {
  modelSupportsImages,
  modelSupportsReasoning,
} from "./modelCapabilities";
