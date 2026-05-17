// AppIcon — RN react-native-svg port of the design bundle's
// app-icon.jsx, verbatim geometry. The WAVE brand mark: a vertical
// gradient ground, two soft depth-tinted wave shapes, and two
// hairline crest highlights, clipped to an iOS continuous-corner
// square. Same artwork as the launcher icon (scripts/gen-app-icon).

import Svg, {
  Defs,
  LinearGradient,
  Path,
  Rect,
  Stop,
  ClipPath,
  G,
} from "react-native-svg";

export function AppIcon({
  size = 38,
  radius,
}: {
  size?: number;
  radius?: number;
}) {
  // iOS continuous-corner square ≈ 22.37% of the side.
  const r = radius != null ? radius : Math.round(size * 0.2237);
  const uid = `ai${size}`;

  return (
    <Svg width={size} height={size} viewBox="0 0 240 240">
      <Defs>
        <LinearGradient id={`${uid}-bg`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#fbfeff" />
          <Stop offset="0.25" stopColor="#bce9fc" />
          <Stop offset="0.55" stopColor="#46c3f2" />
          <Stop offset="0.78" stopColor="#0fa3dd" />
          <Stop offset="1" stopColor="#0e89c4" />
        </LinearGradient>
        <LinearGradient id={`${uid}-shade`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#06436c" stopOpacity={0.22} />
          <Stop offset="1" stopColor="#06436c" stopOpacity={0.12} />
        </LinearGradient>
        <ClipPath id={`${uid}-clip`}>
          <Rect width={240} height={240} rx={(r / size) * 240} />
        </ClipPath>
      </Defs>

      <G clipPath={`url(#${uid}-clip)`}>
        <Rect width={240} height={240} fill={`url(#${uid}-bg)`} />
        <Path
          d="M -20 104 C 70 49, 170 159, 260 104 L 260 252 L -20 252 Z"
          fill={`url(#${uid}-shade)`}
        />
        <Path
          d="M -20 176 C 70 121, 170 231, 260 176 L 260 252 L -20 252 Z"
          fill={`url(#${uid}-shade)`}
        />
        <Path
          d="M 0 105 C 72 51, 168 158, 240 105"
          fill="none"
          stroke="#ffffff"
          strokeWidth={1.7}
          opacity={0.8}
        />
        <Path
          d="M 0 177 C 72 123, 168 230, 240 177"
          fill="none"
          stroke="#e0f4ff"
          strokeWidth={1.5}
          opacity={0.65}
        />
      </G>
    </Svg>
  );
}
