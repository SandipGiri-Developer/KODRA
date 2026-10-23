// Hook detecting whether off-screen rendering (OSR) is enabled in JetBrains IDE hosts.
import { useState, useEffect, useContext } from "react";
import { isJetBrains } from "../util";
import { useWebviewListener } from "./useWebviewListener";
import { IdeMessengerContext } from "../context/IdeMessenger";

// Queries the IDE host to determine if off-screen rendering is active for context menu positioning.
export default function useIsOSREnabled() {
  const [isOSREnabled, setIsOSREnabled] = useState(false);
  const ideMessenger = useContext(IdeMessengerContext);

  useEffect(() => {
    if (isJetBrains()) {
      (async () => {
        await ideMessenger
          .request("jetbrains/isOSREnabled", undefined)
          .then((result) => {
            if (result.status === "success") {
              setIsOSREnabled(result.content);
            }
          });
      })();
    }
  }, [ideMessenger]);

  return isOSREnabled;
}
