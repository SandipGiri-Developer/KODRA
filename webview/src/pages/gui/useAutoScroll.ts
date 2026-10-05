import { useEffect, useCallback } from "react";
import { ChatHistoryItemWithMessageId } from "../../redux/slices/sessionSlice";

export interface UseAutoScrollResult {
  /** True when the user has scrolled upward away from the bottom. */
  userHasScrolled: boolean;
  /** Programmatically scroll to the bottom. */
  scrollToBottom: () => void;
}

export const useAutoScroll = (
  ref: React.RefObject<HTMLDivElement>,
  history: ChatHistoryItemWithMessageId[],
): UseAutoScrollResult => {
  const scrollToBottom = useCallback(() => {
    if (ref.current) {
      ref.current.scrollTop = ref.current.scrollHeight;
    }
  }, [ref]);

  useEffect(() => {
    if (!ref.current || history.length === 0) return;

    const resizeObserver = new ResizeObserver(() => {
      const elem = ref.current;
      if (!elem) return;
      // Always auto-scroll relentlessly when content expands
      elem.scrollTop = elem.scrollHeight;
    });

    // Observe the container and all immediate children for size changes
    resizeObserver.observe(ref.current);
    Array.from(ref.current.children).forEach((child) => {
      resizeObserver.observe(child);
    });

    return () => {
      resizeObserver.disconnect();
    };
  }, [ref, history.length]);

  return { userHasScrolled: false, scrollToBottom };
};
