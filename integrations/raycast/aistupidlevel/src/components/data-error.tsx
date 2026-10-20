import { Action, ActionPanel, Icon, Keyboard, List, openExtensionPreferences } from "@raycast/api";
import { DATA_KEYS_URL, PRICING_URL } from "../lib/constants";
import { DataApiError } from "../lib/data-api";
import type { ReactNode } from "react";

export function errorTitle(error: Error): string {
  if (!(error instanceof DataApiError)) return "Something Went Wrong";
  switch (error.kind) {
    case "missing_key":
      return "Add Your Data API Key";
    case "invalid_key":
      return "Data API Key Not Accepted";
    case "rate_limited":
      return "One Request per Minute on the Free Plan";
    case "quota_exceeded":
      return "Daily Data API Quota Used Up";
    case "plan_required":
      return "Latest Run Needs a Paid Plan";
    case "network":
      return "Could Not Reach AI Stupid Level";
    default:
      return "AI Stupid Level Did Not Answer";
  }
}

export function errorIcon(error: Error): Icon {
  if (!(error instanceof DataApiError)) return Icon.Warning;
  switch (error.kind) {
    case "missing_key":
    case "invalid_key":
      return Icon.Key;
    case "rate_limited":
    case "quota_exceeded":
      return Icon.Clock;
    case "plan_required":
      return Icon.Lock;
    default:
      return Icon.Warning;
  }
}

export function DataErrorActions({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  const kind = error instanceof DataApiError ? error.kind : null;
  const keyProblem = kind === "missing_key" || kind === "invalid_key";
  const planProblem = kind === "rate_limited" || kind === "quota_exceeded" || kind === "plan_required";
  return (
    <>
      {keyProblem && <Action title="Open Extension Preferences" icon={Icon.Gear} onAction={openExtensionPreferences} />}
      {keyProblem && <Action.OpenInBrowser title="Get a Data API Key" url={DATA_KEYS_URL} />}
      {planProblem && <Action.OpenInBrowser title="View Plans" icon={Icon.Star} url={PRICING_URL} />}
      {onRetry && !keyProblem && (
        <Action
          title="Try Again"
          icon={Icon.ArrowClockwise}
          shortcut={Keyboard.Shortcut.Common.Refresh}
          onAction={onRetry}
        />
      )}
      {!keyProblem && (
        <Action title="Open Extension Preferences" icon={Icon.Gear} onAction={openExtensionPreferences} />
      )}
    </>
  );
}

export function DataErrorEmptyView({
  error,
  onRetry,
  extraActions,
}: {
  error: Error;
  onRetry?: () => void;
  extraActions?: ReactNode;
}) {
  return (
    <List.EmptyView
      icon={errorIcon(error)}
      title={errorTitle(error)}
      description={error.message}
      actions={
        <ActionPanel>
          <DataErrorActions error={error} onRetry={onRetry} />
          {extraActions}
        </ActionPanel>
      }
    />
  );
}

export function errorMarkdown(error: Error): string {
  return `## ${errorTitle(error)}\n\n${error.message}`;
}
