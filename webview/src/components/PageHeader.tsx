// Standard navigation header component displaying title and back button.
import { ArrowLeftIcon } from "@heroicons/react/24/outline";

export interface PageHeaderProps {
  onTitleClick?: () => void;
  title?: string;
  showBorder?: boolean;
}

// Renders a sticky top header with back navigation button and page title.
export function PageHeader({
  onTitleClick,
  title,
  showBorder = true,
}: PageHeaderProps) {
  return (
    <header
      className={`border-command-border sticky top-0 z-20 m-0 flex items-center justify-between border border-x-0 ${showBorder ? "border-b" : "border-b-0"} border-t-0 border-solid bg-inherit py-2.5 px-2`}
    >
      <button
        type="button"
        className="flex items-center gap-1.5 px-1.5 py-1 rounded bg-transparent border-none text-[var(--vscode-foreground)] cursor-pointer transition-colors duration-150 hover:bg-[var(--vscode-toolbar-hoverBackground,rgba(128,128,128,0.15))] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--vscode-focusBorder)] active:scale-[0.98]"
        onClick={onTitleClick}
        aria-label={title ? `Go back from ${title}` : "Go back"}
      >
        <ArrowLeftIcon className="h-3.5 w-3.5" />
        {title && <span className="font-semibold text-xs">{title}</span>}
      </button>
    </header>
  );
}
