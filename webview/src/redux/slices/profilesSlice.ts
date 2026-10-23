// Redux slice managing configuration profiles and user preferences per profile.
import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { SlashCommandDescWithSource } from "core";
export interface ProfileDescription {
  title: string;
  id: string;
  errors: any[];
  uri: string;
  iconUrl: string;
  fullSlug: any;
}

const DEFAULT_SLASH_COMMANDS_BOOKMARKS_COUNT = 5;

const INITIAL_PREFERENCES_STATE: PreferencesState = {
  bookmarkedSlashCommands: [],
};

export interface PreferencesState {
  bookmarkedSlashCommands: string[];
}

export interface ProfilesState {
  profiles: ProfileDescription[];
  selectedProfileId: string | null;
  preferencesByProfileId: Record<string, PreferencesState>;
}

export const INITIAL_PROFILES_STATE: ProfilesState = {
  preferencesByProfileId: {},
  selectedProfileId: null,
  profiles: [
    {
      title: "Main Config",
      id: "local",
      errors: [],
      uri: "",
      iconUrl: "",
      fullSlug: {
        ownerSlug: "",
        packageSlug: "",
        versionSlug: "",
      },
    },
  ],
};

// Slice maintaining profile definitions and per-profile user customizations.
export const profilesSlice = createSlice({
  name: "profiles",
  initialState: INITIAL_PROFILES_STATE,
  reducers: {
    // Sets the active configuration profile ID.
    setSelectedProfile: (state, { payload }: PayloadAction<string | null>) => {
      state.selectedProfileId = payload;
    },
    // Replaces the collection of available configuration profiles.
    setProfiles: (state, { payload }: PayloadAction<ProfileDescription[]>) => {
      state.profiles = payload;
    },
    // Initializes default preference values for a newly loaded or switched profile.
    initializeProfilePreferences: (
      state,
      action: PayloadAction<{
        profileId: string;
        defaultSlashCommands?: SlashCommandDescWithSource[];
      }>,
    ) => {
      const { profileId, defaultSlashCommands = [] } = action.payload;
      const defaultSlashCommandNames = defaultSlashCommands.map(
        (cmd) => cmd.name,
      );

      // First ensure all profile preferences are complete to handle
      // the case where a new preference has been added since last load
      Object.keys(state.preferencesByProfileId).forEach((pid) => {
        state.preferencesByProfileId[pid] = {
          ...INITIAL_PREFERENCES_STATE,
          ...state.preferencesByProfileId[pid],
        };
      });

      // Then initialize preferences for the new profile if needed
      if (!state.preferencesByProfileId[profileId]) {
        state.preferencesByProfileId[profileId] = {
          bookmarkedSlashCommands: defaultSlashCommandNames.slice(
            0,
            DEFAULT_SLASH_COMMANDS_BOOKMARKS_COUNT,
          ),
        };
      }
    },
    // Adds a slash command to the bookmarked commands list for the current profile.
    bookmarkSlashCommand: (
      state,
      action: PayloadAction<{ commandName: string }>,
    ) => {
      const { commandName } = action.payload;
      const preferences =
        state.preferencesByProfileId[state.selectedProfileId ?? ""];

      if (!preferences) return;

      if (!preferences.bookmarkedSlashCommands.includes(commandName)) {
        preferences.bookmarkedSlashCommands.push(commandName);
      }
    },
    // Removes a slash command from the bookmarked commands list for the current profile.
    unbookmarkSlashCommand: (
      state,
      action: PayloadAction<{ commandName: string }>,
    ) => {
      const { commandName } = action.payload;
      const profileId = state.selectedProfileId;

      if (!profileId) return;

      const preferences = state.preferencesByProfileId[profileId];
      if (!preferences) return;

      preferences.bookmarkedSlashCommands =
        preferences.bookmarkedSlashCommands.filter(
          (cmd) => cmd !== commandName,
        );
    },
  },
  selectors: {
    // Selects the full profile object corresponding to the currently selected profile ID.
    selectSelectedProfile: (state) => {
      return (
        (state.profiles ?? []).find(
          (profile) => profile.id === state.selectedProfileId,
        ) ?? null
      );
    },

    // Selects all available configuration profiles.
    selectProfiles: (state) => {
      return state.profiles ?? [];
    },

    // Selects the bookmarked slash commands for the active profile.
    selectBookmarkedSlashCommands: (state) => {
      if (!state.selectedProfileId) return [];
      const preferences = state.preferencesByProfileId[state.selectedProfileId];
      return preferences?.bookmarkedSlashCommands || [];
    },

    // Selects the preferences mapping dictionary keyed by profile ID.
    selectPreferencesByProfileId: (state) => state.preferencesByProfileId,
  },
});

export const {
  setSelectedProfile,
  bookmarkSlashCommand,
  unbookmarkSlashCommand,
  initializeProfilePreferences,
  setProfiles,
} = profilesSlice.actions;

export const {
  selectSelectedProfile,
  selectProfiles,
  selectBookmarkedSlashCommands,
  selectPreferencesByProfileId,
} = profilesSlice.selectors;

export const { reducer: profilesReducer } = profilesSlice;
