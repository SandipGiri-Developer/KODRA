# KODRA Webview GUI

The frontend interface for **KODRA**, an intelligent AI coding assistant and agentic development environment built for Visual Studio Code. This package contains the single-page React application that runs inside VS Code's webview panels and sidebars.

---

## Overview

The KODRA Webview provides the developer-facing interactive workspace for chatting, tracking agent actions, inspecting code modifications, and configuring AI providers. It communicates seamlessly with the extension host via bidirectional message passing (IPC).

### Key Features

- **Agent Activity & Execution Tracking (`AgentActivityPanel`)**
  - Live step-by-step visualization of autonomous agent reasoning and tool executions.
  - Human-readable elapsed duration timer (`Working for 42s`, `1m 23s`, `7m 19s`, `1h 1m 1s`).
  - Guaranteed terminal lifecycle handling (completed, failed, cancelled) with clean timer and interval teardown.
- **Interactive Streaming Chat**
  - Real-time token streaming with automatic syntax-highlighted code blocks.
  - Collapsible `<think>` reasoning introspection blocks with duration tracking.
  - Interactive Mermaid diagram rendering and responsive Markdown formatting.
- **Human-in-the-Loop Tool Approvals**
  - Explicit confirmation dialogs for sensitive or destructive actions (file edits, terminal execution).
  - Integrated syntax-highlighted code and patch diff viewers.
- **Model & AI Provider Selector**
  - Integrated provider switcher supporting Ollama (local), OpenAI, Anthropic, Google Gemini, Groq, DeepSeek, and Nvidia.
  - Official high-resolution vector brand icons powered by `@lobehub/icons`.
  - Dynamic local and remote model discovery.
- **Rich Editor Input (`TipTapEditor`)**
  - TipTap-powered composer supporting multi-line editing, undo/redo history, and keyboard shortcuts.
  - `@` mention autocompletion for files, directories, code selections, and workspace symbols.
- **Session & Conversation History**
  - Multi-session chat management with instant switching, search, and deletion.
  - Backed by KODRA's persistent storage engine across extension reloads.

---

## Tech Stack

| Domain | Technology |
|---|---|
| **Framework** | [React 18](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/) |
| **Bundler** | [Vite 6](https://vitejs.dev/) |
| **State Management** | [Redux Toolkit](https://redux-toolkit.js.org/) + [React-Redux](https://react-redux.js.org/) |
| **Rich Text Editor** | [TipTap](https://tiptap.dev/) (`@tiptap/core`, `@tiptap/react`, `@tiptap/starter-kit`) |
| **Styling** | [Tailwind CSS](https://tailwindcss.com/) + Styled Components + VS Code theme CSS variables |
| **Icons** | [@lobehub/icons](https://github.com/lobehub/lobe-icons), [@heroicons/react](https://heroicons.com/) |
| **Diagrams & Syntax** | [Mermaid](https://mermaid.js.org/), [Lowlight](https://github.com/wooorm/lowlight), [React Markdown](https://github.com/remarkjs/react-markdown) |
| **Testing** | [Vitest](https://vitest.dev/) + React Testing Library |

---

## Architecture & Communication

```mermaid
graph TD
    A[VS Code Extension Host] <-->|window.postMessage / onDidReceiveMessage| B[IdeMessenger Context]
    B <--> C[Redux Store (sessionSlice, uiSlice, indexingSlice)]
    C --> D[Chat Interface (Chat.tsx)]
    D --> E[AgentActivityPanel]
    D --> F[TipTap Input & Mention System]
    D --> G[History & Session Views]
```

- **Extension Bridge:** `src/context/IdeMessenger.tsx` wraps the VS Code Webview API (`acquireVsCodeApi()`).
- **Activity Pipeline:** Redux slices maintain `agentActivities`, tracking life-cycle states (`started`, `tool_call`, `tool_result`, `completed`, `failed`, `cancelled`).
- **Timing Reliability:** Durations are derived from authoritative timestamps and formatted via `src/util/time.ts` (`formatDuration`), eliminating timer desynchronization.

---

## Directory Structure

```text
webview/
├── src/
│   ├── components/            # Reusable UI components
│   │   ├── gui/               # AgentActivityPanel, Tooltips, TimelineItems
│   │   ├── mainInput/         # KODRAInputBox, ModelSelectDropdown, TipTapEditor
│   │   ├── StepContainer/     # Thinking indicators, action buttons
│   │   ├── History/           # Conversation history tables & management
│   │   ├── dialogs/           # Permission confirmations & modal dialogs
│   │   └── ui/                # Core primitives (Listbox, Divider, Buttons)
│   ├── context/               # IdeMessenger and extension IPC contexts
│   ├── pages/                 # Full views (Chat, Settings, History, AddModel)
│   ├── redux/                 # Slices, hooks, store, and selectors
│   │   ├── slices/            # sessionSlice, uiSlice, indexingSlice
│   │   └── store.ts           # Root Redux store configuration
│   ├── styles/                # Global CSS, theme variables, Tailwind setup
│   ├── util/                  # Duration formatters, diff helpers, localStorage
│   └── test/                  # Vitest unit and regression test suites
├── public/                    # Webview static assets and fonts
├── vite.config.ts             # Vite build and bundle configuration
├── tsconfig.json              # TypeScript compilation configuration
└── package.json               # Dependencies and scripts
```

---

## Scripts & Development

Navigate to the `webview` directory:

```bash
cd webview
```

### Install Dependencies
```bash
npm install
```

### Development Server
Run Vite in standalone development mode:
```bash
npm run dev
```

### Production Build
Type-checks with `tsc` and compiles optimized bundles into `webview/dist/`:
```bash
npm run build
```

*Note: In the root extension project, `npm run build:webview` automatically executes this build step.*

### Run Tests
Execute unit and component regression tests via Vitest:
```bash
npm test
```

### Type Checking & Linting
```bash
npm run tsc:check
npm run lint
```
