// Redux slice for managing serialized configuration state, validation errors, and loading indicators.
export type ConfigResult<T> = { config: T; errors?: any[] };
export type ConfigValidationError = any;
import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { BrowserSerializedKODRAConfig } from "core";
const DEFAULT_CONTEXT_LENGTH = 128000;

export type ConfigState = {
  configError: ConfigValidationError[] | undefined;
  config: BrowserSerializedKODRAConfig;
  loading: boolean;
};

export const EMPTY_CONFIG: BrowserSerializedKODRAConfig = {
  slashCommands: [],
  contextProviders: [],
  tools: [],
  mcpServerStatuses: [],
  modelsByRole: {
    chat: [],
    apply: [],
    edit: [],
    summarize: [],
    autocomplete: [],
    rerank: [],
    embed: [],
    subagent: [],
  },
  selectedModelByRole: {
    chat: null,
    apply: null,
    edit: null,
    summarize: null,
    autocomplete: null,
    rerank: null,
    embed: null,
    subagent: null,
  },
  rules: [],
};

export const INITIAL_CONFIG_SLICE: ConfigState = {
  configError: undefined,
  config: EMPTY_CONFIG,
  loading: false,
};

// Slice managing user configuration state and selected models across roles.
export const configSlice = createSlice({
  name: "config",
  initialState: INITIAL_CONFIG_SLICE,
  reducers: {
    // Sets the loaded configuration result and records any validation errors.
    setConfigResult: (
      state,
      {
        payload: result,
      }: PayloadAction<ConfigResult<BrowserSerializedKODRAConfig>>,
    ) => {
      const { config, errors } = result;
      if (!errors || errors.length === 0) {
        state.configError = undefined;
      } else {
        state.configError = errors;
      }

      // If an error is found in config on save,
      // We must invalidate the GUI config too,
      // Since core won't be able to load config
      // Don't invalidate the loaded config
      if (!config) {
        state.config = EMPTY_CONFIG;
      } else {
        state.config = config;
      }
      state.loading = false;
    },
    // Updates the current configuration object directly in the state.
    updateConfig: (
      state,
      { payload: config }: PayloadAction<BrowserSerializedKODRAConfig>,
    ) => {
      state.config = config;
    },
    // Sets the loading state indicating whether configuration is being fetched.
    setConfigLoading: (state, { payload: loading }: PayloadAction<boolean>) => {
      state.loading = loading;
    },
  },
  selectors: {
    // Selects the context length limit for the currently selected chat model.
    selectSelectedChatModelContextLength: (state): number => {
      return (
        state.config.selectedModelByRole.chat?.contextLength ||
        DEFAULT_CONTEXT_LENGTH
      );
    },
    // Selects the currently selected model descriptor for the chat role.
    selectSelectedChatModel: (state) => {
      return state.config.selectedModelByRole.chat;
    },
    // Selects the custom UI configuration object.
    selectUIConfig: (state) => {
      return state.config?.ui ?? null;
    },
  },
});

export const { updateConfig, setConfigResult, setConfigLoading } =
  configSlice.actions;

export const {
  selectSelectedChatModelContextLength,
  selectUIConfig,
  selectSelectedChatModel,
} = configSlice.selectors;

export default configSlice.reducer;
