import { Color, Icon, type Image } from "@raycast/api";
import type { Tone } from "./format";

export function toneColor(tone: Tone): Color {
  switch (tone) {
    case "good":
      return Color.Green;
    case "fair":
      return Color.Blue;
    case "warning":
      return Color.Orange;
    case "bad":
      return Color.Red;
    default:
      return Color.SecondaryText;
  }
}

export function trendIcon(trend: string | null | undefined): Image.ImageLike {
  switch (trend) {
    case "up":
      return { source: Icon.ArrowUp, tintColor: Color.Green };
    case "down":
      return { source: Icon.ArrowDown, tintColor: Color.Red };
    case "stable":
      return { source: Icon.Minus, tintColor: Color.SecondaryText };
    default:
      return { source: Icon.QuestionMark, tintColor: Color.SecondaryText };
  }
}

/** A numbered icon for ranks 1–99, tinted by status. */
export function rankIcon(rank: number | null, tone: Tone): Image.ImageLike {
  if (rank === null || rank < 1 || rank > 99) return { source: Icon.Circle, tintColor: Color.SecondaryText };
  const name = `Number${String(rank).padStart(2, "0")}` as keyof typeof Icon;
  return { source: Icon[name], tintColor: toneColor(tone) };
}
