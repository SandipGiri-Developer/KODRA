// Primary chat view rendering message history, streamed responses, tool calls, and user input editor.
const useOnboardingCard = () => ({show: false});
import { cancelStream } from "../../redux/thunks/cancelStream";
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
// Serializes chat message content to a string format.
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
import { submitEditorAndInitAtIndex, streamUpdate, setInactive, addAgentActivity, finalizeAgentActivity, addAgentActivityToLatestAssistant } from "../../redux/slices/sessionSlice";
import { store } from "../../redux/store";
import { AgentActivityPanel } from "../../components/gui/AgentActivityPanel";

export interface PendingApproval {
  toolName: string;
  description: string;
  command?: string;
  filepath?: string;
  diff?: string;
  requestId?: string;
  executionId?: string;
}

// Recursively extracts plain text from a TipTap editor JSON content tree.
function getTextFromJSONContent(content: any): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  if (content.type === "text" && content.text) return content.text;
  if (content.content && Array.isArray(content.content)) {
    return content.content.map(getTextFromJSONContent).join(content.type === "paragraph" ? "\n" : "");
  }
  return "";
}

// Module-level singleton for active stream and tool activity dispatches
let _activeStreamDispatch: ((msg: any) => void) | null = null;
let _toolActivityListeners: Array<(msg: any) => void> = [];

// Registers a subscriber callback for streaming tool activities and approvals.
function subscribeToolActivity(fn: (msg: any) => void) {
  _toolActivityListeners.push(fn);
  return () => {
    _toolActivityListeners = _toolActivityListeners.filter((l) => l !== fn);
  };
}

// Installed once, permanently, at module load time.
window.addEventListener('message', (event: MessageEvent) => {
  const msg = event.data;
  if (!msg || typeof msg !== 'object') return;

  if (['approvalRequest', 'streamDone', 'streamCancelled', 'streamError'].includes(msg.type)) {
    _toolActivityListeners.forEach((listener) => listener(msg));
  }

  // Route agent activity even if active stream dispatch has already completed
  if (msg.type === 'agentActivity') {
    if (_activeStreamDispatch) {
      _activeStreamDispatch(msg);
    } else {
      store.dispatch(addAgentActivityToLatestAssistant(msg));
    }
    return;
  }

  // Only route stream messages.
  if (!['streamContent', 'streamDone', 'streamError', 'streamCancelled'].includes(msg.type)) return;

  if (_activeStreamDispatch) {
    _activeStreamDispatch(msg);
  }
});

// Redux async thunk initializing message streaming and handling incoming content chunks.
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
        dispatch(finalizeAgentActivity({ index: index + 1, status: 'completed' }));
        dispatch(setInactive());
        _activeStreamDispatch = null;
        break;
      case 'streamError':
        dispatch(streamUpdate([{ role: "assistant", content: `\n\nError: ${msg.error}` }]));
        dispatch(finalizeAgentActivity({ index: index + 1, status: 'failed', error: msg.error }));
        dispatch(setInactive());
        _activeStreamDispatch = null;
        break;
      case 'streamCancelled':
        dispatch(finalizeAgentActivity({ index: index + 1, status: 'cancelled' }));
        dispatch(setInactive());
        _activeStreamDispatch = null;
        break;
      case 'agentActivity':
        // The assistant message is at index + 1 relative to the user message index
        dispatch(addAgentActivity({ index: index + 1, activity: msg }));
        break;
    }
  };

  if ((window as any).vscode) {
    (window as any).vscode.postMessage({
      type: 'sendMessage',
      text,
      sessionId: state.session.id,
    });
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

// Fallback error UI displayed if an error occurs within the chat step container.
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

// Main chat component orchestrating tabs, message history, agent activity, and user prompt submission.
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

  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);
  const [approvalChoice, setApprovalChoice] = useState<'allow_once' | 'always_allow_workspace' | 'always_allow_global' | 'deny'>('allow_once');

  useEffect(() => {
    return subscribeToolActivity((msg) => {
      switch (msg.type) {
        case 'approvalRequest':
          setApprovalChoice('allow_once');
          setPendingApproval({
            toolName: msg.toolName,
            description: msg.description,
            command: msg.command,
            filepath: msg.filepath,
            diff: msg.diff,
            requestId: msg.requestId,
            executionId: msg.executionId,
          });
          break;

        case 'streamDone':
        case 'streamCancelled':
        case 'streamError':
          setPendingApproval(null);
          break;
      }
    });
  }, []);

  const handleApprovalDecision = useCallback((decision: 'allow_once' | 'always_allow_workspace' | 'always_allow_global' | 'deny' | boolean) => {
    if ((window as any).vscode) {
      if (typeof decision === 'boolean') {
        (window as any).vscode.postMessage({
          type: 'approveAction',
          approved: decision,
          requestId: pendingApproval?.requestId,
        });
      } else {
        (window as any).vscode.postMessage({
          type: 'approveAction',
          decision,
          approved: decision !== 'deny',
          requestId: pendingApproval?.requestId,
        });
      }
    }
    setPendingApproval(null);
  }, [pendingApproval]);

  const handleRevealTerminal = useCallback((executionId?: string) => {
    if ((window as any).vscode && executionId) {
      (window as any).vscode.postMessage({
        type: 'revealTerminal',
        executionId,
      });
    }
  }, []);

  const { userHasScrolled, scrollToBottom } = useAutoScroll(stepsDivRef, history);

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
            {/* AgentActivityPanel: Displays agent reasoning, actions, and background activity items */}
            <AgentActivityPanel
              activities={item.agentActivities || []}
              isStreaming={isStreaming && index === history.length - 1}
            />
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
                {/* StepContainer: Renders assistant markdown text, diff previews, and tool suggestions */}
                <StepContainer
                  index={index}
                  isLast={index === history.length - 1}
                  item={item}
                  latestSummaryIndex={latestSummaryIndex}
                />
              </TimelineItem>
            </div>

            {/* ToolCallDiv: Visualizes function calls and parameter executions made by the LLM */}
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


      <div className="relative flex-1 min-h-0 flex flex-col">
        <StepsDiv
          ref={stepsDivRef}
        className={`pt-[8px] flex flex-col ${showScrollbar ? "thin-scrollbar" : "no-scrollbar"} min-h-0 flex-1 overflow-y-auto`}
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

      {/* Floating down arrow to jump to latest */}
      {userHasScrolled && (
        <div className="absolute bottom-4 left-0 right-0 flex justify-center z-50 pointer-events-none">
          <button
            type="button"
            onClick={() => scrollToBottom(true)}
            aria-label="Jump to latest"
            className="pointer-events-auto flex items-center justify-center w-8 h-8 rounded-full border border-[var(--vscode-widget-border,rgba(128,128,128,0.2))] bg-[var(--vscode-editor-background,#1e1e1e)] text-[var(--vscode-descriptionForeground,#9d9d9d)] hover:text-[var(--vscode-foreground,#cccccc)] hover:border-[var(--vscode-focusBorder,#007fd4)] active:scale-95 transition-all duration-150 shadow-md focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--vscode-focusBorder)] cursor-pointer"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" aria-hidden="true" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
        </div>
      )}
      </div>

      {pendingApproval && (
        <div
          role="alertdialog"
          aria-label="Action requires approval"
          className="mx-2 my-1.5 px-3 py-2.5 rounded border border-[var(--vscode-inputValidation-warningBorder,#b89500)] bg-[var(--vscode-inputValidation-warningBackground,rgba(255,200,0,0.05))]"
        >
          <div className="flex items-center gap-1.5 mb-1.5">
            <span
              aria-hidden="true"
              className="text-[var(--vscode-editorWarning-foreground,#cca700)] text-[11px]"
            >
              {'\u26a0'}
            </span>
            <span className="text-[11px] font-medium text-[var(--vscode-editorWarning-foreground,#cca700)]">
              {pendingApproval.description}
            </span>
          </div>

          {pendingApproval.command && (
            <pre className="text-[10px] font-mono text-[var(--vscode-terminal-foreground,#cccccc)] bg-[var(--vscode-terminal-background,rgba(0,0,0,0.18))] rounded px-2 py-1.5 mb-2 overflow-x-auto whitespace-pre-wrap break-all leading-relaxed">
              <span className="opacity-40 select-none">{'$ '}</span>
              {pendingApproval.command}
            </pre>
          )}

          {pendingApproval.filepath && (
            <div className="text-[10px] text-[var(--vscode-descriptionForeground,#9d9d9d)] mb-2">
              {'File: '}
              <code className="text-[var(--vscode-foreground,#cccccc)] opacity-80">
                {pendingApproval.filepath}
              </code>
            </div>
          )}

          {pendingApproval.command ? (
            <div className="flex flex-wrap items-center gap-2 mt-2 justify-end">
              <label htmlFor="approval-choice-select" className="text-[11px] text-[var(--vscode-descriptionForeground,#9d9d9d)] select-none">
                Action:
              </label>
              <select
                id="approval-choice-select"
                value={approvalChoice}
                onChange={(e) => setApprovalChoice(e.target.value as any)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleApprovalDecision(approvalChoice);
                  }
                }}
                className="px-2 py-1 text-[11px] rounded bg-[var(--vscode-dropdown-background,#252526)] text-[var(--vscode-dropdown-foreground,#cccccc)] border border-[var(--vscode-dropdown-border,#3c3c3c)] focus:outline focus:outline-1 focus:outline-[var(--vscode-focusBorder,#007fd4)] cursor-pointer"
                aria-label="Select approval action"
              >
                <option value="allow_once">Allow Once</option>
                <option value="always_allow_workspace">Allow in this Workspace</option>
                <option value="always_allow_global">Always Allow Globally</option>
                <option value="deny">Deny</option>
              </select>
              <button
                type="button"
                onClick={() => handleApprovalDecision(approvalChoice)}
                className="px-3 py-1 text-[11px] rounded bg-[var(--vscode-button-background,#0e639c)] hover:bg-[var(--vscode-button-hoverBackground,#1177bb)] text-[var(--vscode-button-foreground,#ffffff)] font-medium transition-colors duration-100 focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--vscode-focusBorder)] cursor-pointer"
                aria-label="Submit approval decision"
              >
                Enter
              </button>
              <button
                type="button"
                onClick={() => handleApprovalDecision('deny')}
                className="px-2.5 py-1 text-[11px] rounded bg-[var(--vscode-button-secondaryBackground,#3a3d41)] hover:bg-[var(--vscode-button-secondaryHoverBackground,#45494e)] text-[var(--vscode-button-secondaryForeground,#cccccc)] transition-colors duration-100 focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--vscode-focusBorder)] cursor-pointer"
                aria-label="Reject action"
              >
                Reject
              </button>
            </div>
          ) : (
            <div className="flex gap-2 mt-2 justify-end">
              <button
                type="button"
                onClick={() => handleApprovalDecision(false)}
                className="px-3 py-1 text-[11px] rounded bg-[var(--vscode-button-secondaryBackground,#3a3d41)] hover:bg-[var(--vscode-button-secondaryHoverBackground,#45494e)] text-[var(--vscode-button-secondaryForeground,#cccccc)] transition-colors duration-100 focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--vscode-focusBorder)]"
                aria-label="Reject action"
              >
                Reject
              </button>
              <button
                type="button"
                onClick={() => handleApprovalDecision(true)}
                className="px-3 py-1 text-[11px] rounded bg-[var(--vscode-button-background,#0e639c)] hover:bg-[var(--vscode-button-hoverBackground,#1177bb)] text-[var(--vscode-button-foreground,#ffffff)] font-medium transition-colors duration-100 focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--vscode-focusBorder)]"
                aria-label="Approve action"
              >
                Approve
              </button>
            </div>
          )}
        </div>
      )}
      <div className={"relative shrink-0"}>
        {/* KODRAInputBox: Rich TipTap input box accepting user text, @-mentions, context items, and slash commands */}
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
