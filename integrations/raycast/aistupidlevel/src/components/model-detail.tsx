import { Action, ActionPanel, Detail, Icon, Keyboard } from "@raycast/api";
import { type Board, type Period, boardTitle, modelPageUrl, periodTitle } from "../lib/constants";
import { type HistoryPoint, historyPath } from "../lib/data-api";
import {
  type RankedModel,
  escapeMarkdown,
  historyMarkdown,
  modelTitle,
  providerLabel,
  rankLabel,
  relativeTime,
  scoreText,
  statusLabel,
  statusTone,
  suiteLabel,
  trendLabel,
  utcStamp,
} from "../lib/format";
import { toneColor } from "../lib/ui";
import { useDataApi } from "../lib/use-data-api";
import { AskForm } from "./ask-form";
import { DataErrorActions, errorMarkdown } from "./data-error";
import { DriftDetail } from "./drift-detail";

export function ModelDetail({ entry, board, period }: { entry: RankedModel; board: Board; period: Period }) {
  const m = entry.model;
  const title = modelTitle(m);
  const { data, isLoading, error, refresh } = useDataApi<HistoryPoint[]>(historyPath(m.id, period));
  const points = Array.isArray(data?.data) ? data.data : [];

  let markdown: string;
  if (error)
    markdown = `# ${escapeMarkdown(title)}\n\nScore history is not available right now.\n\n${errorMarkdown(error)}`;
  else if (!data) markdown = `# ${escapeMarkdown(title)}\n\nLoading score history…`;
  else markdown = historyMarkdown(title, points, periodTitle(period));

  const tone = statusTone(m.status);
  return (
    <Detail
      isLoading={isLoading}
      navigationTitle={title}
      markdown={markdown}
      metadata={
        <Detail.Metadata>
          <Detail.Metadata.Label title="Leaderboard" text={`${boardTitle(board)} · ${periodTitle(period)}`} />
          <Detail.Metadata.Label title="Rank" text={rankLabel(entry)} />
          <Detail.Metadata.TagList title="Score">
            <Detail.Metadata.TagList.Item text={scoreText(m)} color={toneColor(tone)} />
            <Detail.Metadata.TagList.Item text={statusLabel(m.status)} color={toneColor(tone)} />
          </Detail.Metadata.TagList>
          <Detail.Metadata.Label title="Trend" text={trendLabel(m.trend)} />
          {typeof m.periodAvg === "number" && (
            <Detail.Metadata.Label title="Period Average" text={String(m.periodAvg)} />
          )}
          {typeof m.stability === "number" && <Detail.Metadata.Label title="Stability" text={`${m.stability} / 100`} />}
          {typeof m.dataPoints === "number" && (
            <Detail.Metadata.Label title="Runs in Period" text={String(m.dataPoints)} />
          )}
          {typeof m.standardError === "number" && (
            <Detail.Metadata.Label title="Standard Error" text={`±${m.standardError}`} />
          )}
          <Detail.Metadata.Separator />
          <Detail.Metadata.Label title="Provider" text={providerLabel(m.provider)} />
          <Detail.Metadata.Label title="Model ID" text={m.name} />
          {m.suites && m.suites.length > 0 && (
            <Detail.Metadata.TagList title="Suites">
              {m.suites.map((s) => (
                <Detail.Metadata.TagList.Item key={s} text={suiteLabel(s)} />
              ))}
            </Detail.Metadata.TagList>
          )}
          {m.lastUpdated && (
            <Detail.Metadata.Label
              title="Last Run"
              text={`${relativeTime(m.lastUpdated)} (${utcStamp(m.lastUpdated)})`}
            />
          )}
          {m.isStale && <Detail.Metadata.Label title="Note" text={m.staleReason || "Score is older than usual"} />}
          <Detail.Metadata.Separator />
          <Detail.Metadata.Link title="Source" target={modelPageUrl(m.id)} text="aistupidlevel.info" />
        </Detail.Metadata>
      }
      actions={
        <ActionPanel>
          <Action.OpenInBrowser
            title="Open on AI Stupid Level"
            url={modelPageUrl(m.id)}
            shortcut={Keyboard.Shortcut.Common.Open}
          />
          <Action.Push
            title="Show Drift Status"
            icon={Icon.Heartbeat}
            shortcut={{ macOS: { modifiers: ["cmd"], key: "d" }, Windows: { modifiers: ["ctrl", "alt"], key: "d" } }}
            target={<DriftDetail modelId={m.id} title={title} />}
          />
          <Action.Push
            title="Ask Smart Router with This Model"
            icon={Icon.SpeechBubble}
            target={<AskForm initialMode={m.name} />}
          />
          <Action.CopyToClipboard title="Copy Model ID" content={m.name} shortcut={Keyboard.Shortcut.Common.Copy} />
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
