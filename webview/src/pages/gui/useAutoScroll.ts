import { useEffect, useMemo, useState, useCallback } from "react";
import { ChatHistoryItemWithMessageId } from "../../redux/slices/sessionSlice";

/**
 * Only reset scroll state when a new user message is added to the chat.
 * We don't want to auto-scroll on new tool response messages.
 */
function getNumUserMsgs(history: ChatHistoryItemWithMessageId[]) {
  return history.filter((msg) => msg.message.role === "user").length;
}

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
  const [userHasScrolled, setUserHasScrolled] = useState(false);
  const numUserMsgs = useMemo(() => getNumUserMsgs(history), [history.length]);

  // Reset when a new user message appears (new conversation turn)
  useEffect(() => {
    setUserHasScrolled(false);
  }, [numUserMsgs]);

  const scrollToBottom = useCallback(() => {
    if (ref.current) {
      ref.current.scrollTop = ref.current.scrollHeight;
      setUserHasScrolled(false);
    }
  }, [ref]);

  useEffect(() => {
    if (!ref.current || history.length === 0) return;

    const handleScroll = () => {
      const elem = ref.current;
      if (!elem) return;

      const isAtBottom =
        Math.abs(elem.scrollHeight - elem.scrollTop - elem.clientHeight) < 1;

      /**
       * Stop auto scrolling if the user manually scrolled up.
       * Resume auto scrolling if the user scrolls back to the bottom.
       */
      setUserHasScrolled(!isAtBottom);
    };

    const resizeObserver = new ResizeObserver(() => {
      const elem = ref.current;
      if (!elem || userHasScrolled) return;
      elem.scrollTop = elem.scrollHeight;
    });

    ref.current.addEventListener("scroll", handleScroll);

    // Observe the container and all immediate children for size changes
    resizeObserver.observe(ref.current);
    Array.from(ref.current.children).forEach((child) => {
      resizeObserver.observe(child);
    });

    return () => {
      resizeObserver.disconnect();
      ref.current?.removeEventListener("scroll", handleScroll);
    };
  }, [ref, history.length, userHasScrolled]);

  return { userHasScrolled, scrollToBottom };
};
