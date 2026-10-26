// Redux slice managing state for code blocks staged for inline editing.
import { createSlice } from "@reduxjs/toolkit";

// Slice storing code items being edited within the editor.
export const editStateSlice = createSlice({
  name: "editState",
  initialState: { codeToEdit: [] as any[] },
  reducers: {
    clearCodeToEdit: (state) => {
      state.codeToEdit = [];
    },
    setCodeToEdit: (state, action) => {
      state.codeToEdit = action.payload;
    },
  },
});

export const { clearCodeToEdit, setCodeToEdit } = editStateSlice.actions;
export default editStateSlice.reducer;
