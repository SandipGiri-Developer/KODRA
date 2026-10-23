// Visual horizontal divider element for separating UI sections.
interface DividerProps {
  className?: string;
}

// Horizontal rule divider element separating sections with theme borders.
export function Divider({ className }: DividerProps) {
  return (
    <div
      className={`border-command-border my-2 border-[0.5px] border-b border-solid opacity-20 ${className || ""}`}
    />
  );
}
