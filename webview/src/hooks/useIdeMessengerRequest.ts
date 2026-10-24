// Hook for executing asynchronous request-response IPC queries to the IDE extension host.
import { useContext, useEffect, useState } from 'react';
import { IdeMessengerContext } from '../context/IdeMessenger';

// Manages request lifecycle, loading state, and response caching for extension IPC calls.
export function useIdeMessengerRequest(messageType: any, data: any) {
  const ideMessenger = useContext(IdeMessengerContext);
  const [result, setResult] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Dispatches the IPC request and updates response and loading states upon completion.
  async function makeRequest() {
    if (!data) {
      setResult(null);
      return;
    }
    setIsLoading(true);
    try {
      const response = await ideMessenger.request(messageType, data);
      if (response.status === 'success') {
        setResult(response.content);
      } else {
        console.error('Error', response.error);
        setResult(null);
      }
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    makeRequest();
  }, [data, messageType]);

  return { result, isLoading, refresh: makeRequest };
}
