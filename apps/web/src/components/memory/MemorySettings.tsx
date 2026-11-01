import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useRef, useState } from "react";

import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { Input } from "../ui/input";
import { SettingResetButton, SettingsRow } from "../settings/settingsLayout";
import { useSettingsScope } from "../settings/SettingsScopeContext";
import { searchableSetting } from "../settings/settingsSearch";
import {
  useScopedSettings,
  useScopedSettingsMixed,
  useUpdateScopedSettings,
} from "../settings/useScopedSettings";
import { memoryEnvironment } from "./memoryState";
import {
  CONFIDENCE_FLOOR_STEP,
  effectiveMemoryServerUrl,
  isConfidenceFloorLocked,
  parseConfidenceFloor,
  shouldSaveConfidenceFloor,
} from "./memorySettings.logic";

function CleanerConfidenceFloorRow() {
  const { target } = useSettingsScope();
  const environmentId = target?.environmentId ?? null;
  const memoryServerUrl = effectiveMemoryServerUrl(target);
  const query = useEnvironmentQuery(
    environmentId === null
      ? null
      : memoryEnvironment.settings({ environmentId, input: { memoryServerUrl } }),
  );
  const updateFloor = useAtomCommand(memoryEnvironment.updateSettings, { reportFailure: false });
  const [feedback, setFeedback] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const edited = useRef(false);
  const saved = query.isSuccess ? (query.data?.cleanerConfidenceFloor ?? null) : null;
  const locked = isConfidenceFloorLocked({ saved, saving, refreshing: query.isPending });
  const status = query.error ?? (query.isSuccess ? null : "Loading the server value.");

  const save = async (raw: string) => {
    const parsed = parseConfidenceFloor(raw);
    if (!parsed.valid) {
      setFeedback(parsed.message);
      return;
    }
    if (environmentId === null || !shouldSaveConfidenceFloor(parsed, saved)) {
      setFeedback(null);
      return;
    }

    setSaving(true);
    const result = await updateFloor({
      environmentId,
      input: { cleanerConfidenceFloor: parsed.value },
    });
    if (result._tag === "Success") {
      setFeedback(null);
      query.refresh();
      setSaving(false);
      return;
    }

    setSaving(false);
    const error = squashAtomCommandFailure(result);
    setFeedback(error instanceof Error ? error.message : "The floor was not saved.");
  };

  return (
    <SettingsRow
      {...searchableSetting("memory-cleaner-confidence")}
      description="Lowest Jev confidence at which the weekly memory cleaner proposes a replacement or a retirement. Stored on the memory server and shared by every machine that uses it."
    >
      <div className="mt-3 max-w-md pb-3.5">
        <Input
          key={`${environmentId}:${saved}`}
          aria-label="Cleaner confidence floor"
          type="number"
          min={0}
          max={1}
          step={CONFIDENCE_FLOOR_STEP}
          disabled={locked}
          defaultValue={saved ?? ""}
          onChange={() => {
            edited.current = true;
          }}
          onBlur={(event) => {
            const raw = event.target.value;
            if (edited.current) void save(raw);
            edited.current = false;
          }}
        />
        {feedback !== null ? <p className="mt-1.5 text-xs text-destructive">{feedback}</p> : null}
        {feedback === null && status !== null ? (
          <p className="mt-1.5 text-xs text-muted-foreground">{status}</p>
        ) : null}
      </div>
    </SettingsRow>
  );
}

export function MemorySettings() {
  const settings = useScopedSettings();
  const { targets } = useSettingsScope();
  const scopeKey = targets.map((target) => `${target.environmentId}:${target.projectId}`).join(",");
  const updateSettings = useUpdateScopedSettings();
  const mixedScope = useScopedSettingsMixed(["memoryScope"]);
  const mixedServerUrl = useScopedSettingsMixed(["memoryServerUrl"]);
  const scopeEdited = useRef(false);
  const serverUrlEdited = useRef(false);

  return (
    <>
      <SettingsRow
        serverScoped
        settingKeys={["memoryScope"]}
        {...searchableSetting("memory-scope")}
        description="Memory scope for proposals and searches from this project. Empty uses the repository folder name. Projects that share a value share memory."
        resetAction={
          mixedScope || settings.memoryScope !== "" ? (
            <SettingResetButton
              label="memory scope"
              onClick={() => updateSettings({ memoryScope: "" })}
            />
          ) : null
        }
      >
        <div className="mt-3 max-w-md pb-3.5">
          <Input
            key={`${scopeKey}:${mixedScope}:${settings.memoryScope}`}
            aria-label="Memory scope"
            defaultValue={mixedScope ? "" : settings.memoryScope}
            placeholder={mixedScope ? "Mixed" : "Repository folder name"}
            onChange={() => {
              scopeEdited.current = true;
            }}
            onBlur={(event) => {
              const value = event.target.value.trim();
              if (scopeEdited.current && (mixedScope || value !== settings.memoryScope))
                updateSettings({ memoryScope: value });
              scopeEdited.current = false;
            }}
          />
        </div>
      </SettingsRow>
      <SettingsRow
        serverScoped
        settingKeys={["memoryServerUrl"]}
        {...searchableSetting("memory-server-url")}
        description="Base URL of the memory server that agents propose to and search, such as http://10.8.0.1:8789/v2. Empty turns memory off for this environment."
        resetAction={
          mixedServerUrl || settings.memoryServerUrl !== "" ? (
            <SettingResetButton
              label="memory server URL"
              onClick={() => updateSettings({ memoryServerUrl: "" })}
            />
          ) : null
        }
      >
        <div className="mt-3 max-w-md pb-3.5">
          <Input
            key={`${scopeKey}:${mixedServerUrl}:${settings.memoryServerUrl}`}
            aria-label="Memory server URL"
            defaultValue={mixedServerUrl ? "" : settings.memoryServerUrl}
            placeholder={mixedServerUrl ? "Mixed" : "http://10.8.0.1:8789/v2"}
            onChange={() => {
              serverUrlEdited.current = true;
            }}
            onBlur={(event) => {
              const value = event.target.value.trim();
              if (serverUrlEdited.current && (mixedServerUrl || value !== settings.memoryServerUrl))
                updateSettings({ memoryServerUrl: value });
              serverUrlEdited.current = false;
            }}
          />
        </div>
      </SettingsRow>
      <CleanerConfidenceFloorRow />
    </>
  );
}
