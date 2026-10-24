// Redux thunk extracting referenced file URIs from history and fetching code symbol definitions.
import { createAsyncThunk } from "@reduxjs/toolkit";
import { ChatHistoryItem, ContextItemWithId } from "core";
import { CodeBlock } from "../../components/mainInput/TipTapEditor/extensions";
import { updateFileSymbols } from "../slices/sessionSlice";
import { ThunkApiType } from "../store";

// Extracts all file-based context items embedded in chat history messages and editor state.
export function getContextItemsFromHistory(
  historyItems: ChatHistoryItem[],
  priorToIndex?: number,
) {
  const pastHistoryItems = historyItems.filter(
    (_, i) => i <= (priorToIndex ?? historyItems.length - 1),
  );

  const pastNormalContextItems = pastHistoryItems.flatMap((item) => {
    return (
      item.contextItems?.filter(
        (item) => item.uri?.type === "file" && item.uri?.value,
      ) ?? []
    );
  });
  const pastToolbarContextItems: ContextItemWithId[] = pastHistoryItems
    .filter(
      (item) => item.editorState && Array.isArray(item.editorState.content),
    )
    .flatMap((item) => item.editorState.content)
    .filter(
      (content) =>
        content?.type === CodeBlock.name &&
        content?.attrs?.item?.uri?.value &&
        content.attrs.item.uri?.type === "file",
    )
    .map((content) => content.attrs!.item!);

  return [...pastNormalContextItems, ...pastToolbarContextItems];
}

// Queries code symbols for newly referenced files in chat history and updates the symbol cache.
export const updateFileSymbolsFromHistory = createAsyncThunk<
  void,
  undefined,
  ThunkApiType
>("symbols/updateFromHistory", async (_, { dispatch, extra, getState }) => {
  try {
    const state = getState();

    // Get unique context item file uris from all history
    const contextItems = getContextItemsFromHistory(state.session.history);

    const uniqueUris = new Set(
      contextItems
        .filter((item) => item?.uri?.type === "file" && item?.uri?.value)
        .map((item) => item.uri!.value),
    );

    // Remove if already in symbols
    Object.keys(state.session.symbols).forEach((key) => {
      uniqueUris.delete(key);
    });

    const uriArray = Array.from(uniqueUris);

    // And then update symbols for those files
    if (uriArray.length > 0) {
      const result = await extra.ideMessenger.request(
        "context/getSymbolsForFiles",
        { uris: uriArray },
      );
      if (result.status === "error") {
        throw new Error(result.error);
      }
      dispatch(updateFileSymbols(result.content));
    }
  } catch (e) {
    // Catch all - don't want file symbols to break the chat experience for now
    console.error("Error updating file symbols from context items", e);
  }
});
