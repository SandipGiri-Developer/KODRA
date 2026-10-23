const OnboardingCard = () => <></>;
import { ConversationStarterCards } from "../../components/ConversationStarters";
import { getMetaKeyLabel } from "../../util";
const kodraLogo = (window as any).vscLogoUrl || ((window as any).vscMediaUrl ? `${(window as any).vscMediaUrl}/icon.webp` : "");

export interface EmptyChatBodyProps {
  showOnboardingCard?: boolean;
}

export function EmptyChatBody({ showOnboardingCard }: EmptyChatBodyProps) {
  if (showOnboardingCard) {
    return (
      <div className="mx-2 mt-6">
        <OnboardingCard />
      </div>
    );
  }

  const metaKey = getMetaKeyLabel();

  return (
    <div className="flex flex-col items-center justify-center w-full h-full pt-8 px-3">
      <div className="flex-1 flex flex-col items-center justify-center">
        {kodraLogo && (
          <img
            src={kodraLogo}
            alt="KODRA Logo"
            className="w-20 h-20 max-w-[80px] max-h-[80px] object-contain mb-4 opacity-85 hover:opacity-100 transition-opacity duration-300 drop-shadow select-none"
          />
        )}
        <p className="text-[12px] text-[var(--vscode-descriptionForeground,#8c98a9)] text-center select-none flex items-center justify-center gap-1 flex-wrap">
          <span>Press</span>
          <kbd className="px-1.5 py-0.5 text-[11px] font-sans font-medium rounded border border-[var(--vscode-keybindingLabel-border,rgba(128,128,128,0.25))] bg-[var(--vscode-keybindingLabel-background,rgba(128,128,128,0.12))] text-[var(--vscode-keybindingLabel-foreground,inherit)] shadow-sm">
            {metaKey}
          </kbd>
          <kbd className="px-1.5 py-0.5 text-[11px] font-sans font-medium rounded border border-[var(--vscode-keybindingLabel-border,rgba(128,128,128,0.25))] bg-[var(--vscode-keybindingLabel-background,rgba(128,128,128,0.12))] text-[var(--vscode-keybindingLabel-foreground,inherit)] shadow-sm">
            K
          </kbd>
          <span>to quickly focus chat</span>
        </p>
      </div>
      <div className="w-full mt-8 pb-2">
        <ConversationStarterCards />
      </div>
    </div>
  );
}
