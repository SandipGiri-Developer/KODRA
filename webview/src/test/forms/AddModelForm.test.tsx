import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AddModelForm } from '../../forms/AddModelForm';

// Mock vscode API
const mockPostMessage = vi.fn();
(window as any).vscode = {
  postMessage: mockPostMessage
};

class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
window.ResizeObserver = ResizeObserver;

describe('AddModelForm', () => {
  const onDoneMock = vi.fn();

  beforeEach(() => {
    mockPostMessage.mockClear();
    onDoneMock.mockClear();
  });

  const renderComponent = () => {
    return render(
      <AddModelForm onDone={onDoneMock} />
    );
  };

  it('renders default provider (OpenAI) and API key input', () => {
    renderComponent();
    expect(screen.getByText('Configure AI Provider')).toBeDefined();
    
    const providerSelect = screen.getByRole('combobox') as HTMLSelectElement;
    expect(providerSelect.value).toBe('openai');
    
    expect(screen.getByPlaceholderText('Enter your OpenAI API key')).toBeDefined();
  });

  it('hides API key input for Ollama', async () => {
    renderComponent();
    
    const providerSelect = screen.getByRole('combobox');
    fireEvent.change(providerSelect, { target: { value: 'ollama' } });
    
    expect(screen.queryByPlaceholderText(/API key/)).toBeNull();
  });

  it('submits correctly for Ollama (no api key)', async () => {
    renderComponent();
    
    const providerSelect = screen.getByRole('combobox');
    fireEvent.change(providerSelect, { target: { value: 'ollama' } });
    
    const connectButton = screen.getByRole('button', { name: 'Connect' });
    fireEvent.click(connectButton);

    expect(mockPostMessage).toHaveBeenCalledWith({
      type: 'setProvider',
      provider: 'ollama'
    });

    expect(onDoneMock).toHaveBeenCalled();

    // Verify discoverModels is called after timeout
    await waitFor(() => {
      expect(mockPostMessage).toHaveBeenCalledWith({
        type: 'discoverModels',
        provider: 'ollama'
      });
    }, { timeout: 1000 });
  });

  it('submits correctly for API-based provider', async () => {
    renderComponent();
    
    const providerSelect = screen.getByRole('combobox');
    fireEvent.change(providerSelect, { target: { value: 'anthropic' } });
    
    const apiKeyInput = screen.getByPlaceholderText('Enter your Anthropic Claude API key');
    fireEvent.change(apiKeyInput, { target: { value: 'sk-test-key' } });
    
    const connectButton = screen.getByRole('button', { name: 'Connect' });
    fireEvent.click(connectButton);

    expect(mockPostMessage).toHaveBeenCalledWith({
      type: 'setProvider',
      provider: 'anthropic'
    });

    expect(mockPostMessage).toHaveBeenCalledWith({
      type: 'setApiKey',
      provider: 'anthropic',
      key: 'sk-test-key'
    });

    expect(onDoneMock).toHaveBeenCalled();

    await waitFor(() => {
      expect(mockPostMessage).toHaveBeenCalledWith({
        type: 'discoverModels',
        provider: 'anthropic'
      });
    }, { timeout: 1000 });
  });
});
