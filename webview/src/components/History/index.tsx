// Conversation history view providing full-text search, filtering, and session management.
import { BaseSessionMetadata } from "core";
import MiniSearch from "minisearch";
import React, {
  Fragment,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Shortcut from "../gui/Shortcut";

import { XMarkIcon } from "@heroicons/react/24/solid";
import { useNavigate } from "react-router-dom";
import { IdeMessengerContext } from "../../context/IdeMessenger";
import { useAppDispatch, useAppSelector } from "../../redux/hooks";
import {
  newSession,
  setAllSessionMetadata,
} from "../../redux/slices/sessionSlice";
import { setDialogMessage, setShowDialog } from "../../redux/slices/uiSlice";
import { refreshSessionMetadata } from "../../redux/thunks/session";

import { getFontSize, getPlatform } from "../../util";
import { ROUTES } from "../../util/navigation";
import { ConfirmationDialog } from "../dialogs/ConfirmationDialog";
import { Button } from "../ui";
import { HistoryTableRow } from "./HistoryTableRow";
import { groupSessionsByDate, parseDate } from "./util";

// Renders the session history list, search input, workspace filter, and clear all action.
export function History() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const searchInputRef = React.useRef<HTMLInputElement>(null);
  const ideMessenger = useContext(IdeMessengerContext);

  const [searchTerm, setSearchTerm] = useState("");
  const [selectedWorkspace, setSelectedWorkspace] = useState<string>("all");

  useEffect(() => {
    void dispatch(refreshSessionMetadata({}));
  }, [dispatch]);

  const minisearch = useRef<MiniSearch>(
    new MiniSearch({
      fields: ["title"],
      storeFields: ["title", "sessionId", "id"],
    }),
  ).current;

  const allSessionMetadata = useAppSelector(
    (state) => state.session.allSessionMetadata,
  );
  const isSessionMetadataLoading = useAppSelector(
    (state) => state.session.isSessionMetadataLoading,
  );

  const availableWorkspaces = useMemo(() => {
    const set = new Set<string>();
    allSessionMetadata.forEach((s) => {
      if (s.workspaceDirectory) {
        set.add(s.workspaceDirectory);
      }
    });
    return Array.from(set);
  }, [allSessionMetadata]);

  useEffect(() => {
    try {
      minisearch.removeAll();
      minisearch.addAll(
        allSessionMetadata.map((session) => ({
          title: session.title,
          sessionId: session.sessionId,
          id: session.sessionId,
        })),
      );
    } catch (e) {
      console.log("error adding sessions to minisearch", e);
    }
  }, [allSessionMetadata]);

  const platform = useMemo(() => getPlatform(), []);

  const filteredAndSortedSessions: BaseSessionMetadata[] = useMemo(() => {
    // 1. Exact phrase matching
    const exactResults = minisearch.search(searchTerm, {
      fuzzy: false,
    });

    // 2. Fuzzy matching with higher tolerance
    const fuzzyResults = minisearch.search(searchTerm, {
      fuzzy: 0.3,
    });

    // 3. Prefix matching for partial words
    const prefixResults = minisearch.search(searchTerm, {
      prefix: true,
      fuzzy: 0.2,
    });

    // Combine results, with exact matches having higher priority
    const allResults = [
      ...exactResults.map((r) => ({ ...r, priority: 3 })),
      ...fuzzyResults.map((r) => ({ ...r, priority: 2 })),
      ...prefixResults.map((r) => ({ ...r, priority: 1 })),
    ];

    // Remove duplicates while preserving highest priority
    const uniqueResultsMap = new Map<string, any>();
    allResults.forEach((result) => {
      const existing = uniqueResultsMap.get(result.id);
      if (!existing || existing.priority < result.priority) {
        uniqueResultsMap.set(result.id, result);
      }
    });
    const uniqueResults = Array.from(uniqueResultsMap.values());

    const sessionIds = uniqueResults
      .sort((a, b) => b.priority - a.priority || b.score - a.score)
      .map((result) => result.id);

    return allSessionMetadata
      .filter((session) => {
        const matchesSearch = searchTerm === "" || sessionIds.includes(session.sessionId);
        const matchesWorkspace =
          selectedWorkspace === "all" || session.workspaceDirectory === selectedWorkspace;
        return matchesSearch && matchesWorkspace;
      })
      .sort(
        (a, b) =>
          parseDate(b.dateCreated).getTime() -
          parseDate(a.dateCreated).getTime(),
      );
  }, [allSessionMetadata, searchTerm, selectedWorkspace, minisearch]);

  const sessionGroups = useMemo(() => {
    return groupSessionsByDate(filteredAndSortedSessions);
  }, [filteredAndSortedSessions]);

  const showClearSessionsDialog = () => {
    dispatch(
      setDialogMessage(
        <ConfirmationDialog
          title="Clear all chat sessions"
          text={`Are you sure you want to permanently delete all past chat sessions?\n\nThis will permanently delete all stored conversations, messages, execution history, and generated artifacts.\n\nYour workspace files, models, vector indexes, and secrets will NOT be touched.`}
          confirmText="Permanently Delete All"
          onConfirm={async () => {
            try {
              const res = await ideMessenger.request("history/clear", undefined);
              if (res.status === "error") {
                throw new Error(res.error || "Failed to clear history on disk");
              }
              dispatch(setAllSessionMetadata([]));
              dispatch(newSession());
              navigate(ROUTES.HOME);
            } catch (err: any) {
              void dispatch(refreshSessionMetadata({}));
              dispatch(
                setDialogMessage(
                  <div className="p-4 text-sm text-red-400">
                    Failed to clear history: {err?.message || String(err)}
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
    <div
      style={{ fontSize: getFontSize() }}
      className="flex flex-1 flex-col overflow-auto overflow-x-hidden px-1"
    >
      <div className="relative my-2 mt-4 flex justify-center space-x-2">
        <input
          className="bg-vsc-input-background text-vsc-foreground flex-1 rounded-md border border-none py-1 pl-2 pr-8 text-sm outline-none focus:outline-none"
          ref={searchInputRef}
          placeholder="Search past sessions"
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
        {searchTerm && (
          <XMarkIcon
            className="text-vsc-foreground hover:bg-vsc-background duration-50 absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 transform cursor-pointer rounded-full p-0.5 transition-colors"
            onClick={() => {
              setSearchTerm("");
              if (searchInputRef.current) {
                searchInputRef.current.focus();
              }
            }}
          />
        )}
      </div>

      {availableWorkspaces.length > 1 && (
        <div className="my-1 mb-2 flex items-center space-x-2 px-1 text-xs text-vsc-descriptionForeground">
          <span className="flex-shrink-0">Workspace:</span>
          <select
            className="bg-vsc-input-background text-vsc-foreground flex-1 rounded border border-none py-1 px-1.5 text-xs outline-none focus:outline-none cursor-pointer"
            value={selectedWorkspace}
            onChange={(e) => setSelectedWorkspace(e.target.value)}
          >
            <option value="all">All Workspaces ({allSessionMetadata.length})</option>
            {availableWorkspaces.map((ws) => {
              const name = ws.split(/[/\\]/).filter(Boolean).pop() || ws;
              const count = allSessionMetadata.filter((s) => s.workspaceDirectory === ws).length;
              return (
                <option key={ws} value={ws}>
                  {name} ({count})
                </option>
              );
            })}
          </select>
        </div>
      )}

      <div className="thin-scrollbar flex w-full flex-1 flex-col overflow-y-auto">
        {filteredAndSortedSessions.length === 0 && (
          <div className="m-3 text-center">
            {isSessionMetadataLoading ? (
              "Loading Sessions..."
            ) : (
              <>
                No past sessions found. To start a new session, either click the
                "+" button or use the keyboard shortcut:{" "}
                <Shortcut>meta L</Shortcut>
              </>
            )}
          </div>
        )}

        <table className="flex w-full flex-1 flex-col">
          <tbody className="">
            {sessionGroups.map((group, groupIndex) => (
              <Fragment key={group.label}>
                <tr
                  className={`user-select-none sticky mb-3 ml-2 flex h-6 justify-start text-left text-base font-bold opacity-75 ${
                    groupIndex === 0 ? "mt-2" : "mt-8"
                  }`}
                >
                  <td colSpan={3}>{group.label}</td>
                </tr>
                {group.sessions.map((session, sessionIndex) => (
                  <HistoryTableRow
                    key={session.sessionId}
                    sessionMetadata={session}
                    index={sessionIndex}
                  />
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <div className="border-border flex flex-col items-end justify-center border-0 border-t border-solid px-2 py-3 text-xs">
        <Button variant="secondary" size="sm" onClick={showClearSessionsDialog}>
          Clear chats
        </Button>
        <span
          className="text-description text-2xs"
          data-testid="history-sessions-note"
        >
          Chat history is saved to{" "}
          <span className="italic">
            {platform === "windows"
              ? "%USERPROFILE%/.KODRA"
              : "~/.KODRA/sessions"}
          </span>
        </span>
      </div>
    </div>
  );
}
