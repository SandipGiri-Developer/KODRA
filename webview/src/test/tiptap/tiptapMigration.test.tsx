import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Editor, JSONContent } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import History from "@tiptap/extension-history";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";

import { render, cleanup } from "@testing-library/react";
import React from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import { Mention } from "../../components/mainInput/TipTapEditor/extensions/Mention";
import { SlashCommand } from "../../components/mainInput/TipTapEditor/extensions/SlashCommand";
import { PromptBlock } from "../../components/mainInput/TipTapEditor/extensions/Prompt/PromptBlock";
import { CodeBlock } from "../../components/mainInput/TipTapEditor/extensions/CodeBlock/CodeBlock";
import {
  hasValidEditorContent,
  getPlaceholderText,
} from "../../components/mainInput/TipTapEditor/utils/editorConfig";
import { processEditorContent } from "../../components/mainInput/TipTapEditor/utils/processEditorContent";
import { insertCurrentFileContextMention } from "../../components/mainInput/TipTapEditor/utils/insertCurrentFileContextMention";

describe("TipTap v3 Migration - Comprehensive Compatibility Suite", () => {
  let editor: Editor;

  function createTestEditor(initialContent?: JSONContent | string) {
    return new Editor({
      extensions: [
        Document,
        Paragraph,
        Text,
        History,
        Image.configure({
          HTMLAttributes: {
            class: "test-image",
          },
        }),
        Placeholder.configure({
          placeholder: "Type a prompt...",
        }),
        Mention,
        SlashCommand,
        PromptBlock,
        CodeBlock,
      ],
      content: initialContent,
    });
  }

  afterEach(() => {
    if (editor && !editor.isDestroyed) {
      editor.destroy();
    }
  });

  describe("Rule 1 & 4: TipTap v3 Ecosystem & Initialization", () => {
    it("should initialize TipTap v3 editor without errors", () => {
      editor = createTestEditor();
      expect(editor).toBeDefined();
      expect(editor.isDestroyed).toBe(false);
      expect(editor.schema).toBeDefined();
      expect(editor.schema.nodes["paragraph"]).toBeDefined();
      expect(editor.schema.nodes["text"]).toBeDefined();
      expect(editor.schema.nodes["mention"]).toBeDefined();
      expect(editor.schema.nodes["slash-command"]).toBeDefined();
      expect(editor.schema.nodes["prompt-block"]).toBeDefined();
      expect(editor.schema.nodes["code-block"]).toBeDefined();
      expect(editor.schema.nodes["image"]).toBeDefined();
    });

    it("should handle clean destruction and remounting without memory leaks", () => {
      editor = createTestEditor("First instance");
      expect(editor.getText()).toBe("First instance");
      editor.destroy();
      expect(editor.isDestroyed).toBe(true);

      // Re-create
      editor = createTestEditor("Second instance");
      expect(editor.getText()).toBe("Second instance");
      expect(editor.isDestroyed).toBe(false);
    });
  });

  describe("Rule 7: React Integration (useEditor & EditorContent)", () => {
    it("should mount and unmount EditorContent cleanly without errors", () => {
      const TestComponent = ({ initialText }: { initialText: string }) => {
        const reactEditor = useEditor({
          extensions: [Document, Paragraph, Text],
          content: initialText,
        });

        return (
          <div data-testid="editor-wrapper">
            <EditorContent editor={reactEditor} />
          </div>
        );
      };

      const { container, unmount } = render(<TestComponent initialText="React TipTap v3 test" />);

      const pmElement = container.querySelector(".ProseMirror");
      expect(pmElement).toBeDefined();
      expect(container.textContent).toContain("React TipTap v3 test");

      expect(() => unmount()).not.toThrow();
    });
  });

  describe("Rule 6: Custom Extensions Compatibility in v3", () => {
    it("should support Mention extension node attributes and HTML parsing/rendering", () => {
      editor = createTestEditor();

      editor
        .chain()
        .setContent("<p>Hello <span data-type=\"mention\" data-id=\"file.ts\" data-label=\"file.ts\" data-itemtype=\"file\" data-query=\"path/to/file.ts\">@file.ts</span></p>")
        .run();

      const json = editor.getJSON() as JSONContent;
      const p = json.content?.[0];
      expect(p?.type).toBe("paragraph");

      const mentionNode = p?.content?.find((c) => c.type === "mention");
      expect(mentionNode).toBeDefined();
      expect(mentionNode?.attrs?.id).toBe("file.ts");
      expect(mentionNode?.attrs?.label).toBe("file.ts");
      expect(mentionNode?.attrs?.itemType).toBe("file");
      expect(mentionNode?.attrs?.query).toBe("path/to/file.ts");

      // Verify HTML serialization
      const html = editor.getHTML();
      expect(html).toContain('class="mention"');
      expect(html).toContain("@file.ts");
    });

    it("should support PromptBlock commands: insertPrompt and clearPrompt", () => {
      editor = createTestEditor();

      editor.commands.insertPrompt({
        title: "Code Review",
        description: "Review staged code",
        content: "Please review the following code changes for security and style.",
      });

      const json = editor.getJSON() as JSONContent;
      const promptNode = json.content?.find((c) => c.type === "prompt-block");
      expect(promptNode).toBeDefined();
      expect(promptNode?.attrs?.item?.name).toBe("Code Review");
      expect(promptNode?.attrs?.item?.description).toBe("Review staged code");

      // Clear prompt
      editor.commands.clearPrompt();
      const jsonAfterClear = editor.getJSON() as JSONContent;
      const promptAfterClear = jsonAfterClear.content?.find((c) => c.type === "prompt-block");
      expect(promptAfterClear).toBeUndefined();
    });

    it("should support CodeBlock node attributes and structure", () => {
      editor = createTestEditor();

      const mockCodeItem = {
        name: "index.ts",
        description: "index.ts (1-10)",
        content: "const a = 42;",
        id: { providerTitle: "file", itemId: "file:///index.ts" },
      };

      editor
        .chain()
        .insertContent({
          type: "code-block",
          attrs: {
            item: mockCodeItem,
            inputId: "main-input",
          },
        })
        .run();

      const json = editor.getJSON() as JSONContent;
      const codeNode = json.content?.find((c) => c.type === "code-block");
      expect(codeNode).toBeDefined();
      expect(codeNode?.attrs?.item?.name).toBe("index.ts");
      expect(codeNode?.attrs?.item?.content).toBe("const a = 42;");
      expect(codeNode?.attrs?.inputId).toBe("main-input");
    });
  });

  describe("Rule 11 & 12: Data Integrity, Serialization, and Deserialization", () => {
    it("should preserve legacy v2 JSON format seamlessly in v3", () => {
      const legacyV2Json: JSONContent = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "Explain this function: " },
              {
                type: "mention",
                attrs: {
                  id: "src/utils.ts",
                  label: "utils.ts",
                  itemType: "file",
                  query: "src/utils.ts",
                  renderInlineAs: null,
                },
              },
              { type: "text", text: " and how it works." },
            ],
          },
        ],
      };

      editor = createTestEditor(legacyV2Json);

      const exportedJson = editor.getJSON() as JSONContent;
      expect(exportedJson.type).toBe("doc");
      expect(exportedJson.content?.[0].type).toBe("paragraph");
      expect(exportedJson.content?.[0].content).toHaveLength(3);
      expect(exportedJson.content?.[0].content?.[0].text).toBe("Explain this function: ");
      expect(exportedJson.content?.[0].content?.[1].attrs?.label).toBe("utils.ts");
      expect(exportedJson.content?.[0].content?.[2].text).toBe(" and how it works.");
    });

    it("should roundtrip JSON -> Editor -> JSON without loss or mutation", () => {
      const originalJson: JSONContent = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "Refactor " },
              {
                type: "mention",
                attrs: {
                  id: "Calculator.ts",
                  label: "Calculator.ts",
                  itemType: "contextProvider",
                  query: "calc",
                  renderInlineAs: "Calculator",
                },
              },
              { type: "text", text: " to use TypeScript classes." },
            ],
          },
        ],
      };

      editor = createTestEditor(originalJson);
      const outputJson = editor.getJSON() as JSONContent;

      expect(outputJson).toEqual(originalJson);
    });

    it("should properly process editor content via processEditorContent", () => {
      const state: JSONContent = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "Hello " },
              {
                type: "mention",
                attrs: {
                  id: "docs",
                  label: "React Docs",
                  itemType: "contextProvider",
                  query: "https://react.dev",
                  renderInlineAs: "@docs",
                },
              },
              { type: "text", text: " please summarize." },
            ],
          },
          {
            type: "code-block",
            attrs: {
              item: {
                name: "app.ts",
                description: "app.ts (1-5)",
                content: "export const version = '1.0';",
                id: { providerTitle: "file", itemId: "app.ts" },
              },
              inputId: "main",
            },
          },
          {
            type: "image",
            attrs: {
              src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
            },
          },
        ],
      };

      const result = processEditorContent(state);

      // Verify text parts
      expect(result.parts).toBeDefined();
      expect(result.parts.length).toBeGreaterThanOrEqual(2);

      // Text part contains paragraph + mention inline text
      const firstTextPart = result.parts.find((p) => p.type === "text") as any;
      expect(firstTextPart.text).toContain("Hello @docs please summarize.");

      // Image part
      const imagePart = result.parts.find((p) => p.type === "imageUrl") as any;
      expect(imagePart).toBeDefined();
      expect(imagePart.imageUrl.url).toContain("data:image/png;base64");

      // Context requests
      expect(result.contextRequests).toHaveLength(1);
      expect(result.contextRequests[0].provider).toBe("docs");
      expect(result.contextRequests[0].query).toBe("https://react.dev");
    });
  });

  describe("Rule 13: Editor Behavior & Edge Cases", () => {
    it("hasValidEditorContent should accurately validate content in v3", () => {
      // Empty document
      expect(hasValidEditorContent({ type: "doc", content: [] })).toBe(false);

      // Paragraph with empty text
      expect(
        hasValidEditorContent({
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "   " }] }],
        }),
      ).toBe(false);

      // Paragraph with valid text
      expect(
        hasValidEditorContent({
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "Fix this bug" }] }],
        }),
      ).toBe(true);

      // Only mention node (should be valid)
      expect(
        hasValidEditorContent({
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "mention",
                  attrs: { id: "code", label: "code" },
                },
              ],
            },
          ],
        }),
      ).toBe(true);

      // Only PromptBlock (should be valid)
      expect(
        hasValidEditorContent({
          type: "doc",
          content: [{ type: "prompt-block", attrs: {} }],
        }),
      ).toBe(true);

      // Only CodeBlock (should be valid)
      expect(
        hasValidEditorContent({
          type: "doc",
          content: [{ type: "code-block", attrs: {} }],
        }),
      ).toBe(true);
    });

    it("should handle Unicode, emoji, and special characters cleanly", () => {
      editor = createTestEditor();

      const unicodeText = "🚀 Hello 世界! \u00A9 2026 Kodra & TipTap v3 — testing @#$%^&*()_+~`|}{[]:;?><,./";
      editor.commands.setContent(unicodeText);

      expect(editor.getText()).toBe(unicodeText);
      const json = editor.getJSON() as JSONContent;
      expect(json.content?.[0].content?.[0].text).toBe(unicodeText);
    });

    it("should support undo and redo via History extension", () => {
      editor = createTestEditor("Initial line.");

      editor.commands.focus("end");
      editor.commands.insertContent(" Added text.");
      expect(editor.getText()).toBe("Initial line. Added text.");

      editor.commands.undo();
      expect(editor.getText()).toBe("Initial line.");

      editor.commands.redo();
      expect(editor.getText()).toBe("Initial line. Added text.");
    });

    it("should handle insertCurrentFileContextMention when editor is empty", () => {
      editor = createTestEditor();

      const mockProviders: any[] = [
        {
          title: "currentFile",
          displayTitle: "activeFile.ts",
          description: "Active Editor File",
          type: "file",
        },
      ];

      insertCurrentFileContextMention(editor, mockProviders);

      const json = editor.getJSON() as JSONContent;
      const mention = json.content?.[0]?.content?.find((c) => c.type === "mention");
      expect(mention).toBeDefined();
      expect(mention?.attrs?.label).toBe("activeFile.ts");
      expect(mention?.attrs?.id).toBe("currentFile");
    });

    it("should NOT insert currentFileContextMention if editor already has text", () => {
      editor = createTestEditor("Existing content");

      const mockProviders: any[] = [
        {
          title: "currentFile",
          displayTitle: "activeFile.ts",
          description: "Active Editor File",
          type: "file",
        },
      ];

      insertCurrentFileContextMention(editor, mockProviders);

      const json = editor.getJSON() as JSONContent;
      const mention = json.content?.[0]?.content?.find((c) => c.type === "mention");
      expect(mention).toBeUndefined();
      expect(editor.getText()).toBe("Existing content");
    });

    it("should provide correct placeholder text", () => {
      expect(getPlaceholderText(undefined, 0)).toBe("Ask anything, '@' to add context");
      expect(getPlaceholderText(undefined, 3)).toBe("Ask a follow-up");
      expect(getPlaceholderText("Custom placeholder", 0)).toBe("Custom placeholder");
      expect(getPlaceholderText("Custom placeholder", 5)).toBe("Custom placeholder");
    });

    it("should gracefully recover from malformed or incomplete JSON content", () => {
      // Malformed content: missing required attrs or invalid structure
      const malformedJson: any = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "Safe text" },
              // mention without standard attrs
              { type: "mention", attrs: {} },
            ],
          },
        ],
      };

      editor = createTestEditor(malformedJson);
      expect(editor.getText()).toContain("Safe text");
      const json = editor.getJSON() as JSONContent;
      expect(json.type).toBe("doc");
    });

    it("should handle large documents efficiently without memory or performance degradation", () => {
      editor = createTestEditor();

      const largeParagraphs = Array.from({ length: 200 }, (_, i) => ({
        type: "paragraph",
        content: [
          { type: "text", text: `Line ${i}: The quick brown fox jumps over the lazy dog repeatedly.` },
        ],
      }));

      const largeDoc: JSONContent = {
        type: "doc",
        content: largeParagraphs,
      };

      const start = performance.now();
      editor.commands.setContent(largeDoc);
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(1500); // Must be fast
      expect(editor.getJSON().content).toHaveLength(200);
      expect(editor.getText()).toContain("Line 199:");
    });

    it("should handle image node insertion and attribute preservation", () => {
      editor = createTestEditor();

      const sampleDataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNiAAAABgADNjd8qAAAAABJRU5ErkJggg==";
      editor
        .chain()
        .insertContent({
          type: "image",
          attrs: {
            src: sampleDataUrl,
          },
        })
        .run();

      const json = editor.getJSON() as JSONContent;
      const imageNode = json.content?.find((c) => c.type === "image");
      expect(imageNode).toBeDefined();
      expect(imageNode?.attrs?.src).toBe(sampleDataUrl);

      const processed = processEditorContent(json);
      expect(processed.parts.some((p) => p.type === "imageUrl" && (p as any).imageUrl.url === sampleDataUrl)).toBe(true);
    });

    it("should correctly handle multiple mentions at beginning, middle, and end of text", () => {
      editor = createTestEditor();

      const multiMentionDoc: JSONContent = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "mention",
                attrs: { id: "first.ts", label: "first.ts", itemType: "file" },
              },
              { type: "text", text: " is referenced before " },
              {
                type: "mention",
                attrs: { id: "middle.ts", label: "middle.ts", itemType: "file" },
              },
              { type: "text", text: " and finally " },
              {
                type: "mention",
                attrs: { id: "last.ts", label: "last.ts", itemType: "file" },
              },
            ],
          },
        ],
      };

      editor.commands.setContent(multiMentionDoc);

      const processed = processEditorContent(editor.getJSON());
      expect(processed.contextRequests).toHaveLength(3);
      expect(processed.contextRequests[0].provider).toBe("file");
      expect(processed.contextRequests[1].provider).toBe("file");
      expect(processed.contextRequests[2].provider).toBe("file");
    });
  });
});
