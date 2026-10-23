// Context provider and hook for managing authenticated profiles and configuration refresh actions.
type ProfileDescription = any;
import React, { createContext, useCallback, useContext } from "react";
import { useAppDispatch, useAppSelector } from "../redux/hooks";
import { setConfigLoading } from "../redux/slices/configSlice";
import {
  selectProfiles,
  selectSelectedProfile,
} from "../redux/slices/profilesSlice";
import { IdeMessengerContext } from "./IdeMessenger";

interface AuthContextType {
  selectedProfile: ProfileDescription | null;
  profiles: ProfileDescription[] | null;
  refreshProfiles: (reason?: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Supplies active profile metadata and profile refresh capabilities down the React component tree.
export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const dispatch = useAppDispatch();
  const ideMessenger = useContext(IdeMessengerContext);

  // Profiles
  const profiles = useAppSelector(selectProfiles);
  const selectedProfile = useAppSelector(selectSelectedProfile);

  // Requests updated profile configurations from the IDE extension host.
  const refreshProfiles = useCallback(
    async (reason?: string) => {
      try {
        dispatch(setConfigLoading(true));
        await ideMessenger.request("config/refreshProfiles", {
          reason,
        });
        ideMessenger.post("showToast", ["info", "Config refreshed"]);
      } catch (e) {
        console.error("Failed to refresh profiles", e);
        ideMessenger.post("showToast", ["error", "Failed to refresh config"]);
      } finally {
        dispatch(setConfigLoading(false));
      }
    },
    [ideMessenger],
  );

  return (
    <AuthContext.Provider
      value={{
        selectedProfile,
        profiles: profiles ?? [],
        refreshProfiles,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

// Hook to consume the current profile authentication context.
export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
