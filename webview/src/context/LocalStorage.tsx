// React context and hook for synchronizing and subscribing to local storage preference state.
import React, { createContext, useContext, useEffect, useState } from "react";
import { getLocalStorage } from "../util/localStorage";

interface LocalStorageType {
  fontSize: number;
}

const DEFAULT_LOCAL_STORAGE: LocalStorageType = {
  fontSize: 14,
};

const LocalStorageContext = createContext<LocalStorageType>(
  DEFAULT_LOCAL_STORAGE,
);

// Context provider that monitors and distributes reactive local storage preference updates.
export const LocalStorageProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [values, setValues] = useState<LocalStorageType>(DEFAULT_LOCAL_STORAGE);

  // Synchronizes component state with updated local storage key-value pairs.
  const syncWithLocalStorage = () => {
    const isJetbrains = getLocalStorage("ide") === "jetbrains";
    const fontSize = getLocalStorage("fontSize") ?? (isJetbrains ? 15 : 14);

    setValues((prev) => ({
      ...prev,
      fontSize,
    }));
  };

  // Initialize with values from localStorage
  useEffect(() => {
    syncWithLocalStorage();
  }, []);

  // Listen for current tab changes using CustomEvent
  useEffect(() => {
    const handleLocalStorageChange = (event: CustomEvent) => {
      if (event.detail?.key === "fontSize") {
        syncWithLocalStorage();
      }
    };

    window.addEventListener(
      "localStorageChange",
      handleLocalStorageChange as EventListener,
    );

    return () => {
      window.removeEventListener(
        "localStorageChange",
        handleLocalStorageChange as EventListener,
      );
    };
  }, []);

  return (
    <LocalStorageContext.Provider value={values}>
      {children}
    </LocalStorageContext.Provider>
  );
};

// Hook to consume reactive local storage preference values.
export const useLocalStorage = () => {
  const context = useContext(LocalStorageContext);
  return context;
};
