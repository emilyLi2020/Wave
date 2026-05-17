// Icon.tsx — the minimal stroked-SVG icon set from screens.jsx Icon(),
// ported to react-native-svg. Only the glyphs the session screens use.

import Svg, { Path } from "react-native-svg";
import { useTheme } from "@/theme-context";

export type IconName =
  | "arrow-right"
  | "arrow-left"
  | "check"
  | "shield"
  | "pill"
  | "sound";

export function Icon({
  name,
  size = 18,
  color,
  strokeWidth = 1.6,
}: {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
}) {
  const theme = useTheme();
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: color ?? theme.fg,
    strokeWidth,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (name) {
    case "arrow-right":
      return (
        <Svg {...common}>
          <Path d="M5 12h14" />
          <Path d="m13 6 6 6-6 6" />
        </Svg>
      );
    case "arrow-left":
      return (
        <Svg {...common}>
          <Path d="M19 12H5" />
          <Path d="m11 6-6 6 6 6" />
        </Svg>
      );
    case "check":
      return (
        <Svg {...common}>
          <Path d="m5 12 5 5L20 7" />
        </Svg>
      );
    case "shield":
      return (
        <Svg {...common}>
          <Path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        </Svg>
      );
    case "pill":
      return (
        <Svg {...common}>
          <Path d="M2 12h20" />
          <Path d="M12 9v6" />
        </Svg>
      );
    case "sound":
      return (
        <Svg {...common}>
          <Path d="M11 5 6 9H2v6h4l5 4z" />
          <Path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
          <Path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
        </Svg>
      );
  }
}
