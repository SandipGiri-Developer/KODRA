// Tests for the ModelSelectDropdown component covering model selection, display, and IPC events.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ModelSelectDropdown } from '../../components/mainInput/ModelSelectDropdown';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import uiReducer from '../../redux/slices/uiSlice';
import configReducer from '../../redux/slices/configSlice';
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
        config: configReducer,
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
      command: 'KODRA.openSettings'
    });
  });

  it('correctly selects the specific provider when multiple providers provide the same model ID', async () => {
    renderComponent();

    window.dispatchEvent(new MessageEvent('message', {
      data: {
        type: 'settingsData',
        workspaceModels: [
          {
            id: 'llama-3.1-8b',
            displayName: 'Llama 3.1 8B',
            provider: 'groq',
            providerConfigId: 'groq-1',
            capabilities: { toolCalling: true, vision: false }
          },
          {
            id: 'llama-3.1-8b',
            displayName: 'Llama 3.1 8B',
            provider: 'nvidia',
            providerConfigId: 'nvidia-1',
            capabilities: { toolCalling: true, vision: false }
          }
        ]
      }
    }));

    fireEvent.click(screen.getByText('Select model'));
    await waitFor(() => {
      expect(screen.getByText('(groq)')).toBeDefined();
      expect(screen.getByText('(nvidia)')).toBeDefined();
    });

    // Click on the NVIDIA one
    fireEvent.click(screen.getByText('(nvidia)'));

    // Verify it sent provider: 'nvidia' and providerConfigId: 'nvidia-1' instead of groq
    expect(mockPostMessage).toHaveBeenCalledWith({
      type: 'setProvider',
      provider: 'nvidia',
      providerConfigId: 'nvidia-1',
    });
    expect(mockPostMessage).toHaveBeenCalledWith({
      type: 'setModel',
      model: 'llama-3.1-8b',
    });
  });

  it('filters models when search query is entered', async () => {
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
            id: 'claude-3-5-sonnet',
            displayName: 'Claude 3.5 Sonnet',
            provider: 'anthropic',
            providerConfigId: 'anthropic-1',
            capabilities: { toolCalling: true, vision: true }
          },
          {
            id: 'llama-3.3-70b',
            displayName: 'Llama 3.3 70B',
            provider: 'groq',
            providerConfigId: 'groq-1',
            capabilities: { toolCalling: true, vision: false }
          }
        ]
      }
    }));

    fireEvent.click(screen.getByText('Select model'));
    await waitFor(() => {
      expect(screen.getByText('GPT-4o')).toBeDefined();
      expect(screen.getByText('Claude 3.5 Sonnet')).toBeDefined();
      expect(screen.getByText('Llama 3.3 70B')).toBeDefined();
    });

    const searchInput = screen.getByTestId('model-search-input');
    fireEvent.change(searchInput, { target: { value: 'claude' } });

    await waitFor(() => {
      expect(screen.getByText('Claude 3.5 Sonnet')).toBeDefined();
      expect(screen.queryByText('GPT-4o')).toBeNull();
      expect(screen.queryByText('Llama 3.3 70B')).toBeNull();
      expect(screen.getByText('1 of 3')).toBeDefined();
    });

    // Clear search
    const clearBtn = screen.getByTestId('clear-model-search');
    fireEvent.click(clearBtn);

    await waitFor(() => {
      expect(screen.getByText('GPT-4o')).toBeDefined();
      expect(screen.getByText('Claude 3.5 Sonnet')).toBeDefined();
      expect(screen.getByText('Llama 3.3 70B')).toBeDefined();
    });
  });

  it('shows empty state message when no models match search query', async () => {
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
    await waitFor(() => {
      expect(screen.getByText('GPT-4o')).toBeDefined();
    });

    const searchInput = screen.getByTestId('model-search-input');
    fireEvent.change(searchInput, { target: { value: 'nonexistent-model' } });

    await waitFor(() => {
      expect(screen.getByText('No models found matching "nonexistent-model"')).toBeDefined();
      expect(screen.queryByText('GPT-4o')).toBeNull();
    });
  });

  it('updates config.selectedModelByRole.chat with capabilities when model is selected', async () => {
    renderComponent();

    window.dispatchEvent(new MessageEvent('message', {
      data: {
        type: 'settingsData',
        workspaceModels: [
          {
            id: 'deepseek-r1',
            displayName: 'DeepSeek R1',
            provider: 'deepseek',
            providerConfigId: 'deepseek-1',
            capabilities: { toolCalling: true, vision: false, reasoning: true }
          }
        ]
      }
    }));

    fireEvent.click(screen.getByText('Select model'));
    await waitFor(() => expect(screen.getByText('DeepSeek R1')).toBeDefined());

    fireEvent.click(screen.getAllByText('DeepSeek R1')[0]);

    const state = store.getState();
    const chatModel = state.config.config.selectedModelByRole.chat;
    expect(chatModel).toBeDefined();
    expect(chatModel?.title).toBe('DeepSeek R1');
    expect(chatModel?.capabilities?.reasoning).toBe(true);
    expect(chatModel?.capabilities?.toolCalling).toBe(true);
  });
});

