// Streaming tool call state management and argument delta aggregation.
import { ToolCallDelta, ToolCallState } from "core";

// Safely attempts to parse partially or fully streamed JSON strings into an object.
function incrementalParseJson(jsonString: string): [string, any] {
  try {
    return [jsonString, JSON.parse(jsonString)];
  } catch (e) {
    return [jsonString, {}];
  }
}

// Accumulates streamed tool call chunk deltas into the active tool execution state.
export function addToolCallDeltaToState(
  toolCallDelta: ToolCallDelta,
  currentState: ToolCallState | undefined,
): ToolCallState {
  const currentCall = currentState?.toolCall;

  // If we have a current state and the delta has a different ID, ignore the delta
  if (
    currentState &&
    toolCallDelta.id &&
    currentCall?.id !== toolCallDelta.id
  ) {
    return currentState;
  }

  // These will/should not be partially streamed
  const callType = toolCallDelta.type ?? "function";
  const callId = currentCall?.id || toolCallDelta.id || "";

  // These may be streamed in chunks
  const currentName = currentCall?.function.name ?? "";
  const currentArgs = currentCall?.function.arguments ?? "";

  const nameDelta = toolCallDelta.function?.name ?? "";
  const argsDelta = toolCallDelta.function?.arguments ?? "";

  let mergedName = currentName;
  if (nameDelta.startsWith(currentName)) {
    // Case where model progresssively streams name but full name each time e.g. "readFi" -> "readFil" -> "readFile"
    mergedName = nameDelta;
  } else if (!currentName.startsWith(nameDelta)) {
    mergedName = currentName + nameDelta;
  }

  // Similar logic for args, with an extra JSON check
  let mergedArgs = currentArgs;
  try {
    // If args is JSON parseable, it is complete, don't add to it
    JSON.parse(currentArgs);
  } catch (e) {
    // Model streams in args in parts e.g. "{"file": "file1"" -> ", "line": 1}"
    mergedArgs = currentArgs + argsDelta;

    // Note, removed case where model progresssively streams args but full args each time e.g. "{"file": "file1"}" -> "{"file": "file1", "line": 1}"
    // Because no apis do this and difficult to detect reliably
  }

  const [_, parsedArgs] = incrementalParseJson(mergedArgs || "{}");

  return {
    status: "generating",
    toolCall: {
      id: callId,
      type: callType,
      function: {
        name: mergedName,
        arguments: mergedArgs,
      },
    },
    toolCallId: callId,
    parsedArgs,
  };
}

const editToolNames: string[] = [
  "edit_existing_file",
  "single_find_and_replace",
  "multi_edit",
];
// Checks whether a given tool name corresponds to a file editing capability.
export function isEditTool(toolName: string) {
  return editToolNames.includes(toolName);
}
