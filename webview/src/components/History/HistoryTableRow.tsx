// History item row component with rename, share, delete, and session restore capabilities.
const exitEdit = (a: any) => ({type: "dummy"}); const getUriPathBasename = (a: any) => a;
import {
  ArrowDownOnSquareIcon,
  PencilSquareIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";
import { BaseSessionMetadata } from "core";

import React, { useContext, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Input } from "..";
import { IdeMessengerContext } from "../../context/IdeMessenger";
import { useAppDispatch, useAppSelector } from "../../redux/hooks";

import {
  deleteSession,
  getSession,
  loadSession,
  updateSession,
} from "../../redux/thunks/session";
import { setDialogMessage, setShowDialog } from "../../redux/slices/uiSlice";
import { ConfirmationDialog } from "../dialogs/ConfirmationDialog";
import { isShareSessionSupported } from "../../util";
import HeaderButtonWithToolTip from "../gui/HeaderButtonWithToolTip";
import { ToolTip } from "../gui/Tooltip";

const shareSessionSupported = isShareSessionSupported();

// Renders an individual conversation history row with inline actions.
export function HistoryTableRow({
  sessionMetadata,
  index,
}: {
  sessionMetadata: BaseSessionMetadata;
  index: number;
}) {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const ideMessenger = useContext(IdeMessengerContext);

  const [hovered, setHovered] = useState(false);
  const [editing, setEditing] = useState(false);
  const [sessionTitleEditValue, setSessionTitleEditValue] = useState(
    sessionMetadata.title,
  );
  const currentSessionId = useAppSelector((state) => state.session.id);

  useEffect(() => {
    setSessionTitleEditValue(sessionMetadata.title);
  }, [sessionMetadata]);

  const shareSession = async (sessionId: string) => {
    // "session/share" is not supported in JetBrains yet
    if (shareSessionSupported) {
      await ideMessenger.request("session/share", {
        sessionId,
      });
    }
  };

  const handleKeyUp = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      if (sessionTitleEditValue !== sessionMetadata.title) {
        // imperfect solution of loading session just to update it
        // but fine for now, pretty low latency
        const currentSession = await getSession(
          ideMessenger,
          sessionMetadata.sessionId,
        );
        await dispatch(
          updateSession({
            ...currentSession,
            title: sessionTitleEditValue,
          }),
        );
      }
      setEditing(false);
    } else if (e.key === "Escape") {
      setSessionTitleEditValue(sessionMetadata.title);
      setEditing(false);
    }
  };

  const promptDeleteSession = (e: React.MouseEvent) => {
    e.stopPropagation();
    dispatch(
      setDialogMessage(
        <ConfirmationDialog
          title="Delete Chat Session"
          text={`Are you sure you want to permanently delete "${sessionMetadata.title}"?\n\nThis will permanently delete this conversation, its message history, execution logs, and generated artifacts.\n\nYour workspace files and code will NOT be modified.`}
          confirmText="Permanently Delete"
          onConfirm={async () => {
            try {
              await dispatch(deleteSession(sessionMetadata.sessionId)).unwrap();
            } catch (err: any) {
              dispatch(
                setDialogMessage(
                  <div className="p-4 text-sm text-red-400">
                    Failed to delete conversation: {err?.message || String(err)}
                  </div>
                )
              );
              dispatch(setShowDialog(true));
            }
          }}
        />,
      ),
    );
    dispatch(setShowDialog(true));
  };

  return (
    <tr
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      data-testid={`history-row-${index}`}
      className="hover:bg-input relative mb-2 box-border flex w-full cursor-pointer overflow-hidden rounded-lg p-3"
      onClick={async () => {
        await dispatch(exitEdit({}));
        if (sessionMetadata.sessionId !== currentSessionId) {
          await dispatch(
            loadSession({
              sessionId: sessionMetadata.sessionId,
              saveCurrentSession: true,
            }),
          );
        }
        navigate("/");
      }}
    >
      <td className="flex-1 cursor-pointer space-y-1">
        {editing ? (
          <div>
            <Input
              type="text"
              className="w-full"
              ref={(titleInput) => titleInput && titleInput.focus()}
              value={sessionTitleEditValue}
              onChange={(e) => setSessionTitleEditValue(e.target.value)}
              onKeyUp={(e) => handleKeyUp(e)}
              onBlur={() => setEditing(false)}
            />
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="line-clamp-1 break-all text-sm font-semibold">
              {sessionMetadata.title}
            </span>

            {((sessionMetadata as any).hasInterruptedRun || (sessionMetadata as any).status === 'interrupted') && (
              <ToolTip content="This agent run was interrupted and can be reviewed or resumed safely.">
                <span className="bg-amber-900/40 text-amber-400 border border-amber-600/50 inline-flex items-center rounded px-1.5 py-0.5 text-2xs font-medium">
                  Interrupted
                </span>
              </ToolTip>
            )}

            {sessionMetadata.messageCount !== undefined && (
              <ToolTip
                content={`${sessionMetadata.messageCount} message${
                  sessionMetadata.messageCount === 1 ? " is" : "s are"
                } present in this session`}
              >
                <span className="bg-vsc-background text-secondary-foreground ml-auto inline-flex items-center rounded-full px-2 py-1 text-xs font-medium">
                  {sessionMetadata.messageCount}
                </span>
              </ToolTip>
            )}
          </div>
        )}

        <div className="text-description-muted flex">
          <span className="line-clamp-1 break-all text-xs">
            {getUriPathBasename(sessionMetadata.workspaceDirectory || "")}
          </span>
        </div>
      </td>

      {hovered && !editing && (
        <td className="bg-input absolute right-2 top-12 ml-auto flex -translate-y-1/2 transform items-center gap-x-1 rounded-full px-2 py-1 shadow-md">
          {
            <>
              <HeaderButtonWithToolTip
                text="Edit"
                onClick={async (e) => {
                  e.stopPropagation();
                  setEditing(true);
                }}
              >
                <PencilSquareIcon width="1em" height="1em" />
              </HeaderButtonWithToolTip>
              {shareSessionSupported && (
                <HeaderButtonWithToolTip
                  text="Save Chat as Markdown"
                  onClick={async (e) => {
                    e.stopPropagation();
                    await shareSession(sessionMetadata.sessionId);
                  }}
                >
                  <ArrowDownOnSquareIcon width="1em" height="1em" />
                </HeaderButtonWithToolTip>
              )}
              <HeaderButtonWithToolTip
                text="Delete"
                onClick={promptDeleteSession}
              >
                <TrashIcon width="1em" height="1em" />
              </HeaderButtonWithToolTip>
            </>
          }
        </td>
      )}
    </tr>
  );
}
