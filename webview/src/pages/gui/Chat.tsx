const useOnboardingCard = () => ({show: false}); const cancelStream = () => ({type: "dummy"});
import {
  ArrowLeftIcon,
  ChatBubbleOvalLeftIcon,
  Cog6ToothIcon,
  ClockIcon,
  PlusIcon,
} from "@heroicons/react/24/outline";
import { useNavigate } from "react-router-dom";
import { Editor, JSONContent } from "@tiptap/react";
import { ChatHistoryItem, InputModifiers } from "core";
import { ChatMessage } from "core";
const renderChatMessage = (message: ChatMessage) => typeof message.content === "string" ? message.content : JSON.stringify(message.content);
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ErrorBoundary } from "react-error-boundary";
import styled from "styled-components";
import { Button, lightGray, vscBackground } from "../../components";
const useFindWidget = (s?: any, t?: any, u?: any) => ({ widget: <></>, highlights: <></> });
import TimelineItem from "../../components/gui/TimelineItem";
import { NewSessionButton } from "../../components/mainInput/belowMainInput/NewSessionButton";
import ThinkingBlockPeek from "../../components/mainInput/belowMainInput/ThinkingBlockPeek";
import KODRAInputBox from "../../components/mainInput/KODRAInputBox";

import StepContainer from "../../components/StepContainer";
import { TabBar } from "../../components/TabBar/TabBar";
import { IdeMessengerContext } from "../../context/IdeMessenger";
import { useWebviewListener } from "../../hooks/useWebviewListener";
import { useAppDispatch, useAppSelector } from "../../redux/hooks";
import {
  selectDoneApplyStates,
  selectPendingToolCalls,
} from "../../redux/selectors/selectToolCalls";
import {
  cancelToolCall,
  ChatHistoryItemWithMessageId,
  newSession,
  updateToolCallOutput,
} from "../../redux/slices/sessionSlice";
import { isJetBrains, isMetaEquivalentKeyPressed } from "../../util";
import { ToolCallDiv } from "./ToolCallDiv";
import { submitEditorAndInitAtIndex, streamUpdate, setInactive } from "../../redux/slices/sessionSlice";

function getTextFromJSONContent(content: any): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  if (content.type === "text" && content.text) return content.text;
  if (content.content && Array.isArray(content.content)) {
    return content.content.map(getTextFromJSONContent).join(content.type === "paragraph" ? "\n" : "");
  }
  return "";
}

// Module-level singleton for the active stream dispatch.
// Only one stream can be active at a time. Using a module-level variable
// ensures we never have multiple window.addEventListener calls stacking up.
let _activeStreamDispatch: ((msg: any) => void) | null = null;

// Installed once, permanently, at module load time.
window.addEventListener('message', (event: MessageEvent) => {
  const msg = event.data;
  if (!msg || typeof msg !== 'object') return;

  // Only route stream messages. Anything else is handled by useWebviewListener.
  if (!['streamContent', 'streamDone', 'streamError', 'streamCancelled'].includes(msg.type)) return;

  if (_activeStreamDispatch) {
    _activeStreamDispatch(msg);
  }
});

const streamResponseThunk = (payload: any): any => (dispatch: any, getState: any) => {
  const state = getState();
  const index = payload.index ?? state.session.history.length;
  dispatch(submitEditorAndInitAtIndex({ index, editorState: payload.editorState }));

  const text = payload.text || getTextFromJSONContent(payload.editorState) || "New message";

  // Register this dispatch as the sole active handler
  _activeStreamDispatch = (msg: any) => {
    switch (msg.type) {
      case 'streamContent':
        dispatch(streamUpdate([{ role: "assistant", content: msg.content }]));
        break;
      case 'streamDone':
        dispatch(setInactive());
        _activeStreamDispatch = null;
        break;
      case 'streamError':
        dispatch(streamUpdate([{ role: "assistant", content: `\n\nError: ${msg.error}` }]));
        dispatch(setInactive());
        _activeStreamDispatch = null;
        break;
      case 'streamCancelled':
        dispatch(setInactive());
        _activeStreamDispatch = null;
        break;
    }
  };

  if ((window as any).vscode) {
    (window as any).vscode.postMessage({ type: 'sendMessage', text });
  } else {
    setTimeout(() => {
      _activeStreamDispatch?.({ type: 'streamContent', content: 'Mock response from local dev (not running in VS Code)' });
      setTimeout(() => _activeStreamDispatch?.({ type: 'streamDone' }), 100);
    }, 500);
  }
};


import { useStore } from "react-redux";
const FeedbackDialog = () => <></>;

import { DeprecationBanner } from "../../components/DeprecationBanner";
import { FatalErrorIndicator } from "../../components/config/FatalErrorNotice";
import InlineErrorMessage from "../../components/mainInput/InlineErrorMessage";
import { resolveEditorContent } from "../../components/mainInput/TipTapEditor/utils/resolveEditorContent";
import { setDialogMessage, setShowDialog } from "../../redux/slices/uiSlice";
import { RootState } from "../../redux/store";

import { getLocalStorage, setLocalStorage } from "../../util/localStorage";
import { EmptyChatBody } from "./EmptyChatBody";
import { useAutoScroll } from "./useAutoScroll";

// Helper function to find the index of the latest conversation summary
function findLatestSummaryIndex(history: ChatHistoryItem[]): number {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].conversationSummary) {
      return i;
    }
  }
  return -1; // No summary found
}

const StepsDiv = styled.div`
  position: relative;
  background-color: transparent;

  & > * {
    position: relative;
  }

  .thread-message {
    margin: 0 0 0 1px;
  }
`;

export const MAIN_EDITOR_INPUT_ID = "main-editor-input";

function fallbackRender({ error, resetErrorBoundary }: any) {
  // Call resetErrorBoundary() to reset the error boundary and retry the render.

  return (
    <div
      role="alert"
      className="px-2"
      style={{ backgroundColor: vscBackground }}
    >
      <p>Something went wrong:</p>
      <pre style={{ color: "red" }}>{error.message}</pre>
      <pre style={{ color: lightGray }}>{error.stack}</pre>

      <div className="text-center">
        <Button onClick={resetErrorBoundary}>Restart</Button>
      </div>
    </div>
  );
}

export function Chat() {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const ideMessenger = useContext(IdeMessengerContext);
  const reduxStore = useStore<RootState>();
  const onboardingCard = useOnboardingCard();
  const showSessionTabs = useAppSelector(
    (store) => store.config.config.ui?.showSessionTabs,
  );
  const isStreaming = useAppSelector((state) => state.session.isStreaming);
  const [stepsOpen] = useState<(boolean | undefined)[]>([]);
  const mainTextInputRef = useRef<HTMLInputElement>(null);
  const stepsDivRef = useRef<HTMLDivElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  const history = useAppSelector((state) => state.session.history);
  const showChatScrollbar = useAppSelector(
    (state) => state.config.config.ui?.showChatScrollbar,
  );
  const codeToEdit = useAppSelector((state) => state.editModeState.codeToEdit);
  const isInEdit = useAppSelector((store) => store.session.isInEdit);

  const lastSessionId = useAppSelector((state) => state.session.lastSessionId);
  const hasDismissedExploreDialog = useAppSelector(
    (state) => state.ui.hasDismissedExploreDialog,
  );
  const jetbrains = useMemo(() => {
    return isJetBrains();
  }, []);

  useAutoScroll(stepsDivRef, history);

  useEffect(() => {
    // Cmd + Backspace to delete current step
    const listener = (e: KeyboardEvent) => {
      if (
        e.key === "Backspace" &&
        (jetbrains ? e.altKey : isMetaEquivalentKeyPressed(e)) &&
        !e.shiftKey
      ) {
        void dispatch(cancelStream());
      }
    };
    window.addEventListener("keydown", listener);

    return () => {
      window.removeEventListener("keydown", listener);
    };
  }, [isStreaming, jetbrains, isInEdit]);

  const { widget, highlights } = useFindWidget(
    stepsDivRef,
    tabsRef,
    isStreaming,
  );

  const sendInput = useCallback(
    (
      editorState: JSONContent,
      modifiers: InputModifiers,
      index?: number,
      editorToClearOnSend?: Editor,
    ) => {
      const stateSnapshot = reduxStore.getState();
      const latestPendingToolCalls = selectPendingToolCalls(stateSnapshot);
      const latestPendingApplyStates = selectDoneApplyStates(stateSnapshot);
      const isCurrentlyInEdit = false; // stateSnapshot.session.isInEdit;
      const codeToEditSnapshot: any[] = []; // stateSnapshot.editModeState.codeToEdit;
      const selectedModelByRole =
        stateSnapshot.config.config.selectedModelByRole;
      const currentMode = stateSnapshot.session.mode;

      // Cancel all pending tool calls
      latestPendingToolCalls.forEach((toolCallState) => {
        dispatch(
          cancelToolCall({
            toolCallId: toolCallState.toolCallId,
          }),
        );
      });

      // Reject all pending apply states
      latestPendingApplyStates.forEach((applyState: any) => {
        if (applyState.status !== "closed") {
          ideMessenger.post("rejectDiff", applyState);
        }
      });
      const model = isCurrentlyInEdit
        ? (selectedModelByRole.edit ?? selectedModelByRole.chat)
        : selectedModelByRole.chat;

      // if (!model) {
      //   return;
      // }


      if (isCurrentlyInEdit && codeToEditSnapshot.length === 0) {
        return;
      }

        void dispatch(streamResponseThunk({ editorState, modifiers, index }));

        if (editorToClearOnSend) {
          editorToClearOnSend.commands.clearContent();
        }

      // Increment localstorage counter for popup
      const currentCount = getLocalStorage("mainTextEntryCounter");
      if (currentCount) {
        setLocalStorage("mainTextEntryCounter", currentCount + 1);
        if (currentCount === 300) {
          dispatch(setDialogMessage(<FeedbackDialog />));
          dispatch(setShowDialog(true));
        }
      } else {
        setLocalStorage("mainTextEntryCounter", 1);
      }
    },
    [dispatch, ideMessenger, reduxStore],
  );

  useWebviewListener(
    "newSession",
    async () => {
      // unwrapResult(response) // errors if session creation failed
      mainTextInputRef.current?.focus?.();
    },
    [mainTextInputRef],
  );

  // Handle partial tool call output for streaming updates
  useWebviewListener(
    "toolCallPartialOutput",
    async (data: any) => {
      // Update tool call output in Redux store
      dispatch(
        updateToolCallOutput({
          toolCallId: data.toolCallId,
          contextItems: data.contextItems,
        }),
      );
    },
    [dispatch],
  );

  const isLastUserInput = useCallback(
    (index: number): boolean => {
      return !history
        .slice(index + 1)
        .some((entry: any) => entry.message.role === "user");
    },
    [history],
  );

  const renderChatHistoryItem = useCallback(
    (item: ChatHistoryItemWithMessageId, index: number) => {
      const {
        message,
        editorState,
        contextItems,
        appliedRules,
        toolCallStates,
      } = item;

      // Calculate once for the entire function
      const latestSummaryIndex = findLatestSummaryIndex(history);
      const isBeforeLatestSummary =
        latestSummaryIndex !== -1 && index < latestSummaryIndex;

      if (message.role === "user") {
        return (
          <KODRAInputBox
            onEnter={(editorState, modifiers) =>
              sendInput(editorState, modifiers, index)
            }
            isLastUserInput={isLastUserInput(index)}
            isMainInput={false}
            editorState={editorState ?? item.message.content}
            contextItems={contextItems}
            appliedRules={appliedRules}
            inputId={message.id}
          />
        );
      }

      if (message.role === "tool") {
        return null;
      }

      if (message.role === "assistant") {
        return (
          <>
            {/* Always render assistant content through normal path */}
            <div className="thread-message">
              <TimelineItem
                item={item}
                iconElement={
                  <ChatBubbleOvalLeftIcon width="16px" height="16px" />
                }
                open={
                  typeof stepsOpen[index] === "undefined"
                    ? true
                    : stepsOpen[index]!
                }
                onToggle={() => {}}
              >
                <StepContainer
                  index={index}
                  isLast={index === history.length - 1}
                  item={item}
                  latestSummaryIndex={latestSummaryIndex}
                />
              </TimelineItem>
            </div>

            {toolCallStates && (
              <ToolCallDiv
                toolCallStates={toolCallStates}
                historyIndex={index}
              />
            )}
          </>
        );
      }

      if (message.role === "thinking") {
        const thinkingContent = renderChatMessage(message);
        if (!thinkingContent?.trim()) {
          return null;
        }
        return (
          <div className={isBeforeLatestSummary ? "opacity-50" : ""}>
            <ThinkingBlockPeek
              content={thinkingContent}
              redactedThinking={message.redactedThinking}
              index={index}
              prevItem={index > 0 ? history[index - 1] : null}
              inProgress={index === history.length - 1 && isStreaming}
              signature={message.signature}
            />
          </div>
        );
      }

      // Default case - regular assistant message
      return (
        <div className="thread-message">
          <TimelineItem
            item={item}
            iconElement={<ChatBubbleOvalLeftIcon width="16px" height="16px" />}
            open={
              typeof stepsOpen[index] === "undefined" ? true : stepsOpen[index]!
            }
            onToggle={() => {}}
          >
            <StepContainer
              index={index}
              isLast={index === history.length - 1}
              item={item}
              latestSummaryIndex={latestSummaryIndex}
            />
          </TimelineItem>
        </div>
      );
    },
    [sendInput, isLastUserInput, history, stepsOpen, isStreaming],
  );

  const showScrollbar = showChatScrollbar ?? window.innerHeight > 5000;

  return (
    <>
      {!!showSessionTabs && !isInEdit && <TabBar ref={tabsRef} />}
      {widget}


      <StepsDiv
        ref={stepsDivRef}
        className={`pt-[8px] flex flex-col ${showScrollbar ? "thin-scrollbar" : "no-scrollbar"} min-h-0 flex-1 overflow-y-scroll`}
      >
        <DeprecationBanner dismissable={true} />
        {highlights}
        
        {history.length === 0 && (
          <div className="flex-1 flex flex-col justify-end pb-4">
             <EmptyChatBody showOnboardingCard={onboardingCard.show} />
          </div>
        )}

        {history
          .filter((item: any) => item.message.role !== "system")
          .map((item: any, index: number) => (
            <div
              key={item.message.id}
              className="shrink-0"
              style={{
                minHeight: index === history.length - 1 ? "200px" : 0,
              }}
            >
              <ErrorBoundary
                FallbackComponent={fallbackRender}
                onReset={() => {
                  dispatch(newSession());
                }}
              >
                {renderChatHistoryItem(item, index)}
              </ErrorBoundary>
              {index === history.length - 1 && <InlineErrorMessage />}
            </div>
          ))}
      </StepsDiv>
      <div className={"relative shrink-0"}>
        <KODRAInputBox
          isMainInput
          isLastUserInput={false}
          onEnter={(editorState, modifiers, editor) =>
            sendInput(editorState, modifiers, undefined, editor)
          }
          inputId={MAIN_EDITOR_INPUT_ID}
        />

        <div
          style={{
            pointerEvents: isStreaming ? "none" : "auto",
          }}
        >
          <div className="flex flex-row items-center justify-between pb-1 pl-0.5 pr-2">
            <div className="xs:inline hidden">
              {/* Last session button removed */}
            </div>
          </div>
          <FatalErrorIndicator />
          {/* Explore dialog removed for R1 */}

        </div>
      </div>
    </>
  );
}
