import type { OrchestrationV2ProviderCapabilities } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";

import { appAtomRegistry } from "../../rpc/atomRegistry";

/** Threads whose next composer send opens a side chat, keyed by thread, valued by a monotonic arm id. */
const sideChatArmsAtom = Atom.make<Readonly<Record<string, number>>>({}).pipe(Atom.keepAlive);
let nextSideChatArmId = 1;

export function armSideChat(threadKey: string): number {
  const armId = nextSideChatArmId++;
  appAtomRegistry.set(sideChatArmsAtom, {
    ...appAtomRegistry.get(sideChatArmsAtom),
    [threadKey]: armId,
  });
  return armId;
}

/** With `arm`, clears only that arm, so a send never consumes one made while it was in flight. */
export function disarmSideChat(threadKey: string, arm?: number): void {
  const current = appAtomRegistry.get(sideChatArmsAtom);
  if (current[threadKey] === undefined || (arm !== undefined && current[threadKey] !== arm)) return;
  const { [threadKey]: _removed, ...rest } = current;
  appAtomRegistry.set(sideChatArmsAtom, rest);
}

export function readSideChatArm(threadKey: string): number | undefined {
  return appAtomRegistry.get(sideChatArmsAtom)[threadKey];
}

export function useSideChatArmed(threadKey: string): boolean {
  return useAtomValue(sideChatArmsAtom)[threadKey] !== undefined;
}

/** Leading `/side` or `/btw` prefix and its separator whitespace, for turning side chat mode off. */
export function stripSideChatCommandPrefix(text: string): { readonly prefixLength: number } | null {
  const match = /^\s*\/(?:side|btw)(?:[ \t]+|\r?\n|$)/i.exec(text);
  return match ? { prefixLength: match[0].length } : null;
}

/**
 * Matches the server's fork policy: a provider supports side chats when it can fork natively
 * or consume a portable full-thread handoff. Absence of session evidence keeps it available.
 */
export function providerSupportsSideChat(
  capabilities: OrchestrationV2ProviderCapabilities | undefined,
): boolean {
  if (capabilities === undefined) return true;
  const canForkNatively =
    capabilities.threads.canForkThread && capabilities.identity.nativeThreadIds === "strong";
  const canForkPortably =
    capabilities.context.canConsumeHandoffSummaries &&
    capabilities.context.acceptsSyntheticUserContext &&
    capabilities.context.supportsFullThreadHandoff;
  return canForkNatively || canForkPortably;
}
