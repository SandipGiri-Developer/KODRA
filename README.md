# Kodra

Kodra is an open-source VS Code coding assistant built natively in TypeScript. It provides a chat interface, semantic codebase indexing, and agentic file editing, running entirely within the VS Code Extension Host.

It supports fully offline workflows using local models via Ollama, as well as cloud providers like OpenAI and Anthropic.

## Features

- **Semantic Codebase Indexing**: Indexes your workspace locally using a pure-TypeScript vector database. It supports incremental updates (only re-indexing changed files) and enforces `.gitignore` and security exclusion rules to prevent indexing secrets.
- **Local & Cloud Provider Support**: 
  - **Ollama**: Free, local, and private code generation and vector embeddings (`nomic-embed-text`).
  - **OpenAI & Anthropic**: Connect your API keys. Keys are stored securely in VS Code's native `SecretStorage` and are never exposed in the webview.
- **Agentic File Editing**: The assistant can read, search, create, and edit files in your workspace. 
- **Safe Modifications**: Destructive actions (creating or editing files) generate a unified diff preview. The extension will not modify your files until you click "Approve" in the UI.
- **Native UI**: The chat interface is built with React and Vite, using VS Code's native CSS variables to seamlessly match your current editor theme.

## Installation

### From Source
1. Clone the repository: `git clone https://github.com/SandipGiri-Developer/Kodra-VSextension.git`
2. Open the project in VS Code.
3. Install dependencies: `npm install`
4. Build the webview: `npm run build:webview`
5. Press `F5` to launch the Extension Development Host.

### VSIX Release (Coming Soon)
Pre-packaged `.vsix` releases will be available in the GitHub Releases tab. You can install them by running `code --install-extension KODRA-0.1.0.vsix` or using the "Install from VSIX..." option in the VS Code Extensions pane.

## Configuration

Access settings via **File > Preferences > Settings** and search for `Kodra`:

- `KODRA.provider`: Choose between `ollama`, `openai`, or `anthropic`.
- `KODRA.modelName`: Specify the model (e.g., `llama3.2`, `gpt-4o`, `claude-3-5-sonnet-20240620`).
- `KODRA.ollama.endpoint`: Your local Ollama server address (default: `http://127.0.0.1:11434`).
- `KODRA.indexing.enabled`: Toggle automatic workspace indexing.
- `KODRA.agent.requireApproval`: Toggle the approval requirement for file modifications.

To configure API keys, open the command palette (`Ctrl+Shift+P`) and run **"Kodra: Configure AI Provider"**.

## Architecture

Kodra is a monolithic VS Code extension. It does not rely on external backend servers or Python binaries.

- **`src/agent/`**: Contains the main Agent Loop and tools (`read_file`, `edit_file`, etc.).
- **`src/indexing/`**: Implements the DFS workspace traversal, document chunking, and the local JSON-based vector store.
- **`src/providers/`**: Handles streaming communication and tool-calling schemas for Ollama, OpenAI, and Anthropic APIs.
- **`webview/`**: The React/Vite frontend. It communicates with the extension host exclusively via strongly-typed postMessage events.

## Development & Testing

The project uses `jest` for backend testing and `eslint` for linting.

```bash
# Run tests
npm test

# Run linter
npm run lint

# Compile extension
npm run compile
```

# KODRA
