# ⚡ Kodra 

**An intelligent, agentic AI coding assistant for Visual Studio Code.**

Kodra lives directly inside your editor and supercharges your development workflow. Whether you want to ask questions about your architecture, retrieve relevant context using semantic search, or have an autonomous agent inspect and write code for you, Kodra handles it seamlessly. 

---

## ✨ Features

- **💬 Context-Aware Conversations:** Chat with your AI assistant using deep context from your open files, current selections, and entire workspace.
- **🛠️ Agentic Tool Loop:** Kodra isn't just a chatbot—it's an agent. It can autonomously read your files, inspect directory structures, perform semantic searches, and propose targeted code edits.
- **🛡️ Safe Code Edits:** All proposed code modifications are presented in a clean side-by-side diff preview. Nothing is saved until you manually approve the changes.
- **🔍 Local Semantic Indexing:** Kodra chunks and indexes your workspace files using local embeddings (via an in-process model or Ollama). It automatically respects your `.gitignore` and excludes sensitive secrets.
- **🌐 Bring Your Own Model (BYOM):** Connect to the best models in the world or run entirely offline for maximum privacy. Supported providers include:
  - **Ollama** (Private, offline, local)
  - **OpenAI**
  - **Anthropic**
  - **Google Gemini**
  - **Groq** (Blazing fast inference)
- **🎨 Beautiful Settings UI:** Easily configure multiple AI providers, discover supported models dynamically via APIs, and toggle capabilities directly from the custom settings interface.

## 🚀 Getting Started

### Prerequisites

- **Node.js** v18 or later
- **VS Code** v1.85 or later
- *(Optional)* **Ollama** installed and running (if you plan to use local offline models).

### Installation from Source

1. Clone the repository and install the core dependencies:

```bash
git clone https://github.com/SandipGiri-Developer/KODRA.git
cd KODRA
npm install
```

2. Install dependencies for the webview UI:

```bash
cd webview 
npm install 
cd ..
```

3. Build the webview and compile the extension:

```bash
npm run build:webview
npm run compile
```

4. Press `F5` in VS Code to launch a new **Extension Development Host** window.
5. Open the Kodra chat panel using the sidebar icon or press `Ctrl+L` (`Cmd+L` on macOS).

## ⚙️ Configuration

Kodra is highly customizable. You can configure your setup either through the native Kodra UI or via VS Code's built-in settings (`Ctrl+,` or `Cmd+,` and search for `KODRA`).

### Provider Setup
To set up API keys for cloud providers like **OpenAI, Anthropic, Gemini, or Groq**, open the VS Code Command Palette (`Ctrl+Shift+P` or `Cmd+Shift+P`) and run:
👉 **`Kodra: Configure AI Provider`**

*Your API keys are stored securely using VS Code's native encrypted `SecretStorage`.*

### Important Settings

- `KODRA.provider`: Set your default active provider (`ollama`, `openai`, `anthropic`, `gemini`, or `groq`).
- `KODRA.modelName`: Specify your preferred model (e.g., `llama3.2`, `claude-3-5-sonnet-20241022`, `llama3-70b-8192`).
- `KODRA.ollama.endpoint`: Override your local Ollama address if it differs from the default `http://127.0.0.1:11434`.
- `KODRA.agent.requireApproval`: Ask for manual approval before applying any file modifications (Enabled by default for safety).

## 🛠️ Development

Kodra is built with TypeScript, React, and the VS Code Extension API. 

**Run unit tests:**
```bash
npm test
```

**Run the linter:**
```bash
npm run lint
```

**Build production package:**
```bash
npm run package
```

**Package into a VSIX installer:**
```bash
npm run package:vsix
```

## 📄 License

This project is licensed under the MIT License.
