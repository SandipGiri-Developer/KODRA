import react from "@vitejs/plugin-react-swc";
import { resolve } from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  base: "./",
  plugins: [react()],
  resolve: {
    alias: {
      "@lobehub/icons": resolve(__dirname, "src/components/svg/ProviderLogos.tsx"),
    },
  },
  build: {
    sourcemap: false,
    minify: "esbuild",
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      input: {
        index: resolve(__dirname, "index.html"),
      },
      output: {
        entryFileNames: `assets/[name].js`,
        chunkFileNames: `assets/[name].js`,
        assetFileNames: `assets/[name].[ext]`,
        manualChunks: (id) => {
          if (id.includes("node_modules/highlight.js") || id.includes("node_modules/lowlight")) {
            return "syntax-highlighter";
          }
          if (id.includes("node_modules/@tiptap") || id.includes("node_modules/prosemirror")) {
            return "editor-vendor";
          }
          if (id.includes("node_modules/react/") || id.includes("node_modules/react-dom/") || id.includes("node_modules/react-router")) {
            return "react-vendor";
          }
          if (id.includes("node_modules/@reduxjs") || id.includes("node_modules/redux")) {
            return "redux-vendor";
          }
        },
      },
    },
  },
  server: {
    cors: {
      origin: "*",
      methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
      allowedHeaders: ["*", "Content-Type", "Authorization"],
      credentials: true,
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: "./src/util/test/setupTests.ts",
    onConsoleLog(log, type) {
      if (type === "stderr") {
        if (
          [
            "contentEditable",
            "An update to Chat inside a test was not wrapped in act",
            "An update to TipTapEditor inside a test was not wrapped in act",
            "An update to ThinkingIndicator inside a test was not wrapped in act",
            "The current testing environment is not configured to support act",
            "target.getClientRects is not a function",
            "prosemirror",
          ].some((text) => log.includes(text))
        ) {
          return false;
        }
      }
      return true;
    },
  },
});
