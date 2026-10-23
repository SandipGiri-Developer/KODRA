// Container card component with standard borders and background styling.
import { cn } from "../../util/cn";

interface CardProps extends React.ComponentProps<"div"> {
  children: React.ReactNode;
}

// Card container component wrapping children with standardized border and background styling.
export function Card({ children, className = "", ...props }: CardProps) {
  return (
    <div
      {...props}
      className={cn("bg-editor rounded-default space-y-0 px-4 py-3", className)}
    >
      {children}
    </div>
  );
}
