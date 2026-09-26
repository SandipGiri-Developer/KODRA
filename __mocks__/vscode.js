const MockEventEmitter = class {
  constructor() {
    this.listeners = [];
    this.event = jest.fn((listener) => {
      this.listeners.push(listener);
      return {
        dispose: jest.fn(() => {
          const idx = this.listeners.indexOf(listener);
          if (idx >= 0) this.listeners.splice(idx, 1);
        })
      };
    });
  }
  fire(data) {
    for (const l of [...this.listeners]) {
      l(data);
    }
  }
  dispose() {
    this.listeners = [];
  }
};

const createMockWebviewPanel = (viewType, title, showOptions, options) => {
  const messageListeners = [];
  const disposeListeners = [];
  const panel = {
    viewType,
    title,
    iconPath: undefined,
    visible: true,
    webview: {
      html: '',
      options: options || {},
      cspSource: 'https://*.vscode-cdn.net',
      asWebviewUri: jest.fn((uri) => uri),
      postMessage: jest.fn(),
      onDidReceiveMessage: jest.fn((listener, thisArgs, disposables) => {
        messageListeners.push(listener);
        const disp = {
          dispose: jest.fn(() => {
            const idx = messageListeners.indexOf(listener);
            if (idx >= 0) messageListeners.splice(idx, 1);
          })
        };
        if (disposables) disposables.push(disp);
        return disp;
      }),
      _triggerMessage: async (data) => {
        for (const l of [...messageListeners]) {
          await l(data);
        }
      }
    },
    reveal: jest.fn(),
    dispose: jest.fn(() => {
      if (panel._isDisposed) return;
      panel._isDisposed = true;
      const listeners = [...disposeListeners];
      disposeListeners.length = 0;
      for (const l of listeners) {
        l();
      }
    }),
    onDidDispose: jest.fn((listener, thisArgs, disposables) => {
      disposeListeners.push(listener);
      const disp = {
        dispose: jest.fn(() => {
          const idx = disposeListeners.indexOf(listener);
          if (idx >= 0) disposeListeners.splice(idx, 1);
        })
      };
      if (disposables) disposables.push(disp);
      return disp;
    }),
  };
  return panel;
};

module.exports = {
  window: {
    createOutputChannel: jest.fn(() => ({
      appendLine: jest.fn(),
      clear: jest.fn(),
      show: jest.fn(),
      dispose: jest.fn(),
    })),
    showInformationMessage: jest.fn(),
    showErrorMessage: jest.fn(),
    createWebviewPanel: jest.fn(createMockWebviewPanel),
    registerWebviewViewProvider: jest.fn(() => ({ dispose: jest.fn() })),
    registerWebviewPanelSerializer: jest.fn(() => ({ dispose: jest.fn() })),
    activeTextEditor: undefined,
  },
  commands: {
    registerCommand: jest.fn((command, callback) => ({
      dispose: jest.fn(),
      callback
    })),
    executeCommand: jest.fn(),
  },
  workspace: {
    getConfiguration: jest.fn(() => ({
      get: jest.fn(),
      update: jest.fn(),
    })),
    onDidChangeConfiguration: jest.fn(() => ({ dispose: jest.fn() })),
    workspaceFolders: [],
  },
  EventEmitter: MockEventEmitter,
  Uri: {
    file: jest.fn((path) => ({ fsPath: path, path })),
    joinPath: jest.fn((base, ...segments) => {
      const basePath = base.fsPath || base.path || '';
      const joined = [basePath, ...segments].join('/');
      return { fsPath: joined, path: joined };
    }),
  },
  ViewColumn: {
    Active: -1,
    Beside: -2,
    One: 1,
    Two: 2,
    Three: 3
  },
  ConfigurationTarget: {
    Global: 1,
    Workspace: 2,
    WorkspaceFolder: 3
  }
};
