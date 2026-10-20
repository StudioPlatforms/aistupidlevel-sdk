import { Action, ActionPanel, Color, Icon, Keyboard, List } from "@raycast/api";
import { useMemo } from "react";
import { DataErrorEmptyView } from "./components/data-error";
import { STATUS_URL, modelPageUrl } from "./lib/constants";
import { type Incident, incidentsPath } from "./lib/data-api";
import {
  escapeMarkdown,
  formatDuration,
  incidentTitle,
  incidentTypeLabel,
  providerLabel,
  quotaText,
  relativeTime,
  severityLabel,
  severityTone,
  sortIncidents,
  utcStamp,
} from "./lib/format";
import { toneColor } from "./lib/ui";
import { useDataApi } from "./lib/use-data-api";

const LIMIT = 30;

export default function Command() {
  const { data, isLoading, error, refresh } = useDataApi<Incident[]>(incidentsPath(LIMIT));
  const { active, resolved } = useMemo(() => sortIncidents(Array.isArray(data?.data) ? data.data : []), [data]);
  const updated = data ? `Updated ${relativeTime(data.savedAt)}` : undefined;
  const quota = data && !data.fromCache ? quotaText(data.rate) : null;

  const item = (incident: Incident) => {
    const isActive = !incident.resolvedAt;
    const tone = severityTone(incident.severity);
    const affected = incident.metadata?.affectedModels ?? [];
    const providerWide = incident.incidentType === "provider_wide_degradation";
    const markdown = [
      `## ${escapeMarkdown(incidentTitle(incident))}`,
      "",
      incident.description ? escapeMarkdown(incident.description) : "_No description._",
      ...(affected.length ? ["", "**Affected models**", "", ...affected.map((m) => `- \`${m}\``)] : []),
    ].join("\n");

    return (
      <List.Item
        key={incident.id}
        icon={
          isActive
            ? { source: Icon.Warning, tintColor: toneColor(tone) }
            : { source: Icon.CheckCircle, tintColor: Color.Green }
        }
        title={incidentTitle(incident)}
        keywords={[incident.provider ?? "", incident.modelName ?? "", ...affected]}
        accessories={[
          { tag: { value: severityLabel(incident.severity), color: toneColor(tone) } },
          isActive
            ? { text: `Detected ${relativeTime(incident.detectedAt)}`, tooltip: utcStamp(incident.detectedAt) }
            : { text: `Resolved ${relativeTime(incident.resolvedAt)}`, tooltip: utcStamp(incident.resolvedAt) },
        ]}
        detail={
          <List.Item.Detail
            markdown={markdown}
            metadata={
              <List.Item.Detail.Metadata>
                <List.Item.Detail.Metadata.Label title="Type" text={incidentTypeLabel(incident.incidentType)} />
                <List.Item.Detail.Metadata.TagList title="Severity">
                  <List.Item.Detail.Metadata.TagList.Item
                    text={severityLabel(incident.severity)}
                    color={toneColor(tone)}
                  />
                </List.Item.Detail.Metadata.TagList>
                {incident.provider && (
                  <List.Item.Detail.Metadata.Label title="Provider" text={providerLabel(incident.provider)} />
                )}
                {!providerWide && incident.modelName && (
                  <List.Item.Detail.Metadata.Label title="Model" text={incident.modelName} />
                )}
                <List.Item.Detail.Metadata.Label title="Detected" text={utcStamp(incident.detectedAt)} />
                <List.Item.Detail.Metadata.Label
                  title={isActive ? "Ongoing For" : "Resolved"}
                  text={isActive ? formatDuration(incident.detectedAt, null) : utcStamp(incident.resolvedAt)}
                />
                {!isActive && (
                  <List.Item.Detail.Metadata.Label
                    title="Duration"
                    text={formatDuration(incident.detectedAt, incident.resolvedAt)}
                  />
                )}
              </List.Item.Detail.Metadata>
            }
          />
        }
        actions={
          <ActionPanel>
            {!providerWide && incident.modelId !== null && (
              <Action.OpenInBrowser
                title="Open Model on AI Stupid Level"
                url={modelPageUrl(incident.modelId)}
                shortcut={Keyboard.Shortcut.Common.Open}
              />
            )}
            <Action.OpenInBrowser title="Open Status Page" icon={Icon.Heartbeat} url={STATUS_URL} />
            <Action.CopyToClipboard
              title="Copy Incident Summary"
              content={`${incidentTitle(incident)} (${severityLabel(incident.severity)}), detected ${utcStamp(incident.detectedAt)}${
                incident.resolvedAt ? `, resolved ${utcStamp(incident.resolvedAt)}` : ", ongoing"
              }. ${incident.description ?? ""}`.trim()}
              shortcut={Keyboard.Shortcut.Common.Copy}
            />
            <Action
              title="Refresh"
              icon={Icon.ArrowClockwise}
              shortcut={Keyboard.Shortcut.Common.Refresh}
              onAction={refresh}
            />
          </ActionPanel>
        }
      />
    );
  };

  const subtitle = [updated, quota].filter(Boolean).join(" · ") || undefined;

  return (
    <List
      isLoading={isLoading}
      isShowingDetail={!error && active.length + resolved.length > 0}
      searchBarPlaceholder="Filter incidents by provider or model"
    >
      {error ? (
        <DataErrorEmptyView error={error} onRetry={refresh} />
      ) : (
        <>
          {!isLoading && (
            <List.EmptyView
              icon={{ source: Icon.CheckCircle, tintColor: Color.Green }}
              title="No Incidents"
              description="No incidents in the recent record."
              actions={
                <ActionPanel>
                  <Action.OpenInBrowser title="Open Status Page" icon={Icon.Heartbeat} url={STATUS_URL} />
                </ActionPanel>
              }
            />
          )}
          <List.Section title="Active" subtitle={active.length ? `${active.length}` : undefined}>
            {active.map(item)}
            {!isLoading && active.length === 0 && resolved.length > 0 && (
              <List.Item
                icon={{ source: Icon.CheckCircle, tintColor: Color.Green }}
                title="No Active Incidents"
                detail={
                  <List.Item.Detail markdown="No incident in the record is open. Resolved incidents are listed below." />
                }
                actions={
                  <ActionPanel>
                    <Action.OpenInBrowser title="Open Status Page" icon={Icon.Heartbeat} url={STATUS_URL} />
                    <Action
                      title="Refresh"
                      icon={Icon.ArrowClockwise}
                      shortcut={Keyboard.Shortcut.Common.Refresh}
                      onAction={refresh}
                    />
                  </ActionPanel>
                }
              />
            )}
          </List.Section>
          <List.Section title="Resolved" subtitle={subtitle}>
            {resolved.map(item)}
          </List.Section>
        </>
      )}
    </List>
  );
}
