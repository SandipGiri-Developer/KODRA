import { ContextItemWithId, RangeInFileWithContents } from "core";

/**
 * Extracts the file basename from a URI or filesystem path.
 */
export function getUriPathBasename(uri: string): string {
  if (!uri) return "";
  const parts = uri.split(/[/\\]/);
  return parts.pop() || uri;
}

/**
 * Finds relative path of a URI within given directories, or falls back to its basename.
 */
export function findUriInDirs(
  uri: string,
  dirs: string[] = [],
): { relativePathOrBasename: string; foundInDir?: string; uri: string } {
  if (!uri) return { relativePathOrBasename: "", uri: "" };
  const normalizedUri = uri.replace(/\\/g, "/");
  for (const dir of dirs) {
    const normalizedDir = dir.replace(/\\/g, "/").replace(/\/$/, "");
    if (normalizedUri.startsWith(normalizedDir + "/")) {
      return {
        relativePathOrBasename: normalizedUri.slice(normalizedDir.length + 1),
        foundInDir: dir,
        uri,
      };
    }
  }
  return {
    relativePathOrBasename: getUriPathBasename(uri),
    uri,
  };
}

/**
 * Extracts the file extension from a file basename.
 */
export function getFileExtensionFromBasename(basename: string): string {
  if (!basename) return "";
  const parts = basename.split(".");
  return parts.length > 1 ? parts.pop() || "" : "";
}

/**
 * Provides a structured URI description including basename, extension, and relative path.
 */
export function getUriDescription(uri: string, dirUriCandidates: string[] = []) {
  const { relativePathOrBasename, foundInDir } = findUriInDirs(
    uri,
    dirUriCandidates,
  );
  const baseName = getUriPathBasename(uri);
  const extension = getFileExtensionFromBasename(baseName);
  return {
    uri,
    relativePathOrBasename,
    foundInDir,
    baseName,
    extension,
  };
}

/**
 * Converts a ContextItemWithId to a RangeInFileWithContents object by parsing line range expressions.
 */
export function ctxItemToRifWithContents(
  item: ContextItemWithId,
  linesOffByOne: boolean = false,
): RangeInFileWithContents {
  let startLine = 0;
  let endLine = 0;
  let adjustLines = linesOffByOne ? 1 : 0;

  const nameSplit = item.name ? item.name.split("(") : [];

  if (nameSplit.length > 1) {
    const rangePart = nameSplit[1].split(")")[0];
    const lines = rangePart.split("-");
    if (lines.length >= 2) {
      startLine = Number.parseInt(lines[0], 10) || 0;
      if (startLine === 0) {
        adjustLines = 0;
      }
      startLine = Math.max(0, startLine - adjustLines);
      endLine = Math.max(startLine, (Number.parseInt(lines[1], 10) || 0) - adjustLines);
    }
  }

  return {
    filepath: item.uri?.value || item.description?.split(" ")[0] || "",
    range: {
      start: {
        line: startLine,
        character: 0,
      },
      end: {
        line: endLine,
        character: 0,
      },
    },
    contents: item.content || "",
  };
}

/**
 * Extracts all relevant file-based context items from chat history up to a specific index.
 */
export function getContextItemsFromHistory(
  historyItems: any[],
  priorToIndex?: number,
): ContextItemWithId[] {
  const pastHistoryItems = (historyItems || []).filter(
    (_, i) => i <= (priorToIndex ?? historyItems.length - 1),
  );

  const pastNormalContextItems: ContextItemWithId[] = pastHistoryItems.flatMap((item) => {
    return (
      item.contextItems?.filter(
        (c: any) => c.uri?.type === "file" && c.uri?.value,
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
        content?.type === "codeBlock" &&
        content?.attrs?.item?.uri?.value &&
        !content?.attrs?.item?.editing,
    )
    .map((content) => content.attrs.item);

  return [...pastNormalContextItems, ...pastToolbarContextItems];
}
