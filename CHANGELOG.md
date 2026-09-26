# Change Log

All notable changes to the "KODRA" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [0.1.2] - 2026-09-27

### Dedicated Settings Tab & State Persistence
- **Standalone Settings Tab**: Opening Settings now launches as a dedicated VS Code editor tab rather than replacing the chat sidebar. Chat state, conversation history, and active inputs remain untouched while configuring the extension.
- **Bi-Directional State Sync**: Provider and model changes made in Settings immediately synchronize back to the chat toolbar without requiring a window reload.

### AI Providers & Dynamic Model Discovery
- **Multi-Provider Architecture**: Added support for Ollama, OpenAI, Anthropic, and Google Gemini with endpoint customization.
- **Dynamic Auto-Detection**: One-click model discovery automatically connects to provider endpoints and retrieves available models with capability tags (tool calling, vision, reasoning).
- **Workspace Model Filtering**: Select and persist exact model subsets to expose in the workspace model dropdown.
- **Secure Key Storage**: Provider API keys are securely stored via VS Code's native SecretStorage API and never saved to plaintext settings.

### UI & Visual Identity
- **Official AI Provider Logos**: Replaced letter initials with official vector logos for Ollama, OpenAI, Anthropic, and Google Gemini (`Gemini.Color`) across Settings cards, Add Provider forms, and model dropdowns.
- **Kodra Design System**: Standardized styling across Settings, AI Providers, and chat controls with Kodra brand colors (obsidian `#0C0E14` canvas, `#1E2333` card borders, and electric indigo `#6366F1` accents).
- **Unified Mode Dropdown**: Aligned Agent, Plan, and Chat mode selector styling with the model dropdown, bound directly to active session state.

### Bug Fixes & Ergonomics
- **Workspace Model Visibility**: Fixed issue where configured workspace models failed to populate in the chat toolbar dropdown.
- **Keyboard Shortcuts**: Added `Ctrl+K` (and `Cmd+K`) to open Kodra Chat, maintaining `Ctrl+L` fallback and ensuring the sidebar view container is revealed and focused reliably.

## [0.1.1] - 2026-09-26

###  UI & Aesthetics (Big Changes)
- **New ARC Logo & Chat Empty State**: Completely replaced the generic "Starting a new chat..." text with the new 56x56 ARC logo centered in the chat body. 
- **Dynamic Logo Fade**: Implemented an interaction where the ARC logo becomes invisible the moment the first message is sent, seamlessly transitioning into the normal conversation.
- **Redesigned Stop Button**: Overhauled the "Stop generating" button with a highly professional, modern UI. It now features a transparent, blurry outer circle with a soft red square inside, enhanced by micro-interaction glow effects on hover.
- **Removed Emojis**: Scoured and removed non-professional emojis across the UI to ensure KODRA looks and feels like premium developer tooling.
- **Layout Fixes**: Fixed chat container overflow issues (added `shrink-0`) so the UI behaves smoothly and no longer gets squished.

###  Bugs & Errors Resolved
- **Extension Host Crash Loop**: Fixed the "Extension host did not start in 10 seconds" freezing bug. The issue was traced to uncaught exceptions from third-party extensions breaking the VS Code debugger initialization in the Extension Development Host.
- **VS Code Tasks Compilation Fix**: Corrected `.vscode/tasks.json` `problemMatcher` `endsPattern` so the VS Code debugger actually launches immediately when Webpack finishes compiling instead of hanging.
- **Webpack Build Configuration**: Updated `libraryTarget` from `commonjs2` to `commonjs` so VS Code correctly recognizes the extension's `activate` exports, preventing "activate is not exported" module errors.
- **Git Tracking Fixes**: Correctly configured `.gitignore` and `.vscodeignore` to permanently exclude local configs, build artifacts (`webview/dist`), `.arc1610`, `.continue` files, and the isolated testing environment.
- **Webview Build Pipeline**: Fixed the pipeline issue to correctly compile Vite webview assets into `dist/assets` before the extension launches.

###  Features Added
- **Isolated Testing Environment**: Created a dedicated `Testing-enviroment` workspace. Configured `.vscode/launch.json` to automatically open this specific folder whenever hitting F5, ensuring that testing extension capabilities doesn't pollute the main codebase.
- **Architectural RAG Research**: Conducted an in-depth architectural analysis of the local Continue codebase, fully documenting the entire Retrieval-Augmented Generation (RAG), indexing, embedding, chunking, and vector storage flow into `continue_rag_architecture.md`.

## [0.1.0] - 2026-09-20

- Initial release