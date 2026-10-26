// Shared styled components and VS Code theme color token bindings.
import styled from "styled-components";
import { varWithFallback } from "../styles/theme";

export const defaultBorderRadius = "0.5rem";
export const lightGray = "#999998";

export const vscInputBackground = varWithFallback("input-background");
export const vscQuickInputBackground = varWithFallback("input-background");
export const vscBackground = varWithFallback("background");
export const vscForeground = varWithFallback("foreground");
export const vscButtonBackground = varWithFallback("primary-background");
export const vscButtonForeground = varWithFallback("primary-foreground");
export const vscEditorBackground = varWithFallback("editor-background");
export const vscListActiveBackground = varWithFallback("list-active");
export const vscFocusBorder = varWithFallback("border-focus");
export const vscListActiveForeground = varWithFallback(
  "list-active-foreground",
);
export const vscInputBorder = varWithFallback("input-border");
export const vscInputBorderFocus = varWithFallback("border-focus");
export const vscBadgeBackground = varWithFallback("badge-background");
export const vscCommandCenterActiveBorder = varWithFallback(
  "command-border-focus",
);
export const vscCommandCenterInactiveBorder = varWithFallback("command-border");

export const Button = styled.button`
  padding: 6px 12px;
  margin: 8px 0;
  border-radius: ${defaultBorderRadius};

  border: none;
  color: ${vscBackground};
  background-color: ${vscForeground};

  &:disabled {
    color: ${vscBackground};
    opacity: 0.5;
    pointer-events: none;
  }

  &:hover:enabled {
    cursor: pointer;
    filter: brightness(1.2);
  }
`;

export const SecondaryButton = styled.button`
  padding: 6px 12px;
  margin: 8px;
  border-radius: ${defaultBorderRadius};

  border: 1px solid ${lightGray};
  color: ${vscForeground};
  background-color: ${vscInputBackground};

  &:disabled {
    color: gray;
  }

  &:hover:enabled {
    cursor: pointer;
    background-color: ${vscBackground};
    opacity: 0.9;
  }
`;

export const CustomScrollbarDiv = styled.div`
  scrollbar-base-color: transparent;
  scrollbar-width: thin;
  background-color: ${vscBackground};

  & * {
    ::-webkit-scrollbar {
      width: 4px;
    }

    ::-webkit-scrollbar:horizontal {
      height: 4px;
    }

    ::-webkit-scrollbar-thumb {
      border-radius: 2px;
    }
  }
`;

export const Input = styled.input`
  width: 100%;
  padding: 8px 12px;
  box-sizing: border-box;
  margin: 4px 0px;
  border-radius: ${defaultBorderRadius};
  outline: 1px solid ${lightGray};
  border: none;
  background-color: ${vscBackground};
  color: ${vscForeground};

  &:focus {
    background: ${vscInputBackground};
    outline: 1px solid ${lightGray};
  }

  &:invalid {
    outline: 1px solid red;
  }
`;

export const HeaderButton = styled.button<{
  inverted: boolean | undefined;
  backgroundColor?: string;
  hoverBackgroundColor?: string;
}>`
  background-color: ${({ inverted, backgroundColor }) => {
    return backgroundColor ?? (inverted ? vscForeground : "transparent");
  }};
  color: ${({ inverted }) => (inverted ? vscBackground : vscForeground)};

  border: none;
  border-radius: ${defaultBorderRadius};
  cursor: ${({ disabled }) => (disabled ? "default" : "pointer")};

  &:focus {
    outline: none;
    border: none;
  }

  &:focus-visible {
    outline: 1px solid var(--vscode-focusBorder, #007fd4);
  }

  &:hover {
    background-color: ${({ inverted, hoverBackgroundColor }) =>
      typeof inverted === "undefined" || inverted
        ? (hoverBackgroundColor ?? vscInputBackground)
        : "transparent"};
  }

  &:active:enabled {
    transform: scale(0.96);
  }

  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 2px;
  transition: background-color 150ms ease, transform 100ms ease;
`;
