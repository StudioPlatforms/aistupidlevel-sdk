import {
  Action,
  ActionPanel,
  Form,
  Icon,
  getPreferenceValues,
  openExtensionPreferences,
  useNavigation,
} from "@raycast/api";
import { useState } from "react";
import { PROVIDER_KEYS_URL, ROUTER_DOCS_URL, ROUTER_KEYS_URL, ROUTING_MODES } from "../lib/constants";
import { withUserTurn } from "../lib/conversation";
import type { ChatMessage } from "../lib/router";
import { AnswerView } from "./answer-view";
import { RoutePreviewView } from "./route-preview";

interface Values {
  prompt: string;
  mode: string;
}

/**
 * Prompt plus routing mode. `initialMode` may be a routing mode or a real model id (from the
 * leaderboard), which pins the request to that model. `history` carries earlier turns of a follow-up.
 */
export function AskForm({
  initialMode,
  initialPrompt,
  history = [],
}: {
  initialMode?: string;
  initialPrompt?: string;
  history?: ChatMessage[];
}) {
  const prefs = getPreferenceValues<Preferences>();
  const { push } = useNavigation();
  const [promptError, setPromptError] = useState<string | undefined>();
  const defaultMode = initialMode ?? prefs.defaultMode ?? "auto-best";
  const pinned = !ROUTING_MODES.some((m) => m.id === defaultMode) ? defaultMode : null;
  const hasKey = !!prefs.routerKey?.trim();

  function read(values: Values): ChatMessage[] | null {
    const prompt = values.prompt.trim();
    if (!prompt) {
      setPromptError("Enter a prompt");
      return null;
    }
    return withUserTurn(history, prompt);
  }

  return (
    <Form
      navigationTitle={history.length ? "Ask a Follow-Up" : undefined}
      actions={
        <ActionPanel>
          {hasKey ? (
            <>
              <Action.SubmitForm
                title="Ask"
                icon={Icon.SpeechBubble}
                onSubmit={(values: Values) => {
                  const messages = read(values);
                  if (messages) push(<AnswerView messages={messages} mode={values.mode} />);
                }}
              />
              <Action.SubmitForm
                title="Preview Route"
                icon={Icon.Eye}
                shortcut={{
                  macOS: { modifiers: ["cmd", "shift"], key: "p" },
                  Windows: { modifiers: ["ctrl", "shift"], key: "p" },
                }}
                onSubmit={(values: Values) => {
                  const messages = read(values);
                  if (messages) push(<RoutePreviewView messages={messages} mode={values.mode} />);
                }}
              />
            </>
          ) : (
            <Action title="Open Extension Preferences" icon={Icon.Gear} onAction={openExtensionPreferences} />
          )}
          <Action.OpenInBrowser title="Manage Router Keys" icon={Icon.Key} url={ROUTER_KEYS_URL} />
          <Action.OpenInBrowser title="Manage Provider Keys" icon={Icon.Key} url={PROVIDER_KEYS_URL} />
          <Action.OpenInBrowser title="Open Smart Router Docs" icon={Icon.Book} url={ROUTER_DOCS_URL} />
          {hasKey && <Action title="Open Extension Preferences" icon={Icon.Gear} onAction={openExtensionPreferences} />}
        </ActionPanel>
      }
    >
      {!hasKey && (
        <Form.Description
          title="Setup"
          text="Add your Smart Router key (aism_…) in the extension preferences. The router answers with your own provider keys, which you add on your AI Stupid Level account."
        />
      )}
      <Form.TextArea
        id="prompt"
        title={history.length ? "Follow-Up" : "Prompt"}
        placeholder="Ask anything"
        defaultValue={initialPrompt}
        error={promptError}
        onChange={() => promptError && setPromptError(undefined)}
        autoFocus
      />
      <Form.Dropdown id="mode" title="Routing" defaultValue={defaultMode} info="How the router picks a model.">
        {pinned && (
          <Form.Dropdown.Section title="Pinned Model">
            <Form.Dropdown.Item value={pinned} title={pinned} icon={Icon.Pin} />
          </Form.Dropdown.Section>
        )}
        <Form.Dropdown.Section title="Routing Modes">
          {ROUTING_MODES.map((m) => (
            <Form.Dropdown.Item key={m.id} value={m.id} title={m.title} keywords={[m.id]} />
          ))}
        </Form.Dropdown.Section>
      </Form.Dropdown>
      {prefs.sandbox && (
        <Form.Description
          title="Sandbox"
          text="Sandbox mode is on: the request is routed for real, but the answer is a placeholder and nothing is charged."
        />
      )}
      {history.length > 0 && (
        <Form.Description title="Conversation" text={`${history.length} earlier messages are sent with this one.`} />
      )}
    </Form>
  );
}
