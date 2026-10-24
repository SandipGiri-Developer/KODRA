// Custom hook providing font size calculation based on user settings and modifier.
import { useMemo } from "react";
import { useLocalStorage } from "../../context/LocalStorage";

export type FontSizeModifier = number | ((fontSize: number) => number);

// Calculates and returns adjusted font size based on local storage preference and modifier.
export const useFontSize = (modifier?: FontSizeModifier) => {
  const { fontSize } = useLocalStorage();
  return useMemo(() => {
    return !modifier
      ? fontSize
      : typeof modifier === "number"
        ? fontSize + modifier
        : modifier(fontSize);
  }, [fontSize]);
};
