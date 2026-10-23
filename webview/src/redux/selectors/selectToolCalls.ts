// Memoized Redux selectors for querying tool call records, statuses, and code apply states from session history.
import { createSelector } from "@reduxjs/toolkit";
import { ToolStatus } from "core";
import { RootState } from "../store";
import {
  findAllCurToolCalls,
  findAllCurToolCallsByStatus,
  findToolCallById,
  hasCurrentToolCalls,
} from "../util";

// Retrieves all tool calls associated with the current conversation exchange.
export const selectCurrentToolCalls = createSelector(
  (store: RootState) => store.session.history,
  (history) => findAllCurToolCalls(history),
);

// Checks whether the current message exchange contains any tool calls.
export const selectHasCurrentToolCalls = createSelector(
  (store: RootState) => store.session.history,
  (history) => hasCurrentToolCalls(history),
);

// Filters current tool calls matching the specified execution status.
export const selectToolCallsByStatus = createSelector(
  [
    (store: RootState) => store.session.history,
    (_store: RootState, status: ToolStatus) => status,
  ],
  (history, status) => findAllCurToolCallsByStatus(history, status),
);

// Returns the first pending tool call requiring execution or user confirmation.
export const selectFirstPendingToolCall = createSelector(
  (store: RootState) => store.session.history,
  (history) => {
    const pendingToolCalls = findAllCurToolCallsByStatus(history, "generated");
    return pendingToolCalls[0] || undefined;
  },
);

// Finds a specific tool call record by its unique toolCallId.
export const selectToolCallById = createSelector(
  [
    (store: RootState) => store.session.history,
    (_store: RootState, toolCallId: string) => toolCallId,
  ],
  (history, toolCallId) => findToolCallById(history, toolCallId),
);

// Finds the code block application state associated with a tool call ID.
export const selectApplyStateByToolCallId = createSelector(
  [
    (store: RootState) => store.session.codeBlockApplyStates,
    (_store: RootState, toolCallId: string) => toolCallId,
  ],
  (applyStates, toolCallId) => {
    return applyStates.states.findLast(
      (state: any) => state.toolCallId === toolCallId,
    );
  },
);

// Retrieves all pending tool calls currently in generated status.
export const selectPendingToolCalls = createSelector(
  (store: RootState) => store.session.history,
  (history) => findAllCurToolCallsByStatus(history, "generated"),
);

// Filters applied code block states that completed successfully.
export const selectDoneApplyStates = createSelector(
  (store: RootState) => store.session.codeBlockApplyStates.states,
  (states) => states.filter((applyState: any) => applyState.status === "done"),
);
