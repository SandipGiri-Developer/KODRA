# Contributing to Kodra

We're glad you're contributing to Kodra! This guide explains what kinds of contributions we accept, where to ask questions, how to find good first issues, and how to set up your environment, run tests, and open a pull request.

All contributions are accepted under the project's [MIT License](LICENSE). All participants are expected to follow our community standards and [Code of Conduct](#code-of-conduct).

## Table of Contents

- [Ways to Contribute](#ways-to-contribute)
- [Your First Contribution](#your-first-contribution)
- [Asking Questions and Discussing Changes](#asking-questions-and-discussing-changes)
- [Code of Conduct](#code-of-conduct)
- [General Principles](#general-principles)
- [TypeScript & Frontend Style](#typescript--frontend-style)
- [Setup and Dev](#setup-and-dev)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [Running and Debugging Locally](#running-and-debugging-locally)
- [Unit Tests](#unit-tests)
  - [Extension Backend Tests (Jest)](#extension-backend-tests-jest)
  - [Webview GUI Tests (Vitest)](#webview-gui-tests-vitest)
  - [Mocking AI Provider APIs](#mocking-ai-provider-apis)
- [Pull Requests (PR) Guidelines](#pull-requests-pr-guidelines)
  - [Pre-PR Verification Checklist](#pre-pr-verification-checklist)
  - [Visual Evidence for UI Changes](#visual-evidence-for-ui-changes)
  - [Updating Package Dependencies](#updating-package-dependencies)
- [Security & Sensitive Data](#security--sensitive-data)

---

## Ways to Contribute

Contributions of any size are welcome. Common types of contributions include:

- **Bug fixes** — reproducible fixes accompanied by a unit test where practical.
- **AI Providers & Models** — adding or enhancing support for model providers (Ollama, OpenAI, Anthropic, Gemini, Groq, DeepSeek, NVIDIA NIM) via provider registry and standard interfaces.
- **Webview & UI/UX** — improving the chat interface, diff viewer, settings panel, or terminal UI in `webview/` (built with React, Redux Toolkit, and TailwindCSS).
- **Agent Tool Loop & Execution** — improving autonomous tool execution, terminal process management, approval policies, or safe diff applications in `src/agent/`.
- **Local Semantic Indexing** — optimizing embeddings, chunking algorithms, vector indexing, or cache retrieval in `src/indexing/` and `src/storage/`.
- **Documentation & Guides** — documentation fixes, configuration walkthroughs, provider setup guides, and troubleshooting steps in `README.md`.
- **Tests** — expanding unit test coverage across the extension host and webview, hardening edge cases, and eliminating flaky tests.

If you are planning a non-trivial feature or architectural change (e.g., modifying the agent loop protocol, adding a new vector storage engine, or altering security approval gates), please open an issue first to align on the approach before investing time in code.

---

## Your First Contribution

New to the project? Start here:

1. Browse issues labeled [`good first issue`](https://github.com/SandipGiri-Developer/KODRA/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22) — these are scoped to be approachable without deep familiarity with the entire codebase.
2. Comment on the issue to express interest before beginning work so efforts are not duplicated.
3. Review the [General Principles](#general-principles) and follow the [PR Guidelines](#pull-requests-pr-guidelines) below.

**Good starter areas if no labeled issues are open:**
- Documentation clarifications and typos in `README.md`
- Additional unit tests for AI providers or utility modules
- Improving error message clarity and handling edge cases in UI components
- Localized UI styling improvements in `webview/`

---

## Asking Questions and Discussing Changes

| You want to… | Where to go |
|--------------|-------------|
| Ask a "how do I configure provider X?" or usage question | [GitHub Issues](https://github.com/SandipGiri-Developer/KODRA/issues) |
| Propose a non-trivial feature or architectural change | Open a [GitHub Issue](https://github.com/SandipGiri-Developer/KODRA/issues) describing motivation and design first |
| Report a reproducible bug | [GitHub Issues](https://github.com/SandipGiri-Developer/KODRA/issues) with reproduction steps and DevTools console logs |
| Report a security vulnerability | Follow our [Security Guidelines](#security--sensitive-data) (private disclosure) |

Please keep issues focused on actionable bugs, enhancements, and concrete proposals so the backlog remains productive.

---

## Code of Conduct

This project adheres to the [Contributor Covenant](https://www.contributor-covenant.org/version/2/1/code_of_conduct/) Code of Conduct. By participating in issues, pull requests, discussions, or code review, you agree to foster a welcoming, respectful, and harassment-free environment for everyone.

To report unacceptable behavior or violations, please contact the repository maintainers privately.

---

## General Principles

1. **User-Centric & Safe**: Kodra executes agent actions, modifies files, and manages terminals. Always maintain safety boundaries: never bypass approval gates (`ApprovalGate`, `requireApproval`) or execute destructive file writes without explicit user confirmation.
2. **Deterministic & Robust**: While LLM inference is stochastic, the surrounding application code, tool parsing, state machines, and IPC communication must be completely deterministic and robust against network drops or malformed streaming payloads.
3. **Zero Secrets Committed**: Never commit API keys, tokens, or credentials. Always utilize VS Code's encrypted `SecretStorage` (`context.secrets`).
4. **Modular & Reusable**: Keep providers, tools, and UI components decoupled through clean TypeScript interfaces (e.g., `IProvider`, `IEmbeddingProvider`).
5. **Readable & Maintainable**: Write clean, self-explanatory TypeScript. Add explanatory comments only where logic is non-obvious.
6. **Tested & Verified**: Every new feature or bug fix must include automated test coverage. Never remove or weaken tests to pass CI.

---

## TypeScript & Frontend Style

Kodra is split into two major environments: the **Extension Host** (Node.js & TypeScript) and the **Webview GUI** (React, Redux Toolkit, TailwindCSS).

### Coding Standards
- Write modular TypeScript with explicit typing where helpful; avoid `any` wherever possible.
- Use ES modules and standard async/await patterns.
- Follow existing directory structure and naming conventions (`camelCase` for files/functions, `PascalCase` for React components and classes).
- Loggers (`Logger.log`, `Logger.error`) are preferred over bare `console.log`.

### Linters & Type Checking
Verify both workspaces before committing:

```bash
# Check extension backend
npm run lint
npx tsc --noEmit

# Check webview GUI
cd webview
npm run lint
npm run tsc:check
cd ..
```

---

## Setup and Dev

### Prerequisites

- **Node.js**: `>=22.0.0`
- **npm**: v9 or higher
- **VS Code**: `v1.85.0` or later
- *(Optional)* **Ollama**: Installed and running locally (`http://127.0.0.1:11434`) if you intend to test local model workflows.

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/SandipGiri-Developer/KODRA.git
   cd KODRA
   ```

2. Install root dependencies:
   ```bash
   npm install
   ```

3. Install webview dependencies using the `--legacy-peer-deps` flag:
   ```bash
   cd webview
   npm install --legacy-peer-deps
   cd ..
   ```

> **Note**: Due to React 18 and UI library peer dependency requirements in the webview, always pass `--legacy-peer-deps` when running `npm install` inside `webview/`.

### Running and Debugging Locally

1. Build the webview assets and compile the extension backend:
   ```bash
   npm run build:webview
   npm run compile
   ```

2. Press **`F5`** in VS Code to launch a new **Extension Development Host** window with Kodra loaded.
3. Open the Kodra chat interface using the sidebar icon or press `Ctrl+L` (`Cmd+L` on macOS).

#### Active Development Watchers
For live development with incremental rebuilding:

```bash
# Terminal 1: Watch extension backend TypeScript files
npm run watch

# Terminal 2: Watch and serve webview frontend
cd webview && npm run dev
```

---

## Unit Tests

Unit tests must be fast, deterministic, and isolated. Contributors should be able to run tests locally without external dependencies or paid accounts.

### Extension Backend Tests (Jest)

Backend unit tests run using Jest and `ts-jest`:

```bash
# Run all backend unit tests
npm test

# Run tests in watch mode
npm run test:watch
```

### Webview GUI Tests (Vitest)

Webview unit and component tests run using Vitest and React Testing Library:

```bash
cd webview

# Run all webview tests
npm test

# Run tests with coverage report
npm run test:coverage

# Run tests with interactive UI
npm run test:ui
```

### Mocking AI Provider APIs

- **Never make live network calls in unit tests**: All tests interacting with LLM providers (OpenAI, Anthropic, Gemini, Groq, Ollama, etc.) must mock the network layer or provider instance.
- Refer to existing mock fixtures in `__mocks__/` and `src/test/suite/` (e.g., `anthropic.test.ts`, `gemini.test.ts`) for examples of mock streaming responses and tool-call serialization.

---

## Pull Requests (PR) Guidelines

**Send all pull requests to the `main` branch.**

1. **One Focus Per PR**: Ensure your PR addresses a single problem or feature. Have a concise, clear answer to *"What does this PR do?"*.
2. **Branch from `main`**:
   ```bash
   git checkout main
   git pull origin main
   git checkout -b feat/your-feature-name
   ```
   Use descriptive branch prefixes such as `feat/<name>`, `fix/<name>`, or `docs/<name>`.
3. **Commit Conventions**: We prefer Conventional Commits (e.g., `feat: ...`, `fix: ...`, `docs: ...`, `test: ...`, `refactor: ...`, `chore: ...`). While commit messages can be flexible, keeping them clear and descriptive ensures a readable project history.
4. **Issue Linking**: If your PR resolves or relates to an open issue, reference it in the PR description (e.g., `Fixes #123` or `Closes #456`).
5. **No Direct `CHANGELOG.md` Edits**: Maintainers curate and publish `CHANGELOG.md` entries alongside release tags. Contributors do not need to update `CHANGELOG.md` in their PRs.

### Pre-PR Verification Checklist

Before opening your pull request, ensure all validation checks pass cleanly:

```bash
# 1. Run root extension tests and linter
npm test
npm run lint
npx tsc --noEmit

# 2. Run webview tests and linter
cd webview
npm test
npm run lint
npm run tsc:check
cd ..

# 3. Verify clean production build
npm run build:webview
npm run compile
```

### Visual Evidence for UI Changes

If your pull request introduces changes to the Webview GUI, settings panels, terminal indicators, or diff viewers:
- **Attach visual evidence**: Include clear screenshots or short screen recordings (GIF or MP4) in the PR description demonstrating both the new behavior and edge cases.
- Where appropriate, show both before and after captures.

### Updating Package Dependencies

When adding or updating dependencies:
- **Root extension**: Update `package.json` and commit the updated `package-lock.json`.
- **Webview**: Update `webview/package.json` using `npm install --legacy-peer-deps` and commit the updated `webview/package-lock.json`.
- Commit both `package.json` and `package-lock.json` together in a single `chore(deps): ...` commit.

---

## Security & Sensitive Data

Kodra integrates with third-party LLM providers and executes terminal commands on user machines. Security and privacy are paramount.

- **Zero Secrets in Code**: Never commit API keys, personal access tokens, or private endpoints. Kodra securely stores cloud provider credentials via VS Code's native `SecretStorage`.
- **Reporting Security Issues**: If you discover a security vulnerability, **please do not open a public issue**. Instead, report it privately via [GitHub Security Advisories](https://github.com/SandipGiri-Developer/KODRA/security/advisories) or contact the project maintainers directly.
- **Terminal Execution Safety**: All contributions that touch `TerminalExecutionManager`, `ApprovalGate`, or `ApprovalPolicyService` must maintain strict safeguards against unauthorized command injection or policy bypasses.
