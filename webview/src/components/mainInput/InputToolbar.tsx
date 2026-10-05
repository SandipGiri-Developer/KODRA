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

const getModelByRole = () => undefined;
const exitEdit = (a: any) => ({ type: "dummy" });
const modelSupportsImages = (...args: any) => false;
const modelSupportsReasoning = (arg: any) => false;

interface ModeOption {
  value: MessageModes;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
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
      {/* Important: wrapper only takes the width of the visible button */}
      <div className="inline-flex w-fit shrink-0">
        <ListboxButton
          className="
            inline-flex w-fit shrink-0
            items-center gap-1
            border-none bg-transparent
            px-1 py-0
            shadow-none
            hover:bg-transparent
            hover:brightness-125
            cursor-pointer
          "
        >
          <span className="whitespace-nowrap text-xs text-vsc-foreground">
            {selectedOption.label}
          </span>

          <ChevronDownIcon className="h-3 w-3 shrink-0 text-vsc-foreground" />
        </ListboxButton>

        <ListboxOptions
          anchor="top start"
          className="
            z-50
            w-44
            max-h-80
            overflow-y-auto
            rounded-md
            border
            border-vsc-commandCenter-inactiveBorder
            bg-vsc-background
            mb-1
          "
        >
          <div className="flex items-center justify-between border-b border-vsc-commandCenter-inactiveBorder px-3 py-2">
            <span className="text-xs font-semibold">Mode</span>
          </div>

          {MODE_OPTIONS.map((opt) => {
            const Icon = opt.icon;
            const isSelected = currentMode === opt.value;

            return (
              <ListboxOption
                key={opt.value}
                value={opt.value}
                className={`flex cursor-pointer items-center gap-2 px-3 py-1.5 hover:bg-list-active hover:text-list-active-foreground ${
                  isSelected
                    ? "bg-list-active text-list-active-foreground"
                    : ""
                }`}
              >
                <Icon className="h-3.5 w-3.5 flex-shrink-0" />

                <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
                  <span className="truncate text-xs">
                    {opt.label}
                  </span>
                </div>
              </ListboxOption>
            );
          })}
        </ListboxOptions>
      </div>
    </Listbox>
  );
};

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

  return (
    <>
      <div
        onClick={props.onClick}
        className={`find-widget-skip bg-vsc-input-background flex select-none flex-row items-center justify-between gap-1 pt-1 ${
          props.hidden
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
                : "Send message (⏎)"
            }
          >
            {isStreaming ? (
              <button
                type="button"
                data-testid="stop-generation-button"
                title="Stop generation"
                aria-label="Stop generating response"
                onClick={() => {
                  ideMessenger.post(
                    "cancelGeneration",
                    undefined,
                  );

                  if ((window as any).vscode) {
                    (window as any).vscode.postMessage({
                      type: "cancelGeneration",
                    });
                  }
                }}
                className="p-2 rounded-xl bg-gray-800 hover:bg-gray-700 text-white transition-all duration-150 active:scale-95 flex items-center justify-center cursor-pointer shadow-sm"
              >
                <StopIcon className="h-3.5 w-3.5 fill-current" />
              </button>
            ) : (
              <button
                type="button"
                data-testid="submit-input-button"
                title="Send message"
                aria-label="Send message"
                onClick={async (e) => {
                  if (props.onEnter && !isEnterDisabled) {
                    props.onEnter({
                      useCodebase: false,
                      noContext: useActiveFile
                        ? isMetaEquivalentKeyPressed(e as any) ||
                          e.altKey
                        : !(
                            isMetaEquivalentKeyPressed(
                              e as any,
                            ) || e.altKey
                          ),
                    });
                  }
                }}
                disabled={isEnterDisabled}
                className={`p-2 rounded-xl transition-all duration-150 active:scale-95 flex items-center justify-center ${
                  !isEnterDisabled
                    ? "bg-blue-600 hover:bg-blue-500 text-white shadow-md shadow-blue-600/20 hover:shadow-blue-600/30 cursor-pointer"
                    : "bg-gray-800/40 text-gray-600 cursor-not-allowed"
                }`}
              >
                <ArrowUpIcon className="h-4 w-4" />
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