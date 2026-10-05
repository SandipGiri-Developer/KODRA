# Kodra

Kodra is an AI coding assistant extension for VS Code. It runs inside the editor to answer questions about your project, retrieve relevant files using local embeddings, and inspect or edit code through an agent tool loop.

## Features

Chat directly inside VS Code with context from your open files, active selections, or the whole project.

Search code with local semantic indexing. Kodra chunks workspace files and creates embeddings using an in-process model or Ollama, with file ignores and secret exclusions applied.

Support for local and cloud models. Use Ollama for private offline work, or connect OpenAI, Anthropic, or Google Gemini.

Agent tools for reading and writing files. The model can inspect directory trees, search code, read files, and propose edits with diff previews that require approval before saving.

## Getting Started

### Prerequisites

Node.js 18 or later and VS Code 1.85 or later.

If you plan to run models locally, install and start Ollama.

### Installation from Source

Clone the repository and install dependencies:

```bash
git clone https://github.com/SandipGiri-Developer/KODRA.git
cd KODRA
npm install
cd webview && npm install && cd ..
```

Build the webview and compile the extension:

```bash
npm run build:webview
npm run compile
```

Open the project folder in VS Code and press `F5` to start a new Extension Development Host window.

Open the chat panel using the sidebar icon or press `Ctrl+L` (`Cmd+L` on macOS).

## Configuration

Open VS Code settings (`Ctrl+,` or `Cmd+,`) and search for `KODRA`.

You can set your default provider, model, and indexing preferences:

`KODRA.provider`: Select `ollama`, `openai`, `anthropic`, or `gemini`.

`KODRA.modelName`: Specify the model you want to run (such as `llama3.2`, `gpt-4o-mini`, or `claude-3-5-sonnet-20241022`).

`KODRA.ollama.endpoint`: Set your local Ollama address if different from `http://127.0.0.1:11434`.

`KODRA.agent.requireApproval`: Ask for manual approval before applying file modifications (enabled by default).

To save API keys for cloud providers, open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) and run `Kodra: Configure AI Provider`. Keys are stored in VS Code SecretStorage.

## Development

Run tests:

```bash
npm test
```

Run linter:

```bash
npm run lint
```

Build production package:

```bash
npm run package
```

Package a VSIX installer:

```bash
npm run package:vsix
```

## License

MIT
