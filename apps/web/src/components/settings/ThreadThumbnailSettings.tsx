import { useState, useSyncExternalStore } from "react";

import {
  clearThreadThumbnails,
  generateThreadThumbnailImage,
  getThreadThumbnailStatus,
  retryThreadThumbnails,
  subscribeThreadThumbnails,
} from "../../threadThumbnails";
import {
  DEFAULT_THREAD_THUMBNAIL_PROMPT,
  type ThreadThumbnailConfig,
} from "../../threadThumbnails.logic";
import { useThreadThumbnailConfig } from "../ThreadThumbnail";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import { forkSetting } from "./forkSetting";
import { SettingResetButton, SettingsRow, SettingsSection } from "./settingsLayout";

const SAMPLE_TITLE = "Create a Slack channel with an incident workflow";

export function ThreadThumbnailSettings() {
  const [config, setConfig] = useThreadThumbnailConfig();
  const status = useSyncExternalStore(subscribeThreadThumbnails, getThreadThumbnailStatus);
  const [sample, setSample] = useState<{ dataUrl?: string; message: string } | null>(null);
  const [sampling, setSampling] = useState(false);

  const update = (patch: Partial<ThreadThumbnailConfig>) => {
    setConfig({ ...config, ...patch });
    retryThreadThumbnails();
  };

  const generateSample = async () => {
    setSampling(true);
    setSample({ message: "Generating… a cold endpoint can take a minute." });
    try {
      const dataUrl = await generateThreadThumbnailImage(
        config,
        SAMPLE_TITLE,
        AbortSignal.timeout(180_000),
      );
      setSample({ dataUrl, message: `Sample for “${SAMPLE_TITLE}”.` });
      retryThreadThumbnails();
    } catch (cause) {
      setSample({ message: cause instanceof Error ? cause.message : String(cause) });
    } finally {
      setSampling(false);
    }
  };

  return (
    <SettingsSection title="Thread thumbnails">
      <SettingsRow
        {...forkSetting("thread-thumbnails")}
        description="Draw a picture for each thread from its title with your own image model, so threads are easier to tell apart in the sidebar. Applies to this device."
        control={
          <Switch
            checked={config.enabled}
            onCheckedChange={(enabled) => update({ enabled })}
            aria-label="Thread thumbnails"
          />
        }
      />
      {config.enabled ? (
        <>
          <SettingsRow
            title="Image endpoint"
            description='Gets an OpenAI-style images request ({ prompt, size, response_format: "b64_json" }) and returns an image or { data: [{ b64_json }] }. It must allow cross-origin requests.'
          >
            <div className="mt-3 max-w-2xl pb-3.5">
              <Input
                key={config.endpoint}
                type="url"
                size="sm"
                aria-label="Image endpoint"
                autoCapitalize="off"
                autoComplete="off"
                spellCheck={false}
                placeholder="https://you--t3-thumbnails-generate.modal.run"
                defaultValue={config.endpoint}
                onBlur={(event) => {
                  const endpoint = event.target.value.trim();
                  if (endpoint !== config.endpoint) update({ endpoint });
                }}
              />
            </div>
          </SettingsRow>
          <SettingsRow
            title="API token"
            description="Optional. Sent as Authorization: Bearer <token>."
          >
            <div className="mt-3 max-w-2xl pb-3.5">
              <Input
                key={config.token}
                type="password"
                size="sm"
                aria-label="API token"
                autoComplete="off"
                placeholder="None"
                defaultValue={config.token}
                onBlur={(event) => {
                  const token = event.target.value.trim();
                  if (token !== config.token) update({ token });
                }}
              />
            </div>
          </SettingsRow>
          <SettingsRow
            title="Prompt"
            description="{title} becomes the thread's title. Changes apply to new thumbnails; redraw to update the rest."
            resetAction={
              config.prompt !== DEFAULT_THREAD_THUMBNAIL_PROMPT ? (
                <SettingResetButton
                  label="thumbnail prompt"
                  onClick={() => update({ prompt: DEFAULT_THREAD_THUMBNAIL_PROMPT })}
                />
              ) : null
            }
          >
            <div className="mt-3 max-w-2xl pb-3.5">
              <Textarea
                key={config.prompt}
                aria-label="Thumbnail prompt"
                rows={4}
                defaultValue={config.prompt}
                onBlur={(event) => {
                  const prompt = event.target.value.trim() || DEFAULT_THREAD_THUMBNAIL_PROMPT;
                  if (prompt !== config.prompt) update({ prompt });
                }}
              />
            </div>
          </SettingsRow>
          <SettingsRow
            title="Try it"
            description={
              sample?.message ??
              (status.lastError
                ? `Paused after an error, retrying later: ${status.lastError}`
                : "Generate a sample, or redraw every thumbnail with the current prompt.")
            }
            control={
              <>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={sampling || config.endpoint === ""}
                  onClick={() => void generateSample()}
                >
                  Generate sample
                </Button>
                <Button size="sm" variant="outline" onClick={() => void clearThreadThumbnails()}>
                  Redraw all
                </Button>
              </>
            }
          >
            {sample?.dataUrl ? (
              <div className="pb-3.5">
                <img src={sample.dataUrl} alt="" className="size-24 rounded-lg" />
              </div>
            ) : null}
          </SettingsRow>
        </>
      ) : null}
    </SettingsSection>
  );
}
