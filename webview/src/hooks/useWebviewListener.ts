import { useContext, useEffect } from 'react';
import { IdeMessengerContext } from '../context/IdeMessenger';

export function useWebviewListener(
  messageType: any,
  handler: any,
  dependencies?: any[],
  skip?: boolean
) {
  const ideMessenger = useContext(IdeMessengerContext);

  useEffect(() => {
    let listener: ((event: MessageEvent) => Promise<void>) | undefined;
    if (!skip) {
      listener = async (event: MessageEvent) => {
        try {
          const raw = event.data;
          if (!raw || typeof raw !== 'object') {
            return;
          }
          const incomingType = raw.messageType || raw.type;
          if (incomingType === messageType) {
            const data = raw.data !== undefined ? raw.data : raw;
            const result = await handler(data);
            if (raw.messageId) {
              ideMessenger.respond(messageType, result, raw.messageId);
            }
          }
        } catch (err) {
          console.error(`Error in useWebviewListener for ${messageType}:`, err);
        }
      };
      window.addEventListener('message', listener);
    }
    return () => {
      if (listener) {
        window.removeEventListener('message', listener);
      }
    };
  }, dependencies ? [...dependencies, skip, ideMessenger] : [skip, ideMessenger]);
}
