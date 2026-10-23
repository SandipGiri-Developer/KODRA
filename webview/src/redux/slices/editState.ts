// Redux slice managing state for code blocks staged for inline editing.
import { createSlice } from "@reduxjs/toolkit";

// Slice storing code items being edited within the editor.
export const editStateSlice = createSlice({
  name: "editState",
  initialState: { codeToEdit: [] as any[] },
  reducers: {},
});
export default editStateSlice.reducer;
