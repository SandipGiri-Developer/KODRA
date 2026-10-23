import { ChatBubbleLeftIcon } from "@heroicons/react/24/outline";
import { SlashCommandDescWithSource } from "core";

interface ConversationStarterCardProps {
  command: SlashCommandDescWithSource;
  onClick: (command: SlashCommandDescWithSource) => void;
}

export function ConversationStarterCard({
  command,
  onClick,
}: ConversationStarterCardProps) {
  return (
    <button
      type="button"
      className="bg-vsc-input-background mb-2 w-full text-left rounded-md border border-[var(--vscode-commandCenter-inactiveBorder,rgba(128,128,128,0.2))] p-2.5 transition-all duration-150 hover:bg-[var(--vscode-list-hoverBackground,rgba(128,128,128,0.1))] hover:border-[var(--vscode-focusBorder,#007fd4)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--vscode-focusBorder,#007fd4)] active:scale-[0.99] cursor-pointer shadow-sm group"
      onClick={() => onClick(command)}
      aria-label={`Prompt: ${command.name}`}
    >
      <div className="flex items-start gap-2.5">
        <div className="flex-shrink-0 pt-0.5 text-[var(--vscode-descriptionForeground,#8c98a9)] group-hover:text-[var(--vscode-foreground)] transition-colors">
          <ChatBubbleLeftIcon className="h-4 w-4" />
        </div>
        <div className="flex flex-1 flex-col justify-center min-w-0">
          <div className="text-xs font-medium text-[var(--vscode-foreground)] truncate">{command.name}</div>
          {command.description && (
            <div className="text-[var(--vscode-descriptionForeground,#8c98a9)] text-[11px] leading-tight line-clamp-2 mt-0.5">{command.description}</div>
          )}
        </div>
      </div>
    </button>
  );
}
