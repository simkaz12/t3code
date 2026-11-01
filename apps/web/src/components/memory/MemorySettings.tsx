import { useRef } from "react";

import { Input } from "../ui/input";
import { SettingResetButton, SettingsRow } from "../settings/settingsLayout";
import { useSettingsScope } from "../settings/SettingsScopeContext";
import { searchableSetting } from "../settings/settingsSearch";
import {
  useScopedSettings,
  useScopedSettingsMixed,
  useUpdateScopedSettings,
} from "../settings/useScopedSettings";

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
    </>
  );
}
