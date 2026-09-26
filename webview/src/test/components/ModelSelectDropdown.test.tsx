import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ModelSelectDropdown } from '../../components/mainInput/ModelSelectDropdown';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import uiReducer from '../../redux/slices/uiSlice';
import React from 'react';

const mockPostMessage = vi.fn();
(window as any).vscode = {
  postMessage: mockPostMessage
};

// Mock ResizeObserver for jsdom
class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
window.ResizeObserver = ResizeObserver as any;

describe('ModelSelectDropdown', () => {
  let store: any;

  beforeEach(() => {
    mockPostMessage.mockClear();
    store = configureStore({
      reducer: {
        ui: uiReducer,
      },
    });
  });

  const renderComponent = () => {
    return render(
      <Provider store={store}>
        <ModelSelectDropdown />
      </Provider>
    );
  };

  it('renders default unselected state', () => {
    renderComponent();
    expect(screen.getByText('Select model')).toBeDefined();
  });

  it('syncs workspaceModels from settingsData message', async () => {
    renderComponent();

    window.dispatchEvent(new MessageEvent('message', {
      data: {
        type: 'settingsData',
        workspaceModels: [
          {
            id: 'gpt-4o',
            displayName: 'GPT-4o',
            provider: 'openai',
            providerConfigId: 'openai-1',
            capabilities: { toolCalling: true, vision: true }
          },
          {
            id: 'claude-3-opus',
            displayName: 'Claude 3 Opus',
            provider: 'anthropic',
            providerConfigId: 'anthropic-1',
            capabilities: { toolCalling: true, vision: true }
          }
        ]
      }
    }));

    fireEvent.click(screen.getByText('Select model'));
    
    await waitFor(() => {
      expect(screen.getByText('GPT-4o')).toBeDefined();
      expect(screen.getByText('Claude 3 Opus')).toBeDefined();
    });
  });

  it('filters out non-workspace models', async () => {
    // Dropdown only gets workspaceModels array, unselected models are not passed to it.
    renderComponent();

    window.dispatchEvent(new MessageEvent('message', {
      data: {
        type: 'settingsData',
        workspaceModels: [
          {
            id: 'llama3:latest',
            displayName: 'Llama 3',
            provider: 'ollama',
            providerConfigId: 'ollama-1',
            capabilities: { toolCalling: true, vision: false }
          }
        ]
      }
    }));

    fireEvent.click(screen.getByText('Select model'));
    
    await waitFor(() => {
      expect(screen.queryByText('nomic-embed-text')).toBeNull(); // Shouldn't exist
      expect(screen.getByText('Llama 3')).toBeDefined();
    });
  });

  it('selects model and triggers backend message', async () => {
    renderComponent();

    window.dispatchEvent(new MessageEvent('message', {
      data: {
        type: 'settingsData',
        workspaceModels: [
          {
            id: 'gpt-4o',
            displayName: 'GPT-4o',
            provider: 'openai',
            providerConfigId: 'openai-1',
            capabilities: { toolCalling: true, vision: true }
          }
        ]
      }
    }));

    fireEvent.click(screen.getByText('Select model'));
    await waitFor(() => expect(screen.getByText('GPT-4o')).toBeDefined());

    fireEvent.click(screen.getAllByText('GPT-4o')[0]); // Option item

    expect(mockPostMessage).toHaveBeenCalledWith({ type: 'setModel', model: 'gpt-4o' });
  });

  it('clicking Configure Models opens settings', async () => {
    renderComponent();
    fireEvent.click(screen.getByText('Select model'));
    
    const addModelButton = screen.getByText('Configure Models...');
    fireEvent.click(addModelButton);

    expect(mockPostMessage).toHaveBeenCalledWith({
      type: 'executeCommand',
      command: 'arc1610.openSettings'
    });
  });
});
