import { createAsyncThunk } from "@reduxjs/toolkit";
import { setIsInEdit } from "../slices/sessionSlice";
import { ThunkApiType } from "../store";

/**
 * Exits edit mode and clears IDE editor decorations.
 */
export const exitEdit = createAsyncThunk<
  void,
  { openNewSession?: boolean } | undefined,
  ThunkApiType
>("edit/exit", async (_args, { dispatch, extra }) => {
  extra.ideMessenger.post("edit/clearDecorations", undefined);
  dispatch(setIsInEdit(false));
});

/**
 * Enters edit mode.
 */
export const enterEdit = createAsyncThunk<
  void,
  any,
  ThunkApiType
>("edit/enter", async (_args, { dispatch }) => {
  dispatch(setIsInEdit(true));
});

/**
 * Sets code to edit payload.
 */
export const setCodeToEdit = createAsyncThunk<
  void,
  any,
  ThunkApiType
>("edit/setCodeToEdit", async (_args) => {
  // Handled via session or edit state
});
