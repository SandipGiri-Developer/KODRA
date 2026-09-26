const getModelByRole = () => undefined;
import { ModelSelectDropdown } from "./ModelSelectDropdown";
import { ChevronDownIcon } from "@heroicons/react/24/outline";
import { Listbox, ListboxButton, ListboxOption, ListboxOptions } from "@headlessui/react";
import { useState } from "react";

const ModeSelect = () => {
  const [selectedMode, setSelectedMode] = useState("Agent");
  
  return (
    <Listbox value={selectedMode} onChange={setSelectedMode}>
      <ListboxButton className="flex items-center gap-1 bg-vsc-input-background rounded-full px-2 py-0.5 cursor-pointer hover:brightness-125 border border-vsc-commandCenter-inactiveBorder transition-colors outline-none">
        <span className="text-[11px] font-medium text-vsc-foreground">{selectedMode}</span>
        <ChevronDownIcon className="h-3 w-3 text-vsc-foreground" />
      </ListboxButton>
      <ListboxOptions 
        anchor="top start" 
        className="z-50 rounded-md border border-vsc-commandCenter-inactiveBorder bg-vsc-editor-background p-1 shadow-lg outline-none min-w-[120px] mb-1"
      >
        <ListboxOption 
          value="Agent" 
          className="cursor-pointer select-none rounded px-2 py-1.5 text-xs hover:bg-vsc-list-activeSelectionBackground hover:text-vsc-list-activeSelectionForeground text-vsc-foreground"
        >
          Agent
        </ListboxOption>
        <ListboxOption 
          value="Plan Chat" 
          className="cursor-pointer select-none rounded px-2 py-1.5 text-xs hover:bg-vsc-list-activeSelectionBackground hover:text-vsc-list-activeSelectionForeground text-vsc-foreground"
        >
          Plan Chat
        </ListboxOption>
      </ListboxOptions>
    </Listbox>
  );
};
const exitEdit = (a: any) => ({type: "dummy"});
import {
  AtSymbolIcon,
  LightBulbIcon as LightBulbIconOutline,
  PhotoIcon,
} from "@heroicons/react/24/outline";
import { LightBulbIcon as LightBulbIconSolid, ArrowRightIcon, StopIcon } from "@heroicons/react/24/solid";
import { InputModifiers } from "core";
const modelSupportsImages = (...args: any) => false;
const modelSupportsReasoning = (arg: any) => false;
import { memo, useContext, useRef } from "react";
import { IdeMessengerContext } from "../../context/IdeMessenger";
import { useAppDispatch, useAppSelector } from "../../redux/hooks";
import { selectUseActiveFile } from "../../redux/selectors";
import { selectSelectedChatModel } from "../../redux/slices/configSlice";
import { setHasReasoningEnabled } from "../../redux/slices/sessionSlice";
import { setReasoningSetting } from "../../redux/slices/uiSlice";

import { getMetaKeyLabel, isMetaEquivalentKeyPressed } from "../../util";
import { ToolTip } from "../gui/Tooltip";


import { Button } from "../ui";
import { useFontSize } from "../ui/font";
import ContextStatus from "./ContextStatus";
import HoverItem from "./InputToolbar/HoverItem";

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
  const codeToEdit = useAppSelector((store) => store.editModeState.codeToEdit);
  const hasReasoningEnabled = useAppSelector(
    (store) => store.session.hasReasoningEnabled,
  );
  const isStreaming = useAppSelector((state) => state.session.isStreaming);
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
        className={`find-widget-skip bg-vsc-input-background flex select-none flex-row items-center justify-between gap-1 pt-1 ${props.hidden ? "pointer-events-none h-0 cursor-default opacity-0" : "pointer-events-auto mt-2 cursor-text opacity-100"}`}
        style={{
          fontSize: smallFont,
        }}
      >
        <div className="xs:gap-1.5 flex flex-row items-center gap-2">
          {!isInEdit && (
            <ModeSelect />
          )}
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

                  <ToolTip place="top" content="Attach Image">
                    <HoverItem className="">
                      <PhotoIcon
                        className="h-3 w-3 hover:brightness-125"
                        onClick={(e) => {
                          fileInputRef.current?.click();
                        }}
                      />
                    </HoverItem>
                  </ToolTip>
                </>
              ))}
            {props.toolbarOptions?.hideAddContext || (
              <ToolTip place="top" content="Attach Context">
                <HoverItem onClick={props.onAddContextItem}>
                  <AtSymbolIcon className="h-3 w-3 hover:brightness-125" />
                </HoverItem>
              </ToolTip>
            )}
            {supportsReasoning && (
              <HoverItem
                onClick={() => {
                  dispatch(setHasReasoningEnabled(!hasReasoningEnabled));
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
          <ToolTip place="top" content={isStreaming ? "Stop generating" : "Send (⏎)"}>
            {isStreaming ? (
              <button
  data-testid="stop-generation-button"
  onClick={() => {
    ideMessenger.post("cancelGeneration", undefined);
    if ((window as any).vscode) {
      (window as any).vscode.postMessage({ type: 'cancelGeneration' });
    }
  }}
  className="group flex items-center justify-center w-8 h-8 rounded-full border-none bg-transparent backdrop-blur-md transition-all hover:bg-vsc-foreground/5 cursor-pointer relative"
>
  {/* Blur outer circle effect */}
  <div className="absolute inset-0 rounded-full bg-vsc-background/30 shadow-[0_0_10px_rgba(0,0,0,0.1)] pointer-events-none" />
  {/* Red square inside */}
  <div className="w-2.5 h-2.5 bg-[#e05252] rounded-[2px] shadow-[0_0_8px_rgba(224,82,82,0.4)] group-hover:bg-[#f15e5e] transition-colors relative z-10" />
</button>
            ) : (
              <button
                data-testid="submit-input-button"
                onClick={async (e) => {
                  if (props.onEnter) {
                    props.onEnter({
                      useCodebase: false,
                      noContext: useActiveFile
                        ? isMetaEquivalentKeyPressed(e as any) || e.altKey
                        : !(isMetaEquivalentKeyPressed(e as any) || e.altKey),
                    });
                  }
                }}
                disabled={isEnterDisabled}
                className={`flex items-center justify-center w-8 h-8 rounded-full border-none transition-colors ${
                  isEnterDisabled
                    ? "bg-gray-500 text-gray-300 cursor-not-allowed opacity-50"
                    : "bg-blue-500 text-white hover:bg-blue-400 cursor-pointer"
                }`}
              >
                <ArrowRightIcon className="w-4 h-4" />
              </button>
            )}
          </ToolTip>
        </div>
      </div>
    </>
  );
}

function shallowToolbarOptionsEqual(a?: ToolbarOptions, b?: ToolbarOptions) {
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
    prev.activeKey === next.activeKey &&
    shallowToolbarOptionsEqual(prev.toolbarOptions, next.toolbarOptions),
);
