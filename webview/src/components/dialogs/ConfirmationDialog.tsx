// Modal dialog component for user confirmation of destructive or irreversible actions.
import React from "react";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { useAppDispatch } from "../../redux/hooks";
import { setShowDialog } from "../../redux/slices/uiSlice";
import { Button } from "../ui";

export interface ConfirmationDialogProps {
  title: string;
  text: string;
  onConfirm: () => void | Promise<void>;
  onCancel?: () => void;
  confirmText?: string;
  cancelText?: string;
  isDestructive?: boolean;
}

// Modal dialog prompting user confirmation with custom action buttons and danger styling.
export const ConfirmationDialog: React.FC<ConfirmationDialogProps> = ({
  title,
  text,
  onConfirm,
  onCancel,
  confirmText = "Permanently Delete",
  cancelText = "Cancel",
  isDestructive = true,
}) => {
  const dispatch = useAppDispatch();
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  const handleCancel = () => {
    dispatch(setShowDialog(false));
    onCancel?.();
  };

  const handleConfirm = async () => {
    try {
      setIsSubmitting(true);
      await onConfirm();
    } finally {
      setIsSubmitting(false);
      dispatch(setShowDialog(false));
    }
  };

  return (
    <div className="flex flex-col space-y-4 text-left">
      <div className="flex items-center space-x-3">
        {isDestructive && (
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-red-900/30 text-red-500">
            <ExclamationTriangleIcon className="h-6 w-6" aria-hidden="true" />
          </div>
        )}
        <h3 className="text-base font-semibold text-vsc-foreground m-0">{title}</h3>
      </div>

      <div className="text-sm text-vsc-descriptionForeground leading-relaxed">
        <p className="m-0 whitespace-pre-line">{text}</p>
      </div>

      <div className="flex justify-end space-x-3 pt-2 border-t border-vsc-commandCenter-inactiveBorder">
        <Button
          variant="secondary"
          size="sm"
          onClick={handleCancel}
          disabled={isSubmitting}
        >
          {cancelText}
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={handleConfirm}
          disabled={isSubmitting}
          className={isDestructive ? "!bg-red-600 hover:enabled:!bg-red-700 text-white" : ""}
        >
          {isSubmitting ? "Deleting..." : confirmText}
        </Button>
      </div>
    </div>
  );
};

export default ConfirmationDialog;
