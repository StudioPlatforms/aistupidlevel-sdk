import {
  Action,
  ActionPanel,
  Color,
  Detail,
  Icon,
  Keyboard,
  getPreferenceValues,
  openExtensionPreferences,
} from "@raycast/api";
import { useEffect, useRef, useState } from "react";
import { type AnswerState, answerMarkdown, modeLabel } from "../lib/conversation";
import { providerLabel } from "../lib/format";
import { type ChatMessage, RouterError, type Routing, streamChat } from "../lib/router";
import { AskForm } from "./ask-form";

const RENDER_INTERVAL_MS = 80;

export function AnswerView({ messages, mode }: { messages: ChatMessage[]; mode: string }) {
  const { routerKey, sandbox } = getPreferenceValues<Preferences>();
  const prompt = messages[messages.length - 1]?.content ?? "";
  const [answer, setAnswer] = useState("");
  const [state, setState] = useState<AnswerState>("routing");
  const [routing, setRouting] = useState<Routing | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    const abort = new AbortController();
    controller.current = abort;
    let text = "";
    let timer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      timer = null;
      setAnswer(text);
    };

    (async () => {
      try {
        const stream = await streamChat(
          { model: mode, messages },
          { apiKey: routerKey, sandbox, signal: abort.signal },
        );
        setRouting(stream.routing);
        setState("thinking");
        for await (const delta of stream.deltas) {
          if (delta.content) {
            text += delta.content;
            setState("streaming");
            if (!timer) timer = setTimeout(flush, RENDER_INTERVAL_MS);
          }
        }
        if (timer) clearTimeout(timer);
        setAnswer(text);
        setState("done");
      } catch (e) {
        if (timer) clearTimeout(timer);
        setAnswer(text);
        if (abort.signal.aborted) {
          setState("stopped");
          return;
        }
        setError(e instanceof Error ? e : new Error(String(e)));
        setState("error");
      }
    })();

    return () => abort.abort();
  }, []);

  const busy = state === "routing" || state === "thinking" || state === "streaming";
  const conversation: ChatMessage[] = answer ? [...messages, { role: "assistant", content: answer }] : messages;
  const helpUrl = error instanceof RouterError ? error.helpUrl : null;
  const helpTitle = error instanceof RouterError ? error.helpTitle : null;

  return (
    <Detail
      isLoading={busy}
      markdown={answerMarkdown({ prompt, answer, state, errorMessage: error?.message })}
      metadata={
        <Detail.Metadata>
          <Detail.Metadata.Label title="Routing" text={modeLabel(mode)} />
          <Detail.Metadata.Label title="Answered By" text={routing?.model ?? (busy ? "Choosing…" : "–")} />
          {routing?.provider && <Detail.Metadata.Label title="Provider" text={providerLabel(routing.provider)} />}
          {routing?.reasoning && <Detail.Metadata.Label title="Why" text={routing.reasoning} />}
          {(routing?.fallback || routing?.sandbox) && (
            <Detail.Metadata.TagList title="Notes">
              {routing?.fallback && <Detail.Metadata.TagList.Item text="Fallback Answered" color={Color.Orange} />}
              {routing?.sandbox && <Detail.Metadata.TagList.Item text="Sandbox: Mock Answer" color={Color.Purple} />}
            </Detail.Metadata.TagList>
          )}
          {routing?.requestId && <Detail.Metadata.Label title="Request ID" text={routing.requestId} />}
        </Detail.Metadata>
      }
      actions={
        <ActionPanel>
          {busy ? <Action title="Stop" icon={Icon.Stop} onAction={() => controller.current?.abort()} /> : null}
          {answer ? (
            <>
              <Action.CopyToClipboard title="Copy Answer" content={answer} />
              <Action.Paste title="Paste Answer" content={answer} />
            </>
          ) : null}
          {!busy && (
            <Action.Push
              title="Ask a Follow-Up"
              icon={Icon.SpeechBubble}
              shortcut={Keyboard.Shortcut.Common.New}
              target={<AskForm initialMode={mode} history={conversation} />}
            />
          )}
          {helpUrl && helpTitle && <Action.OpenInBrowser title={helpTitle} url={helpUrl} />}
          {routing?.model && (
            <Action.CopyToClipboard
              title="Copy Model ID"
              content={routing.model}
              shortcut={Keyboard.Shortcut.Common.Copy}
            />
          )}
          {routing?.requestId && <Action.CopyToClipboard title="Copy Request ID" content={routing.requestId} />}
          <Action title="Open Extension Preferences" icon={Icon.Gear} onAction={openExtensionPreferences} />
        </ActionPanel>
      }
    />
  );
}
