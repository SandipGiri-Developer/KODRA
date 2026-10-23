// Typed Redux dispatch and selector hooks bound to the application RootState and AppDispatch.
import { useSelector, useDispatch, TypedUseSelectorHook } from "react-redux";
import type { AppDispatch, RootState } from "./store";

// Typed wrapper around useDispatch providing application-specific dispatch types.
export const useAppDispatch: () => AppDispatch = useDispatch;
// Typed wrapper around useSelector providing RootState type inference.
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;
