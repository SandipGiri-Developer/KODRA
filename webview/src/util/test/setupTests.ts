// Global test environment setup for Vitest, suppressing non-critical ProseMirror DOM measurement rejections.
window.addEventListener("unhandledrejection", (event) => {
  if (
    event.reason?.message?.includes("getClientRects") ||
    event.reason?.message?.includes("prosemirror")
  ) {
    event.preventDefault(); // Suppress ProseMirror DOM errors in test environment
  }
});
