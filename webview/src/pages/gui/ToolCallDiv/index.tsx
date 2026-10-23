// Container component rendering individual or grouped tool call execution cards.
import { ArrowRightIcon } from "@heroicons/react/24/outline";
import { ToolCallState } from "core";
import { useState } from "react";
import { useAppSelector } from "../../../redux/hooks";
import { RootState } from "../../../redux/store";
import { GroupedToolCallHeader } from "./GroupedToolCallHeader";
import { SimpleToolCallUI } from "./SimpleToolCallUI";
import { getIconByName, getStatusIcon } from "./utils";

interface ToolCallDivProps {
  toolCallStates: ToolCallState[];
  historyIndex: number;
}

// Renders tool call statuses, grouping multiple calls when complete or showing individual call cards.
export function ToolCallDiv({
  toolCallStates,
  historyIndex,
}: ToolCallDivProps) {
  const [open, setOpen] = useState(true);
  const availableTools = useAppSelector(
    (state: RootState) => state.config.config.tools,
  );

  if (!toolCallStates?.length) return null;

  const isStreamingComplete = toolCallStates.every(
    (toolCall) => toolCall.status !== "generating",
  );

  const shouldShowGroupedUI = toolCallStates.length > 1 && isStreamingComplete;
  const activeCalls = toolCallStates.filter(
    (call) => call.status !== "canceled",
  );
  const pendingCalls = toolCallStates.filter((call) => call.status !== "done");

  // Renders a single tool call item with matching status and tool icon.
  const renderToolCall = (toolCallState: ToolCallState) => {
    const tool = availableTools.find(
      (tool) => toolCallState.toolCall.function?.name === tool.function.name,
    );
    const functionName = toolCallState.toolCall.function?.name;
    const Icon: any =
      functionName && tool?.toolCallIcon
        ? getIconByName(tool.toolCallIcon)
        : undefined;

    return (
      <SimpleToolCallUI
        tool={tool}
        toolCallState={toolCallState}
        icon={toolCallState.status === "generated" ? ArrowRightIcon : Icon}
        historyIndex={historyIndex}
      />
    );
  };

  if (shouldShowGroupedUI) {
    return (
      <div className="border-border rounded-lg border px-4 py-3 pb-0">
        <GroupedToolCallHeader
          toolCallStates={toolCallStates}
          activeCalls={pendingCalls.length > 0 ? pendingCalls : activeCalls}
          open={open}
          onToggle={() => setOpen(!open)}
        />
        <div
          className={`overflow-y-auto transition-all duration-300 ease-in-out ${
            open ? "max-h-[50vh] opacity-100" : "max-h-0 opacity-0"
          }`}
        >
          {toolCallStates.map((toolCallState) => (
            <div className="py-1 pl-6" key={toolCallState.toolCallId}>
              {renderToolCall(toolCallState)}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return toolCallStates.map((toolCallState) => (
    <div className="py-1" key={toolCallState.toolCallId}>
      {renderToolCall(toolCallState)}
    </div>
  ));
}
