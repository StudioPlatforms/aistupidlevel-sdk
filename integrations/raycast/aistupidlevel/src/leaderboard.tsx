import { Action, ActionPanel, Icon, Keyboard, List } from "@raycast/api";
import { useCachedState } from "@raycast/utils";
import { useMemo } from "react";
import { DataErrorEmptyView } from "./components/data-error";
import { DriftDetail } from "./components/drift-detail";
import { ModelDetail } from "./components/model-detail";
import { AskForm } from "./components/ask-form";
import {
  BOARDS,
  type Board,
  PERIODS,
  type Period,
  boardTitle,
  isBoard,
  isPeriod,
  modelPageUrl,
  periodTitle,
} from "./lib/constants";
import { type ModelScore, modelsPath } from "./lib/data-api";
import {
  modelTitle,
  providerLabel,
  quotaText,
  rankLabel,
  rankModels,
  relativeTime,
  scoreText,
  statusLabel,
  statusTone,
  trendLabel,
} from "./lib/format";
import { rankIcon, toneColor, trendIcon } from "./lib/ui";
import { useDataApi } from "./lib/use-data-api";

export default function Command() {
  const [storedBoard, setBoard] = useCachedState<string>("leaderboard-board", "combined");
  const [storedPeriod, setPeriod] = useCachedState<string>("leaderboard-period", "24h");
  const board: Board = isBoard(storedBoard) ? storedBoard : "combined";
  const period: Period = isPeriod(storedPeriod) ? storedPeriod : "24h";

  const { data, isLoading, error, refresh } = useDataApi<ModelScore[]>(modelsPath(board, period));
  const ranked = useMemo(() => rankModels(Array.isArray(data?.data) ? data.data : []), [data]);

  const periodActions = (
    <ActionPanel.Submenu
      title="Change Period…"
      icon={Icon.Calendar}
      shortcut={{ macOS: { modifiers: ["cmd"], key: "p" }, Windows: { modifiers: ["ctrl"], key: "p" } }}
    >
      {PERIODS.map((p) => (
        <Action
          key={p.value}
          title={p.title}
          icon={p.value === period ? Icon.CheckCircle : Icon.Circle}
          onAction={() => setPeriod(p.value)}
        />
      ))}
    </ActionPanel.Submenu>
  );

  const updated = data ? `Updated ${relativeTime(data.savedAt)}` : undefined;
  const quota = data && !data.fromCache ? quotaText(data.rate) : null;

  return (
    <List
      isLoading={isLoading}
      searchBarPlaceholder="Filter models by name or provider"
      searchBarAccessory={
        <List.Dropdown tooltip="Leaderboard" value={board} onChange={(value) => setBoard(value)}>
          {BOARDS.map((b) => (
            <List.Dropdown.Item key={b.value} title={b.title} value={b.value} />
          ))}
        </List.Dropdown>
      }
    >
      {error ? (
        <DataErrorEmptyView
          error={error}
          onRetry={refresh}
          extraActions={
            <>
              {periodActions}
              <Action title="Show Last 24 Hours" icon={Icon.Calendar} onAction={() => setPeriod("24h")} />
            </>
          }
        />
      ) : (
        <>
          {!isLoading && (
            <List.EmptyView icon={Icon.MagnifyingGlass} title="No Models Found" description="Try another name." />
          )}
          <List.Section
            title={`${boardTitle(board)} · ${periodTitle(period)}`}
            subtitle={[updated, quota].filter(Boolean).join(" · ") || undefined}
          >
            {ranked.map((entry) => {
              const m = entry.model;
              const tone = statusTone(m.status);
              const title = modelTitle(m);
              return (
                <List.Item
                  key={`${m.id}-${m.name}`}
                  icon={{
                    value: rankIcon(entry.rank, tone),
                    tooltip: entry.rank === null ? "Not ranked" : `Rank ${rankLabel(entry)}`,
                  }}
                  title={title}
                  subtitle={providerLabel(m.provider)}
                  keywords={[m.name, m.provider, providerLabel(m.provider)]}
                  accessories={[
                    ...(m.isNew ? [{ tag: { value: "New" }, tooltip: "Recently added" }] : []),
                    ...(entry.tied
                      ? [{ text: rankLabel(entry), tooltip: "Same published score as another model" }]
                      : []),
                    { icon: trendIcon(m.trend), tooltip: trendLabel(m.trend) },
                    {
                      tag: { value: scoreText(m), color: toneColor(tone) },
                      tooltip: `${boardTitle(board)} score ${scoreText(m)} · ${statusLabel(m.status)}`,
                    },
                  ]}
                  actions={
                    <ActionPanel>
                      <ActionPanel.Section>
                        <Action.Push
                          title="Show Score History"
                          icon={Icon.LineChart}
                          target={<ModelDetail entry={entry} board={board} period={period} />}
                        />
                        <Action.Push
                          title="Show Drift Status"
                          icon={Icon.Heartbeat}
                          shortcut={{
                            macOS: { modifiers: ["cmd"], key: "d" },
                            Windows: { modifiers: ["ctrl", "alt"], key: "d" },
                          }}
                          target={<DriftDetail modelId={m.id} title={title} />}
                        />
                        <Action.OpenInBrowser
                          title="Open on AI Stupid Level"
                          url={modelPageUrl(m.id)}
                          shortcut={Keyboard.Shortcut.Common.Open}
                        />
                      </ActionPanel.Section>
                      <ActionPanel.Section>
                        <Action.Push
                          title="Ask Smart Router with This Model"
                          icon={Icon.SpeechBubble}
                          target={<AskForm initialMode={m.name} />}
                        />
                        <Action.CopyToClipboard
                          title="Copy Model ID"
                          content={m.name}
                          shortcut={Keyboard.Shortcut.Common.Copy}
                        />
                      </ActionPanel.Section>
                      <ActionPanel.Section>
                        {periodActions}
                        <Action
                          title="Refresh"
                          icon={Icon.ArrowClockwise}
                          shortcut={Keyboard.Shortcut.Common.Refresh}
                          onAction={refresh}
                        />
                        <Action.OpenInBrowser title="Open Leaderboard in Browser" url="https://aistupidlevel.info" />
                      </ActionPanel.Section>
                    </ActionPanel>
                  }
                />
              );
            })}
          </List.Section>
        </>
      )}
    </List>
  );
}
