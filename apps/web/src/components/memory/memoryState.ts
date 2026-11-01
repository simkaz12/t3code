import { useAtomValue } from "@effect/atom-react";
import {
  createEnvironmentQueryAtomFamily,
  createEnvironmentRpcCommand,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "@t3tools/client-runtime/state/runtime";
import { request } from "@t3tools/client-runtime/rpc";
import { type MemoryProposalsSnapshot, WS_METHODS } from "@t3tools/contracts";
import { AsyncResult, Atom } from "effect/reactivity";

import { connectionAtomRuntime } from "../../connection/runtime";
import { environmentServerConfigsAtom } from "../../state/server";
import type { TrayTile } from "./memoryTray.logic";

export const memoryEnvironment = {
  proposals: createEnvironmentRpcSubscriptionAtomFamily(connectionAtomRuntime, {
    label: "environment-data:memory:proposals",
    tag: WS_METHODS.memorySubscribeProposals,
  }),
  approve: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:memory:approve",
    tag: WS_METHODS.memoryApprove,
  }),
  reject: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:memory:reject",
    tag: WS_METHODS.memoryReject,
  }),
  reinforce: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:memory:reinforce",
    tag: WS_METHODS.memoryReinforce,
  }),
  settings: createEnvironmentQueryAtomFamily(connectionAtomRuntime, {
    label: "environment-data:memory:settings",
    idleTtlMs: 0,
    staleTimeMs: 0,
    execute: (_input: { readonly memoryServerUrl: string }) =>
      request(WS_METHODS.memoryGetSettings, {}),
  }),
  updateSettings: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:memory:update-settings",
    tag: WS_METHODS.memoryUpdateSettings,
  }),
};

export interface MemoryTrayState {
  readonly configured: boolean;
  readonly tiles: ReadonlyArray<TrayTile>;
  readonly errors: ReadonlyArray<string>;
}

const EMPTY_SNAPSHOT: MemoryProposalsSnapshot = { configured: false, error: null, proposals: [] };
const EMPTY_STATE: MemoryTrayState = { configured: false, tiles: [], errors: [] };

const memoryTrayAtom = Atom.make((get): MemoryTrayState => {
  const environmentIds = Array.from(get(environmentServerConfigsAtom).keys());
  if (environmentIds.length === 0) return EMPTY_STATE;

  const tiles: Array<TrayTile> = [];
  const errors: Array<string> = [];
  let configured = false;
  for (const environmentId of environmentIds) {
    const snapshot = AsyncResult.getOrElse(
      get(memoryEnvironment.proposals({ environmentId, input: {} })),
      () => EMPTY_SNAPSHOT,
    );
    if (!snapshot.configured) continue;

    configured = true;
    if (snapshot.error !== null) errors.push(snapshot.error);
    for (const proposal of snapshot.proposals) tiles.push({ ...proposal, environmentId });
  }

  return { configured, tiles, errors };
}).pipe(Atom.withLabel("web-memory-tray"));

export const memoryTrayOpenAtom = Atom.make(false).pipe(Atom.withLabel("web-memory-tray-open"));

export function useMemoryTray(): MemoryTrayState {
  return useAtomValue(memoryTrayAtom);
}
