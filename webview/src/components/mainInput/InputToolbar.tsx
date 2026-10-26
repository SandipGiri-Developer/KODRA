import React, { memo, useContext, useRef } from "react";
import {
  AtSymbolIcon,
  ChevronDownIcon,
  LightBulbIcon as LightBulbIconOutline,
  PhotoIcon,
  SparklesIcon,
  DocumentTextIcon,
  ChatBubbleLeftIcon,
} from "@heroicons/react/24/outline";
import {
  LightBulbIcon as LightBulbIconSolid,
  ArrowUpIcon,
  StopIcon,
} from "@heroicons/react/24/solid";
import { InputModifiers, MessageModes } from "core";
import { IdeMessengerContext } from "../../context/IdeMessenger";
import { useAppDispatch, useAppSelector } from "../../redux/hooks";
import { selectUseActiveFile } from "../../redux/selectors";
import { selectSelectedChatModel } from "../../redux/slices/configSlice";
import { setHasReasoningEnabled, setMode } from "../../redux/slices/sessionSlice";
import { setReasoningSetting } from "../../redux/slices/uiSlice";
import { getMetaKeyLabel, isMetaEquivalentKeyPressed } from "../../util";
import { ToolTip } from "../gui/Tooltip";
import { Button } from "../ui";
import { useFontSize } from "../ui/font";
import {
  Listbox,
  ListboxButton,
  ListboxOption,
  ListboxOptions,
} from "../ui/Listbox";
import ContextStatus from "./ContextStatus";
import HoverItem from "./InputToolbar/HoverItem";
import { ModelSelectDropdown } from "./ModelSelectDropdown";

import { exitEdit } from "../../redux/thunks/edit";
import { modelSupportsImages, modelSupportsReasoning } from "../../util";

interface ModeOption {
  value: MessageModes;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  description?: string;
}

const MODE_OPTIONS: ModeOption[] = [
  { value: "agent", label: "Agent", icon: SparklesIcon },
  { value: "plan", label: "Plan", icon: DocumentTextIcon },
  { value: "chat", label: "Chat", icon: ChatBubbleLeftIcon },
];

const ModeSelect = () => {
  const dispatch = useAppDispatch();
  const reduxMode = useAppSelector((store) => store.session.mode);

  const currentMode: MessageModes =
    reduxMode === "chat" || reduxMode === "plan" ? reduxMode : "agent";

  const selectedOption =
    MODE_OPTIONS.find((m) => m.value === currentMode) ?? MODE_OPTIONS[0];

  const handleSelect = (val: MessageModes) => {
    dispatch(setMode(val));
  };

  return (
    <Listbox value={currentMode} onChange={handleSelect}>
      <div className="inline-flex w-fit shrink-0">
        {/* Trigger */}
        <ListboxButton
          className="
            group inline-flex w-fit shrink-0 items-center gap-1.5
            rounded-lg border-none bg-transparent px-2 py-1
            text-vsc-foreground shadow-none outline-none cursor-pointer
            transition-colors duration-200 ease-out
            hover:bg-white/10 data-[open]:bg-white/10
          "
        >
          <span className="whitespace-nowrap text-xs font-medium">
            {selectedOption.label}
          </span>
          <ChevronDownIcon className="h-3 w-3 shrink-0 opacity-70 transition-transform duration-200 group-data-[open]:rotate-180" />
        </ListboxButton>

        {/* Popover card (compact) */}
        <ListboxOptions
          anchor="top start"
          transition
          className="
            z-50 mb-1.5 w-40 max-h-64 overflow-y-auto
            rounded-xl border border-white/10
            bg-vsc-background p-1
            shadow-xl shadow-black/40 outline-none origin-bottom-left
            transition duration-150 ease-out
            data-[closed]:scale-95 data-[closed]:opacity-0
          "
        >
          {/* Section label */}
          <div className="px-2 pb-1 pt-1">
            <span className="text-[11px] text-vsc-foreground opacity-50">
              Mode
            </span>
          </div>

          {/* Thin divider */}
          <div className="mx-2 mb-1 h-px bg-white/10" />

          {/* Rows */}
          {MODE_OPTIONS.map((opt) => {
            const Icon = opt.icon;
            const isSelected = currentMode === opt.value;

            return (
              <ListboxOption
                key={opt.value}
                value={opt.value}
                className={`
                  flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5
                  text-vsc-foreground transition-all duration-150
                  data-[focus]:bg-white/5 data-[focus]:opacity-100
                  ${isSelected ? "opacity-100" : "opacity-60"}
                `}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />

                <span className="min-w-0 flex-1 truncate text-xs font-medium">
                  {opt.label}
                </span>

                {opt.description ? (
                  <span className="shrink-0 text-[10px] opacity-50">
                    {opt.description}
                  </span>
                ) : null}
              </ListboxOption>
            );
          })}
        </ListboxOptions>
      </div>
    </Listbox>
  );
};

// This is new code

export interface ToolbarOptions {
  hideUseCodebase?: boolean;
  hideImageUpload?: boolean;
  hideAddContext?: boolean;
  enterText?: string;
  hideSelectModel?: boolean;
}

interface InputToolbarProps {
  onEnter?: (modifiers: InputModifiers) => void;
  onAddContextItem?: () => void;
  onClick?: () => void;
  onImageFileSelected?: (file: File) => void;
  hidden?: boolean;
  activeKey: string | null;
  toolbarOptions?: ToolbarOptions;
  disabled?: boolean;
  isMainInput?: boolean;
}

function InputToolbar(props: InputToolbarProps) {
  const dispatch = useAppDispatch();
  const ideMessenger = useContext(IdeMessengerContext);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const defaultModel = useAppSelector(selectSelectedChatModel);
  const useActiveFile = useAppSelector(selectUseActiveFile);
  const isInEdit = useAppSelector((store) => store.session.isInEdit);
  const codeToEdit = useAppSelector(
    (store) => store.editModeState.codeToEdit,
  );

  const hasReasoningEnabled = useAppSelector(
    (store) => store.session.hasReasoningEnabled,
  );

  const isStreaming = useAppSelector(
    (state) => state.session.isStreaming,
  );

  const isEnterDisabled =
    props.disabled || (isInEdit && codeToEdit.length === 0);

  const supportsImages =
    defaultModel &&
    modelSupportsImages(
      defaultModel.provider,
      defaultModel.model,
      defaultModel.title,
      defaultModel.capabilities,
    );

  const supportsReasoning = modelSupportsReasoning(defaultModel);

  const smallFont = useFontSize(-2);
  const tinyFont = useFontSize(-3);
  const hasText = !isEnterDisabled;

  return (
    <>
      <div
        onClick={props.onClick}
        className={`find-widget-skip bg-vsc-input-background flex select-none flex-row items-center justify-between gap-1 pt-1 ${props.hidden
          ? "pointer-events-none h-0 cursor-default opacity-0"
          : "pointer-events-auto mt-2 cursor-text opacity-100"
          }`}
        style={{
          fontSize: smallFont,
        }}
      >
        {/* Left side */}
        <div className="xs:gap-1.5 flex flex-row items-center gap-1">
          {!isInEdit && <ModeSelect />}

          <ModelSelectDropdown />

          <div className="xs:flex text-description -mb-1 hidden items-center transition-colors duration-200">
            {props.toolbarOptions?.hideImageUpload ||
              (supportsImages && (
                <>
                  <input
                    type="file"
                    ref={fileInputRef}
                    style={{ display: "none" }}
                    accept=".jpg,.jpeg,.png,.gif,.svg,.webp"
                    onChange={(e) => {
                      const files = e.target?.files ?? [];

                      for (const file of files) {
                        props.onImageFileSelected?.(file);
                      }

                      if (fileInputRef.current) {
                        fileInputRef.current.value = "";
                      }
                    }}
                  />

                  <ToolTip
                    place="top"
                    content="Attach Image"
                  >
                    <HoverItem className="">
                      <PhotoIcon
                        className="h-3 w-3 hover:brightness-125"
                        onClick={() => {
                          fileInputRef.current?.click();
                        }}
                      />
                    </HoverItem>
                  </ToolTip>
                </>
              ))}

            {props.toolbarOptions?.hideAddContext || (
              <ToolTip
                place="top"
                content="Attach Context"
              >
                <HoverItem
                  onClick={props.onAddContextItem}
                >
                  <AtSymbolIcon className="h-3 w-3 hover:brightness-125" />
                </HoverItem>
              </ToolTip>
            )}

            {supportsReasoning && (
              <HoverItem
                onClick={() => {
                  dispatch(
                    setHasReasoningEnabled(
                      !hasReasoningEnabled,
                    ),
                  );

                  if (defaultModel?.title) {
                    dispatch(
                      setReasoningSetting({
                        modelTitle: defaultModel.title,
                        enabled: !hasReasoningEnabled,
                      }),
                    );
                  }
                }}
              >
                <ToolTip
                  place="top"
                  content={
                    hasReasoningEnabled
                      ? "Disable model reasoning"
                      : "Enable model reasoning"
                  }
                >
                  {hasReasoningEnabled ? (
                    <LightBulbIconSolid className="h-3 w-3 brightness-200 hover:brightness-150" />
                  ) : (
                    <LightBulbIconOutline className="h-3 w-3 hover:brightness-150" />
                  )}
                </ToolTip>
              </HoverItem>
            )}
          </div>
        </div>

        {/* Right side */}
        <div
          className="text-description flex items-center gap-2 whitespace-nowrap"
          style={{
            fontSize: tinyFont,
          }}
        >
          {!isInEdit && <ContextStatus />}

          {isInEdit && (
            <HoverItem
              className="hidden hover:underline sm:flex"
              onClick={async () => {
                void dispatch(exitEdit({}));
                ideMessenger.post("focusEditor", undefined);
              }}
            >
              <span>
                <i>Esc</i> to exit Edit
              </span>
            </HoverItem>
          )}

          <ToolTip
            place="top"
            content={
              isStreaming
                ? "Stop generation"
                : hasText
                  ? "Send message (⏎)"
                  : "Type a message"
            }
          >
            {isStreaming ? (
              /* ---------------- STOP BUTTON (unchanged) ---------------- */
              <button
                type="button"
                data-testid="stop-generation-button"
                title="Stop generation"
                aria-label="Stop generating response"
                onClick={() => {
                  ideMessenger.post("cancelGeneration", undefined);

                  if ((window as any).vscode) {
                    (window as any).vscode.postMessage({
                      type: "cancelGeneration",
                    });
                  }
                }}
                className="group flex h-7 w-7 shrink-0 items-center justify-center rounded-full transform-gpu
    border-0 outline-none cursor-pointer
    bg-[#2F48A1] hover:bg-[#3A57C2] text-white shadow-md shadow-[#2F48A1]/30
    transition-[background-color,box-shadow,transform] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]
    hover:scale-105 active:scale-95
    focus-visible:ring-2 focus-visible:ring-[#2F48A1]/60 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900"
              >
                <StopIcon className="h-3 w-3 fill-current transition-transform duration-300 ease-out group-hover:scale-110" />
              </button>
            ) : (
              /* ------- SEND BUTTON: waveform when empty, arrow when text ------- */
              <button
                type="button"
                data-testid="submit-input-button"
                title={hasText ? "Send message" : "Type a message"}
                aria-label="Send message"
                aria-disabled={!hasText}
                onClick={async (e) => {
                  if (props.onEnter && !isEnterDisabled) {
                    props.onEnter({
                      useCodebase: false,
                      noContext: useActiveFile
                        ? isMetaEquivalentKeyPressed(e as any) || e.altKey
                        : !(isMetaEquivalentKeyPressed(e as any) || e.altKey),
                    });
                  }
                }}
                className={`group relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full transform-gpu
    border-0 outline-none
    bg-[#2F48A1] text-white shadow-md shadow-[#2F48A1]/30
    transition-[background-color,box-shadow,transform] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]
    focus-visible:ring-2 focus-visible:ring-[#2F48A1]/60 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900
    ${hasText
                    ? "hover:bg-[#3A57C2] hover:scale-105 active:scale-95 cursor-pointer"
                    : "cursor-default"
                  }`}
              >
                {/* Waveform icon: shown when the input is empty */}
                <svg
                  viewBox="0 0 24 24"
                  className={`absolute h-3.5 w-3.5 transition-all duration-300 ease-out ${hasText ? "scale-50 opacity-0" : "scale-100 opacity-100"
                    }`}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.6"
                  strokeLinecap="round"
                >
                  <line x1="4" y1="10" x2="4" y2="14" />
                  <line x1="8" y1="6" x2="8" y2="18" />
                  <line x1="12" y1="3" x2="12" y2="21" />
                  <line x1="16" y1="7" x2="16" y2="17" />
                  <line x1="20" y1="10" x2="20" y2="14" />
                </svg>

                {/* Up arrow icon: shown when there is text */}
                <svg
                  viewBox="0 0 24 24"
                  className={`absolute h-4 w-4 transition-all duration-300 ease-out ${hasText ? "scale-100 opacity-100" : "scale-50 opacity-0"
                    }`}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="12" y1="20" x2="12" y2="5" />
                  <polyline points="5.5 11.5 12 5 18.5 11.5" />
                </svg>
              </button>
            )}
          </ToolTip>
        </div>
      </div>
    </>
  );
}

function shallowToolbarOptionsEqual(
  a?: ToolbarOptions,
  b?: ToolbarOptions,
) {
  if (a === b) return true;
  if (!a || !b) return false;

  return (
    a.hideAddContext === b.hideAddContext &&
    a.hideImageUpload === b.hideImageUpload &&
    a.hideUseCodebase === b.hideUseCodebase &&
    a.hideSelectModel === b.hideSelectModel &&
    a.enterText === b.enterText
  );
}

export default memo(
  InputToolbar,
  (prev, next) =>
    prev.hidden === next.hidden &&
    prev.disabled === next.disabled &&
    prev.isMainInput === next.isMainInput &&
    shallowToolbarOptionsEqual(
      prev.toolbarOptions,
      next.toolbarOptions,
    ),
);