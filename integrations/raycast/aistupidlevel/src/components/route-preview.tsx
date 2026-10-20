import { Action, ActionPanel, Detail, Icon, getPreferenceValues, openExtensionPreferences } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { useRef } from "react";
import { modeLabel, previewMarkdown, quotePrompt } from "../lib/conversation";
import { providerLabel } from "../lib/format";
import { type ChatMessage, RouterError, previewRoute } from "../lib/router";
import { AnswerView } from "./answer-view";

export function RoutePreviewView({ messages, mode }: { messages: ChatMessage[]; mode: string }) {
  const { routerKey, sandbox } = getPreferenceValues<Preferences>();
  const abortable = useRef<AbortController | null>(null);
  const prompt = messages[messages.length - 1]?.content ?? "";
  const { data, isLoading, error } = usePromise(
    (m: string, msgs: ChatMessage[]) =>
      previewRoute({ model: m, messages: msgs }, { apiKey: routerKey, sandbox, signal: abortable.current?.signal }),
    [mode, messages],
    { abortable, onError: () => undefined },
  );

  let markdown: string;
  if (error) markdown = `${quotePrompt(prompt, 300)}\n\n**The route could not be previewed.** ${error.message}`;
  else if (!data) markdown = `${quotePrompt(prompt, 300)}\n\n_Previewing the route…_`;
  else markdown = previewMarkdown(data, prompt);

  const helpUrl = error instanceof RouterError ? error.helpUrl : null;
  const helpTitle = error instanceof RouterError ? error.helpTitle : null;

  return (
    <Detail
      isLoading={isLoading}
      navigationTitle="Route Preview"
      markdown={markdown}
      metadata={
        data ? (
          <Detail.Metadata>
            <Detail.Metadata.Label title="Routing" text={modeLabel(mode)} />
            <Detail.Metadata.Label title="Strategy" text={data.strategy} />
            <Detail.Metadata.Label title="First Choice" text={data.primary.model} />
            <Detail.Metadata.Label title="Provider" text={providerLabel(data.primary.provider)} />
            <Detail.Metadata.Label title="Fallbacks" text={String(data.fallbacks?.length ?? 0)} />
            {data.sandbox && <Detail.Metadata.Label title="Sandbox" text="Yes" />}
          </Detail.Metadata>
        ) : undefined
      }
      actions={
        <ActionPanel>
          <Action.Push
            title="Ask with This Route"
            icon={Icon.SpeechBubble}
            target={<AnswerView messages={messages} mode={mode} />}
          />
          {helpUrl && helpTitle && <Action.OpenInBrowser title={helpTitle} url={helpUrl} />}
          <Action title="Open Extension Preferences" icon={Icon.Gear} onAction={openExtensionPreferences} />
        </ActionPanel>
      }
    />
  );
}
