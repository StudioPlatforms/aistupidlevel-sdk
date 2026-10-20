import { type LaunchProps, getPreferenceValues } from "@raycast/api";
import { AnswerView } from "./components/answer-view";
import { AskForm } from "./components/ask-form";

export default function Command(props: LaunchProps<{ arguments: Arguments.AskRouter }>) {
  const { routerKey, defaultMode } = getPreferenceValues<Preferences>();
  const prompt = props.arguments.prompt?.trim() || props.fallbackText?.trim() || "";

  // A prompt typed straight into the launcher is answered at once with the default routing mode.
  if (prompt && routerKey?.trim()) {
    return <AnswerView messages={[{ role: "user", content: prompt }]} mode={defaultMode || "auto-best"} />;
  }
  return <AskForm initialPrompt={prompt || undefined} />;
}
