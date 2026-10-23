// Hook listening for navigation-triggering extension IPC messages and routing to the home chat view.
import { useNavigate } from 'react-router-dom';
import { v4 as uuidv4 } from 'uuid';
import { useWebviewListener } from './useWebviewListener';

const openGUITypes: any[] = ['highlightedCode', 'focusKODRAInput', 'focusKODRAInputWithoutClear', 'newSession'];

// Subscribes to GUI navigation messages, routes back to home, and re-dispatches input focus events.
export const useNavigationListener = () => {
  const navigate = useNavigate();
  for (const messageType of openGUITypes) {
    useWebviewListener(
      messageType,
      async (data: any) => {
        navigate('/');
        setTimeout(() => {
          window.postMessage({ messageType, data, messageId: uuidv4() }, '*');
        }, 200);
      },
      [navigate]
    );
  }
};
