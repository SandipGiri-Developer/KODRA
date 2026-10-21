import { cloneElement, CSSProperties, ReactElement, useId } from "react";
import ReactDOM from "react-dom";
import { ITooltip, Tooltip } from "react-tooltip";
import { vscBackground, vscForeground } from "..";
import { varWithFallback } from "../../styles/theme";
import { fontSize } from "../../util";

// Needed to override styles in react-tooltip
const TooltipStyles: CSSProperties = {
  fontSize: fontSize(-3),
  fontWeight: 500,
  backgroundColor: vscBackground,
  border: "1px solid rgba(255, 255, 255, 0.1)",
  borderRadius: "10px",
  color: vscForeground,
  padding: "1px 1px",
  zIndex: 1000,
  maxWidth: "80vw",
  textAlign: "center",
  whiteSpace: "nowrap",
  boxShadow: "0 4px 14px rgba(0, 0, 0, 0.45)",
};

export function ToolTip({
  children,
  content,
  ...props
}: Omit<ITooltip, "id" | "children" | "content"> & {
  content: ITooltip["children"];
  children: ReactElement;
}) {
  const tooltipId = useId();

  const combinedStyles = {
    ...TooltipStyles,
    ...props.style,
  };

  const tooltipPortalDiv = document.getElementById("tooltip-portal-div");

  const childrenWithTooltipId = cloneElement(children, {
    "data-tooltip-id": tooltipId,
  });

  return (
    <>
      {childrenWithTooltipId}
      {tooltipPortalDiv &&
        ReactDOM.createPortal(
          <Tooltip
            {...props}
            id={tooltipId}
            noArrow
            style={combinedStyles}
            opacity={1}
            delayShow={200}
          >
            {content}
          </Tooltip>,
          tooltipPortalDiv,
        )}
    </>
  );
}