// Collapsible toggle section component with header, title, and chevron indicator.
import { ChevronRightIcon } from "@heroicons/react/24/outline";

interface ToggleProps {
  isOpen: boolean;
  onToggle: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}

// Collapsible disclosure panel with header title and animated chevron.
export function Toggle({
  isOpen,
  onToggle,
  title,
  subtitle,
  children,
}: ToggleProps) {
  return (
    <div className="w-full">
      <button
        type="button"
        className="flex w-full cursor-pointer items-start gap-2 text-left text-sm font-semibold bg-transparent border-none p-0 text-[var(--vscode-foreground)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--vscode-focusBorder)] rounded"
        onClick={onToggle}
        aria-expanded={isOpen}
      >
        <ChevronRightIcon
          className={`mt-0.5 h-4 w-4 shrink-0 transition-transform duration-200 ease-in-out ${
            isOpen ? "rotate-90" : ""
          }`}
        />
        <div className="flex-1 min-w-0">
          <span>{title}</span>
          {subtitle && (
            <p className="text-description my-1 text-xs font-normal">
              {subtitle}
            </p>
          )}
        </div>
      </button>
      <div
        className={`duration-300 overflow-hidden transition-all ease-in-out ${
          isOpen ? "mt-4 max-h-screen opacity-100" : "max-h-0 opacity-0"
        }`}
      >
        <div className="pl-6">{children}</div>
      </div>
    </div>
  );
}
