const OnboardingCard = () => <></>;
import { ConversationStarterCards } from "../../components/ConversationStarters";
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

  return (
    <div className="flex flex-col items-center justify-center w-full h-full pt-12">
      <div className="flex-1 flex flex-col items-center justify-center">
        {kodraLogo && <img src={kodraLogo} alt="KODRA Logo" className="w-56 h-56 mb-6 opacity-90" />}
        <p className="text-[13px] text-gray-400 text-center">
          Press <kbd className="px-1.5 py-0.5 border border-gray-600 rounded-md bg-gray-800 text-xs text-gray-300 mx-0.5">Ctrl</kbd> <kbd className="px-1.5 py-0.5 border border-gray-600 rounded-md bg-gray-800 text-xs text-gray-300 mx-0.5">K</kbd> to quickly focus chat
        </p>
      </div>
      <div className="w-full mx-2 mt-12 pb-2">
        <ConversationStarterCards />
      </div>
    </div>
  );
}
