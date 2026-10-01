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
  FileType: {
    Unknown: 0,
    File: 1,
    Directory: 2,
    SymbolicLink: 64,
  },
  workspace: {
    getConfiguration: jest.fn(() => ({
      get: jest.fn(),
      update: jest.fn(),
    })),
    onDidChangeConfiguration: jest.fn(() => ({ dispose: jest.fn() })),
    workspaceFolders: [],
    fs: {
      stat: jest.fn(async (uri) => {
        const fsPromises = require('fs/promises');
        try {
          const st = await fsPromises.stat(uri.fsPath);
          return {
            type: st.isDirectory() ? 2 : 1,
            ctime: st.ctimeMs,
            mtime: st.mtimeMs,
            size: st.size,
          };
        } catch (err) {
          const notFoundErr = new Error(`FileNotFound: ${uri.fsPath}`);
          notFoundErr.code = 'FileNotFound';
          throw notFoundErr;
        }
      }),
      readFile: jest.fn(async (uri) => {
        const fsPromises = require('fs/promises');
        return await fsPromises.readFile(uri.fsPath);
      }),
      writeFile: jest.fn(async (uri, content) => {
        const fsPromises = require('fs/promises');
        return await fsPromises.writeFile(uri.fsPath, content);
      }),
      delete: jest.fn(async (uri, options) => {
        const fsPromises = require('fs/promises');
        return await fsPromises.rm(uri.fsPath, { recursive: options?.recursive, force: true });
      }),
      readDirectory: jest.fn(async (uri) => {
        const fsPromises = require('fs/promises');
        const entries = await fsPromises.readdir(uri.fsPath, { withFileTypes: true });
        return entries.map((e) => [e.name, e.isDirectory() ? 2 : 1]);
      }),
    },
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
