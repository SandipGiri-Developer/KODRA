// Redux slice managing UI modals, tool permissions, rule toggles, and view preferences.
type OnboardingStatus = any;
export type ToolPolicy = "allowedWithPermission" | "allowedWithoutPermission" | "disabled";
import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { RuleWithSource, Tool } from "core";
const BUILT_IN_GROUP_NAME = "Built-in";
type OnboardingCardState = any;
const defaultOnboardingCardState: any = {};
import { getLocalStorage, LocalStorageKey } from "../../util/localStorage";

export type RulePolicy = "on" | "off";

export type ToolGroupPolicy = "include" | "exclude";

export type ToolPolicies = { [toolName: string]: ToolPolicy };
export type RulePolicies = { [ruleName: string]: RulePolicy };
export type ToolGroupPolicies = { [toolGroupName: string]: ToolGroupPolicy };
export type ReasoningSettings = { [modelTitle: string]: boolean };

type UIState = {
  showDialog: boolean;
  dialogMessage: JSX.Element | undefined;
  onboardingCard: OnboardingCardState;
  isExploreDialogOpen: boolean;
  hasDismissedExploreDialog: boolean;
  shouldAddFileForEditing: boolean;
  toolSettings: ToolPolicies;
  toolGroupSettings: ToolGroupPolicies;
  ruleSettings: RulePolicies;
  reasoningSettings: ReasoningSettings;
  ttsActive: boolean;
};

export const DEFAULT_TOOL_SETTING: ToolPolicy = "allowedWithPermission";
export const DEFAULT_RULE_SETTING: RulePolicy = "on";
export const DEFAULT_UI_SLICE: UIState = {
  showDialog: false,
  dialogMessage: undefined,
  onboardingCard: defaultOnboardingCardState,
  isExploreDialogOpen:
    getLocalStorage(LocalStorageKey.IsExploreDialogOpen) ?? false,
  hasDismissedExploreDialog:
    getLocalStorage(LocalStorageKey.HasDismissedExploreDialog) ?? false,
  shouldAddFileForEditing: false,
  ttsActive: false,
  toolSettings: {},
  toolGroupSettings: {
    [BUILT_IN_GROUP_NAME]: "include",
  },
  ruleSettings: {},
  reasoningSettings: {},
};

// Slice governing general UI flags, dialog presentations, and tool/rule policies.
export const uiSlice = createSlice({
  name: "ui",
  initialState: DEFAULT_UI_SLICE,
  reducers: {
    // Updates onboarding card completion or display properties.
    setOnboardingCard: (
      state,
      action: PayloadAction<Partial<OnboardingCardState>>,
    ) => {
      state.onboardingCard = { ...state.onboardingCard, ...action.payload };
    },
    // Sets the React component or element displayed within the main modal dialog.
    setDialogMessage: (
      state,
      action: PayloadAction<UIState["dialogMessage"]>,
    ) => {
      state.dialogMessage = action.payload;
    },
    // Controls open/closed visibility state for the main modal dialog.
    setShowDialog: (state, action: PayloadAction<UIState["showDialog"]>) => {
      state.showDialog = action.payload;
    },
    // Sets whether the explore features popup dialog is displayed.
    setIsExploreDialogOpen: (
      state,
      action: PayloadAction<UIState[LocalStorageKey.IsExploreDialogOpen]>,
    ) => {
      state.isExploreDialogOpen = action.payload;
    },
    // Registers a tool in state with its default permission policy.
    addTool: (state, action: PayloadAction<Tool>) => {
      state.toolSettings[action.payload.function.name] =
        action.payload.defaultToolPolicy ?? DEFAULT_TOOL_SETTING;
    },
    // Assigns an explicit permission policy to a designated tool.
    setToolPolicy: (
      state,
      action: PayloadAction<{
        toolName: string;
        policy: ToolPolicy;
      }>,
    ) => {
      state.toolSettings[action.payload.toolName] = action.payload.policy;
    },
    // Removes any customized policy entry for a given tool name.
    clearToolPolicy: (state, action: PayloadAction<string>) => {
      delete state.toolSettings[action.payload];
    },
    // Cycles a tool permission setting between allowed-with-permission, allowed-without-permission, and disabled.
    toggleToolSetting: (state, action: PayloadAction<string>) => {
      const setting = state.toolSettings[action.payload];

      switch (setting) {
        case "allowedWithPermission":
          state.toolSettings[action.payload] = "allowedWithoutPermission";
          break;
        case "allowedWithoutPermission":
          state.toolSettings[action.payload] = "disabled";
          break;
        case "disabled":
          state.toolSettings[action.payload] = "allowedWithPermission";
          break;
        default:
          state.toolSettings[action.payload] = DEFAULT_TOOL_SETTING;
          break;
      }
    },
    // Toggles whether a designated tool group is included or excluded.
    toggleToolGroupSetting: (state, action: PayloadAction<string>) => {
      const setting = state.toolGroupSettings[action.payload] ?? "include";

      if (setting === "include") {
        state.toolGroupSettings[action.payload] = "exclude";
      } else {
        state.toolGroupSettings[action.payload] = "include";
      }
    },
    // Registers a rule setting in the UI state with default enabled status.
    addRule: (state, action: PayloadAction<RuleWithSource>) => {
      state.ruleSettings[action.payload.name!] = DEFAULT_RULE_SETTING;
    },
    // Toggles an individual rule policy on or off.
    toggleRuleSetting: (state, action: PayloadAction<string>) => {
      const setting = state.ruleSettings[action.payload];

      switch (setting) {
        case "on":
          state.ruleSettings[action.payload] = "off";
          break;
        case "off":
          state.ruleSettings[action.payload] = "on";
          break;
        default:
          state.ruleSettings[action.payload] = DEFAULT_RULE_SETTING;
          break;
      }
    },
    // Sets whether text-to-speech audio playback is active.
    setTTSActive: (state, { payload }: PayloadAction<boolean>) => {
      state.ttsActive = payload;
    },
    // Configures reasoning token visualization preference for a specified model.
    setReasoningSetting: (
      state,
      action: PayloadAction<{ modelTitle: string; enabled: boolean }>,
    ) => {
      state.reasoningSettings[action.payload.modelTitle] =
        action.payload.enabled;
    },
  },
});

export const {
  setOnboardingCard,
  setDialogMessage,
  setShowDialog,
  setIsExploreDialogOpen,
  toggleToolSetting,
  setToolPolicy,
  clearToolPolicy,
  toggleToolGroupSetting,
  addTool,
  addRule,
  toggleRuleSetting,
  setTTSActive,
  setReasoningSetting,
} = uiSlice.actions;

export default uiSlice.reducer;
