// Redux slice tracking codebase and documentation indexing statuses and peek visibility.
import { PayloadAction, createSlice } from "@reduxjs/toolkit";
import { IndexingStatus } from "core";

export type IndexingState = {
  indexing: {
    hiddenChatPeekTypes: Record<IndexingStatus["type"], boolean>;
    statuses: Record<string, IndexingStatus>; // status id -> status
  };
};

export const INITIAL_INDEXING_STATE: IndexingState = {
  indexing: {
    statuses: {},
    hiddenChatPeekTypes: {
      docs: false,
    },
  },
};

// Slice managing progress and visibility for background indexing jobs.
export const indexingSlice = createSlice({
  name: "indexing",
  initialState: INITIAL_INDEXING_STATE,
  reducers: {
    // Updates progress status for a specific indexing operation and resets peek visibility if needed.
    updateIndexingStatus: (
      state,
      { payload }: PayloadAction<IndexingStatus>,
    ) => {
      state.indexing.statuses = {
        ...state.indexing.statuses,
        [payload.id]: payload,
      };

      // This check is so that if all indexing is stopped for e.g. docs
      // The next time docs indexing starts the peek will show again
      const indexingThisType = Object.values(state.indexing.statuses).filter(
        (status) =>
          status.type === payload.type && status.status === "indexing",
      );
      if (indexingThisType.length === 0) {
        state.indexing.hiddenChatPeekTypes = {
          ...state.indexing.hiddenChatPeekTypes,
          [payload.type]: false,
        };
      }
    },
    // Sets whether the chat peek card for a specific indexer type is collapsed or hidden.
    setIndexingChatPeekHidden: (
      state,
      {
        payload,
      }: PayloadAction<{
        type: IndexingStatus["type"];
        hidden: boolean;
      }>,
    ) => {
      state.indexing.hiddenChatPeekTypes = {
        ...state.indexing.hiddenChatPeekTypes,
        [payload.type]: payload.hidden,
      };
    },
  },
});

export const { updateIndexingStatus, setIndexingChatPeekHidden } =
  indexingSlice.actions;

export default indexingSlice.reducer;
