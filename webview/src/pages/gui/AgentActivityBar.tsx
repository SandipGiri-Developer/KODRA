import React from 'react';

export interface PendingApproval {
  toolName: string;
  description: string;
  command?: string;
  filepath?: string;
  diff?: string;
}

export interface ActiveToolInfo {
  toolName: string;
  args?: Record<string, unknown>;
  status: 'requesting' | 'waiting_approval' | 'executing';
}

interface AgentActivityBarProps {
  activeTool: ActiveToolInfo | null;
  pendingApproval: PendingApproval | null;
  onDecision: (approved: boolean) => void;
}

export function AgentActivityBar({
  activeTool,
  pendingApproval,
  onDecision,
}: AgentActivityBarProps) {
  if (pendingApproval) {
    return (
      <div className="mx-3 my-2 p-3 rounded-lg border border-amber-500/30 bg-[#12141C] text-sm shadow-md animate-fadeIn">
        <div className="flex items-center gap-2 mb-2 font-medium text-amber-400">
          <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
          <span>Permission Required</span>
        </div>
        <p className="text-gray-300 text-xs mb-2">{pendingApproval.description}</p>
        
        {pendingApproval.command && (
          <div className="my-2 p-2 bg-[#090A0F] rounded border border-gray-800/80 font-mono text-xs text-emerald-400 overflow-x-auto select-all">
            <span className="text-gray-500 select-none mr-1.5">$</span>
            {pendingApproval.command}
          </div>
        )}

        {pendingApproval.filepath && (
          <div className="my-1 text-xs text-gray-400">
            Target: <code className="text-gray-200 bg-gray-800/50 px-1 py-0.5 rounded">{pendingApproval.filepath}</code>
          </div>
        )}

        <div className="flex gap-2 mt-3 justify-end">
          <button
            type="button"
            onClick={() => onDecision(false)}
            className="px-3 py-1 rounded bg-[#202533] hover:bg-[#2A3142] text-xs text-gray-300 transition-colors"
          >
            Reject
          </button>
          <button
            type="button"
            onClick={() => onDecision(true)}
            className="px-3.5 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-xs font-medium text-white shadow-sm transition-colors"
          >
            Approve
          </button>
        </div>
      </div>
    );
  }

  if (activeTool) {
    let activityText = `Executing ${activeTool.toolName}...`;
    const targetFile = activeTool.args?.file || activeTool.args?.filePath;
    const command = activeTool.args?.command;

    if (activeTool.toolName === 'read_file' && targetFile) {
      activityText = `Reading ${targetFile}...`;
    } else if (activeTool.toolName === 'list_directory') {
      const dirPath = (activeTool.args?.path as string) || (activeTool.args?.dir as string);
      activityText = dirPath ? `Listing ${dirPath}/...` : 'Listing workspace root...';
    } else if (activeTool.toolName === 'search_code') {
      const query = (activeTool.args?.query as string) || (activeTool.args?.pattern as string);
      activityText = query ? `Searching for "${query}"...` : 'Searching codebase...';
    } else if (activeTool.toolName === 'create_file' && targetFile) {
      activityText = `Creating ${targetFile}...`;
    } else if (activeTool.toolName === 'edit_file' && targetFile) {
      activityText = `Editing ${targetFile}...`;
    } else if ((activeTool.toolName === 'terminal' || activeTool.toolName === 'run_command') && command) {
      activityText = `Running: ${command}`;
    }

    return (
      <div className="mx-3 my-1.5 px-3 py-1.5 rounded-md border border-indigo-500/20 bg-indigo-950/20 text-xs text-indigo-300 flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-ping" />
        <span className="truncate">{activityText}</span>
      </div>
    );
  }

  return null;
}
