import { Action, ActionPanel, Detail, Icon, Keyboard } from "@raycast/api";
import { modelPageUrl } from "../lib/constants";
import { type DriftSignature, driftPath } from "../lib/data-api";
import { driftMarkdown, driftStatusLabel, driftTone, escapeMarkdown, relativeTime, suiteLabel } from "../lib/format";
import { toneColor } from "../lib/ui";
import { useDataApi } from "../lib/use-data-api";
import { DataErrorActions, errorMarkdown } from "./data-error";

export function DriftDetail({ modelId, title }: { modelId: string | number; title: string }) {
  const { data, isLoading, error, refresh } = useDataApi<DriftSignature>(driftPath(modelId));
  const sig = data?.data ?? null;

  let markdown: string;
  if (error) markdown = `# ${escapeMarkdown(title)}\n\n${errorMarkdown(error)}`;
  else if (!sig) markdown = `# ${escapeMarkdown(title)}\n\nLoading drift status…`;
  else markdown = driftMarkdown(title, sig);

  return (
    <Detail
      isLoading={isLoading}
      navigationTitle={`${title} Drift`}
      markdown={markdown}
      metadata={
        sig && sig.dataSource !== "synthetic" ? (
          <Detail.Metadata>
            <Detail.Metadata.TagList title="Drift Status">
              <Detail.Metadata.TagList.Item
                text={driftStatusLabel(sig.driftStatus)}
                color={toneColor(driftTone(sig.driftStatus))}
              />
            </Detail.Metadata.TagList>
            {typeof sig.currentScore === "number" && (
              <Detail.Metadata.Label
                title={sig.suite ? `Newest ${suiteLabel(sig.suite)} Score` : "Newest Score"}
                text={String(sig.currentScore)}
              />
            )}
            {typeof sig.baselineScore === "number" && (
              <Detail.Metadata.Label title="Baseline" text={String(sig.baselineScore)} />
            )}
            {sig.timestamp && <Detail.Metadata.Label title="Checked" text={relativeTime(sig.timestamp)} />}
            <Detail.Metadata.Separator />
            <Detail.Metadata.Link title="Source" target={modelPageUrl(modelId)} text="aistupidlevel.info" />
          </Detail.Metadata>
        ) : undefined
      }
      actions={
        <ActionPanel>
          <Action.OpenInBrowser
            title="Open on AI Stupid Level"
            url={modelPageUrl(modelId)}
            shortcut={Keyboard.Shortcut.Common.Open}
          />
          {error ? (
            <DataErrorActions error={error} onRetry={refresh} />
          ) : (
            <Action
              title="Refresh"
              icon={Icon.ArrowClockwise}
              shortcut={Keyboard.Shortcut.Common.Refresh}
              onAction={refresh}
            />
          )}
        </ActionPanel>
      }
    />
  );
}
