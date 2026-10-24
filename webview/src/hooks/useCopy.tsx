// Hook for clipboard copying with temporary copied state indicator.
import { useState, useContext, useCallback } from "react";
import { IdeMessengerContext } from "../context/IdeMessenger";
import { isJetBrains } from "../util";

// Manages clipboard copy interaction and tracks visual copied confirmation state.
export default function useCopy(text: string | (() => string)) {
  const [copied, setCopied] = useState<boolean>(false);
  const ideMessenger = useContext(IdeMessengerContext);

  // Copies the text payload to clipboard via navigator API or JetBrains bridge.
  const copyText = useCallback(() => {
    const textVal = typeof text === "string" ? text : text();
    if (isJetBrains()) {
      ideMessenger.post("copyText", { text: textVal });
    } else {
      navigator.clipboard.writeText(textVal);
    }

    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [text, ideMessenger]);

  return { copied, copyText };
}
