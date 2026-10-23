// Memoized Redux selectors for slash commands, context providers, and active file context state.
import { createSelector } from "@reduxjs/toolkit";
import {
  ComboBoxItem,
  ComboBoxItemType,
} from "../../components/mainInput/types";
import { RootState } from "../store";

// Transforms available slash commands into autocomplete combo box items.
export const selectSlashCommandComboBoxInputs = createSelector(
  [(state: RootState) => state.config.config.slashCommands],
  (slashCommands) => {
    return (
      slashCommands?.map((cmd: any) => {
        let content = cmd.prompt;

        // For MCP prompts without content, show that it failed to load
        if (cmd.source === "mcp-prompt" && !content) {
          content = "[MCP Prompt - failed to load content during startup]";
        }

        return {
          title: cmd.name,
          description: cmd.description,
          type: "slashCommand" as ComboBoxItemType,
          content: content,
          source: cmd.source,
        } as ComboBoxItem;
      }) || []
    );
  },
);

// Extracts raw slash command descriptions from configuration state.
export const selectSlashCommands = createSelector(
  [(state: RootState) => state.config.config.slashCommands],
  (slashCommands) => {
    return slashCommands || [];
  },
);

// Filters context providers to only those exposing a submenu dropdown.
export const selectSubmenuContextProviders = createSelector(
  [(state: RootState) => state.config.config.contextProviders],
  (providers) => {
    return providers?.filter((desc: any) => desc.type === "submenu") || [];
  },
);

// Selects default context providers configured in experimental settings.
export const selectDefaultContextProviders = createSelector(
  [(state: RootState) => state.config.config.experimental?.defaultContext],
  (defaultProviders) => {
    return defaultProviders ?? [];
  },
);

// Determines if the active editor file context should be included automatically.
export const selectUseActiveFile = createSelector(
  [(state: RootState) => state.config.config.experimental?.defaultContext],
  (defaultContext) => defaultContext?.includes("activeFile" as any),
);
