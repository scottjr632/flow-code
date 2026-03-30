import { type ProviderKind } from "@t3tools/contracts";
import { ClaudeAI, OpenAI, type Icon } from "./components/Icons";

const PROVIDER_ICON_BY_PROVIDER: Record<ProviderKind, Icon> = {
  codex: OpenAI,
  claudeAgent: ClaudeAI,
};

export function getProviderIcon(provider: ProviderKind): Icon {
  return PROVIDER_ICON_BY_PROVIDER[provider];
}

export function providerIconClassName(provider: ProviderKind, fallbackClassName: string): string {
  return provider === "claudeAgent" ? "text-[#d97757]" : fallbackClassName;
}
