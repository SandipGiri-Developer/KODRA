// Background message dispatcher coordinating extension-to-webview IPC events with Redux state updates.
import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { IdeMessengerContext } from "../context/IdeMessenger";

import { useAppDispatch, useAppSelector } from "../redux/hooks";
import { setConfigLoading, setConfigResult } from "../redux/slices/configSlice";
import { updateIndexingStatus } from "../redux/slices/indexingSlice";
import {
  initializeProfilePreferences,
  setProfiles,
  setSelectedProfile,
} from "../redux/slices/profilesSlice";
import {
  addContextItemsAtIndex,
  newSession,
  setHasReasoningEnabled,
  setIsSessionMetadataLoading,
  setMode,
} from "../redux/slices/sessionSlice";
import { setTTSActive } from "../redux/slices/uiSlice";

import { cancelStream } from "../redux/thunks/cancelStream";

import { loadSession, refreshSessionMetadata } from "../redux/thunks/session";
import { updateFileSymbolsFromHistory } from "../redux/thunks/updateFileSymbols";
import {
  setDocumentStylesFromLocalStorage,
  setDocumentStylesFromTheme,
} from "../styles/theme";
import { isJetBrains, modelSupportsReasoning } from "../util";
import { setLocalStorage } from "../util/localStorage";
import { useWebviewListener } from "./useWebviewListener";

// Headless listener component binding core IDE extension messages to Redux state actions.
function ParallelListeners() {
  const dispatch = useAppDispatch();
  const ideMessenger = useContext(IdeMessengerContext);
  const history = useAppSelector((store) => store.session.history);
  const isInEdit = useAppSelector((store) => store.session.isInEdit);
  const selectedProfileId = useAppSelector(
    (store) => store.profiles.selectedProfileId,
  );
  const reasoningSettings = useAppSelector(
    (store) => store.ui.reasoningSettings,
  );
  const hasDoneInitialConfigLoad = useRef(false);

  // Load symbols for chat on any session change
  const sessionId = useAppSelector((state) => state.session.id);
  const lastSessionId = useAppSelector((store) => store.session.lastSessionId);
  const [initialSessionId] = useState(sessionId || lastSessionId);

  // Dispatches configuration updates and profile preferences to Redux stores upon receiving new config data.
  const handleConfigUpdate = useCallback(
    async (isInitial: boolean, result: any) => {
      const { result: configResult, profileId, profiles } = result;
      if (isInitial && hasDoneInitialConfigLoad.current) {
        return;
      }
      if (configResult.configLoadInterrupted || !configResult.config) {
        return;
      }
      hasDoneInitialConfigLoad.current = true;
      dispatch(setProfiles(profiles));
      dispatch(setSelectedProfile(profileId));
      dispatch(setConfigResult(configResult));

      const isNewProfileId = profileId && profileId !== selectedProfileId;

      if (isNewProfileId) {
        dispatch(
          initializeProfilePreferences({
            defaultSlashCommands: [],
            profileId,
          }),
        );
      }

      // Perform any actions needed with the config
      if (configResult.config?.ui?.fontSize) {
        setLocalStorage("fontSize", configResult.config.ui.fontSize);
        document.body.style.fontSize = `${configResult.config.ui.fontSize}px`;
      }

      const chatModel = configResult.config?.selectedModelByRole.chat;
      const supportsReasoning = modelSupportsReasoning(chatModel);
      const isReasoningDisabled =
        chatModel?.completionOptions?.reasoning === false;
      const wasReasoningPreviouslyEnabled = chatModel?.title
        ? reasoningSettings[chatModel.title] !== false
        : true;
      dispatch(
        setHasReasoningEnabled(
          supportsReasoning &&
            !isReasoningDisabled &&
            wasReasoningPreviouslyEnabled,
        ),
      );
    },
    [dispatch, hasDoneInitialConfigLoad, selectedProfileId, reasoningSettings],
  );

  // Load config from the IDE.
  // NOTE: In the original Continue extension, this called 'config/getSerializedProfileInfo'
  // via ideMessenger.request(), which would wait for a reply indefinitely via
  // window.addEventListener. Since KODRA does not implement the Continue config protocol,
  // those requests would never resolve, leaking one listener per 2-second interval tick.
  // We skip this and rely on the 'config' message sent by viewProvider on webviewReady.
  useEffect(() => {
    // Mark config as immediately loaded so downstream effects don't re-poll
    hasDoneInitialConfigLoad.current = true;
    dispatch(setConfigLoading(false));
  }, []);

  useWebviewListener(
    "configUpdate",
    async (update: any) => {
      if (!update) {
        return;
      }
      await handleConfigUpdate(false, update);
    },
    [handleConfigUpdate],
  );

  useEffect(() => {
    if (sessionId) {
      void dispatch(updateFileSymbolsFromHistory());
    }
  }, [sessionId]);

  // ON LOAD
  useEffect(() => {
    // Override persisted state
    void dispatch(cancelStream());

    const jetbrains = isJetBrains();
    setDocumentStylesFromLocalStorage(jetbrains);

    if (jetbrains) {
      // Save theme colors to local storage for immediate loading in JetBrains
      void ideMessenger
        .request("jetbrains/getColors", undefined)
        .then((result) => {
          if (result.status === "success") {
            setDocumentStylesFromTheme(result.content);
          }
        });

      // Tell JetBrains the webview is ready
      void ideMessenger
        .request("jetbrains/onLoad", undefined)
        .then((result) => {
          if (result.status === "error") {
            return;
          }

          const msg = result.content;
          (window as any).windowId = msg.windowId;
          (window as any).serverUrl = msg.serverUrl;
          (window as any).workspacePaths = msg.workspacePaths;
          (window as any).vscMachineId = msg.vscMachineId;
          (window as any).vscMediaUrl = msg.vscMediaUrl;
        });
    }
  }, []);

  useWebviewListener(
    "jetbrains/setColors",
    async (data: any) => {
      setDocumentStylesFromTheme(data);
    },
    [],
  );

  // IDE event listeners
  useWebviewListener(
    "getWebviewHistoryLength",
    async () => {
      return history.length;
    },
    [history],
  );

  useWebviewListener(
    "getCurrentSessionId",
    async () => {
      return sessionId;
    },
    [sessionId],
  );

  useWebviewListener("setInactive", async () => {
    void dispatch(cancelStream());
  });

  useWebviewListener("setTTSActive", async (status: any) => {
    dispatch(setTTSActive(status));
  });

  useWebviewListener("addContextItem", async (data: any) => {
    dispatch(
      addContextItemsAtIndex({
        index: data.historyIndex,
        contextItems: [data.item],
      }),
    );
  });

  useWebviewListener("indexing/statusUpdate", async (data: any) => {
    dispatch(updateIndexingStatus(data));
  });

  useWebviewListener(
    "updateApplyState",
    async (state: any) => {
    },
    [],
  );

  useEffect(() => {
    if (!isInEdit) {
    }
  }, [isInEdit, history]);

  useEffect(() => {
  }, []);

  return <></>;
}

export default ParallelListeners;
