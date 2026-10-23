// Main GUI layout combining conversation history sidebar and active chat interface.
import { History } from "../../components/History";
import { Chat } from "./Chat";

// Main view rendering responsive conversation history sidebar and active chat panel.
export default function GUI() {
  return (
    <div className="flex min-h-0 w-screen flex-row overflow-x-hidden">
      {/* History sidebar: Displays previous sessions for quick resume on ultra-wide viewports */}
      <aside className="4xl:flex border-vsc-input-border no-scrollbar hidden min-h-0 w-96 overflow-y-auto border-0 border-r border-solid">
        <History />
      </aside>
      {/* Active chat pane: Hosts current prompt editor, streamed responses, and tool calls */}
      <main className="no-scrollbar flex min-h-0 flex-1 flex-col">
        <Chat />
      </main>
    </div>
  );
}
