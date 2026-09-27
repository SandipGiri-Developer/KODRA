import {
  BarsArrowDownIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";
import { ChatHistoryItem } from "core";
const renderChatMessage = (message: any) => typeof message.content === "string" ? message.content : JSON.stringify(message.content);
import { useAppSelector } from "../../redux/hooks";
import { FeedbackButtons } from "../FeedbackButtons";
import { CopyIconButton } from "../gui/CopyIconButton";
import HeaderButtonWithToolTip from "../gui/HeaderButtonWithToolTip";

export interface ResponseActionsProps {
  isTruncated: boolean;
  onKODRAGeneration: () => void;
  index: number;
  onDelete: () => void;
  item: ChatHistoryItem;
  isLast: boolean;
}

export default function ResponseActions({
  onKODRAGeneration,
  index,
  item,
  isTruncated,
  onDelete,
  isLast,
}: ResponseActionsProps) {


  return (
    <div className="text-description-muted mx-2 flex cursor-default items-center justify-end space-x-1 bg-transparent pb-0 text-xs">


      {isTruncated && (
        <HeaderButtonWithToolTip
          tabIndex={-1}
          text="KODRA generation"
          onClick={onKODRAGeneration}
        >
          <BarsArrowDownIcon className="text-description-muted h-3.5 w-3.5" />
        </HeaderButtonWithToolTip>
      )}

      <HeaderButtonWithToolTip
        testId={`delete-button-${index}`}
        text="Delete"
        tabIndex={-1}
        onClick={onDelete}
      >
        <TrashIcon className="text-description-muted h-3.5 w-3.5" />
      </HeaderButtonWithToolTip>

      <CopyIconButton
        tabIndex={-1}
        text={renderChatMessage(item.message)}
        clipboardIconClassName="h-3.5 w-3.5 text-description-muted"
        checkIconClassName="h-3.5 w-3.5 text-success"
      />

      <FeedbackButtons item={item} />
    </div>
  );
}
