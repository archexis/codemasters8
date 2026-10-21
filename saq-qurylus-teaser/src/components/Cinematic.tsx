import React from 'react';
import {
  AbsoluteFill,
  CanvasImage,
  Easing,
  interpolate,
  staticFile,
  useCurrentFrame,
} from 'remotion';
import { ASSETS, AssetRole, Crop } from '../config/assets';
import { COLORS, TEXT } from '../config/theme';

export const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
export const ease = Easing.bezier(0.16, 1, 0.3, 1);
export const ramp = (f: number, a: number, b: number) => interpolate(f, [a, b], [0, 1], clamp);

export const KineticText: React.FC<{
  children: React.ReactNode;
  start?: number;
  size?: number;
  x?: number;
  y?: number;
  width?: number;
}> = ({ children, start = 0, size = 78, x = 108, y = 106, width = 1600 }) => {
  const f = useCurrentFrame();
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width,
        fontSize: size,
        fontWeight: 760,
        lineHeight: 1.03,
        letterSpacing: '-0.045em',
        color: COLORS.white,
        opacity: interpolate(f, [start, start + 7], [0, 1], clamp),
        translate: interpolate(f, [start, start + 9], ['0px 24px', '0px 0px'], {
          ...clamp,
          easing: ease,
        }),
      }}
    >
      {children}
    </div>
  );
};

export const CinematicCamera: React.FC<{
  children: React.ReactNode;
  scale?: number;
  x?: number;
  y?: number;
  opacity?: number;
  origin?: string;
}> = ({ children, scale = 1, x = 0, y = 0, opacity = 1, origin = '50% 50%' }) => (
  <AbsoluteFill style={{ scale, translate: `${x}px ${y}px`, opacity, transformOrigin: origin }}>
    {children}
  </AbsoluteFill>
);

export const UIFrame: React.FC<{
  role: AssetRole;
  crop: Crop;
  x: number;
  y: number;
  width: number;
  children?: React.ReactNode;
  opacity?: number;
  scale?: number;
}> = ({ role, crop, x, y, width, children, opacity = 1, scale = 1 }) => {
  const ratio = width / crop.width;
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width,
        height: crop.height * ratio,
        overflow: 'hidden',
        border: `1px solid ${COLORS.border}`,
        boxShadow: '0 35px 100px #0009',
        opacity,
        scale,
        transformOrigin: '50% 50%',
        background: COLORS.surface,
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: -crop.x * ratio,
          top: -crop.y * ratio,
          width: 1920,
          height: 1080,
          scale: ratio,
          transformOrigin: '0 0',
        }}
      >
        <CanvasImage
          src={staticFile(ASSETS[role])}
          style={{ position: 'absolute', width: 1920, height: 1080 }}
        />
        {children}
      </div>
    </div>
  );
};

export const SelectionOutline: React.FC<{
  x: number;
  y: number;
  width: number;
  height: number;
  progress?: number;
  color?: string;
}> = ({ x, y, width, height, progress = 1, color = COLORS.red }) => (
  <svg
    style={{
      position: 'absolute',
      left: x - 5,
      top: y - 5,
      width: width + 10,
      height: height + 10,
      overflow: 'visible',
      opacity: progress,
    }}
    viewBox={`0 0 ${width + 10} ${height + 10}`}
  >
    <rect
      x="4"
      y="4"
      width={width + 2}
      height={height + 2}
      fill="none"
      stroke={color}
      strokeWidth="1.8"
      pathLength="1"
      strokeDasharray="1"
      strokeDashoffset={1 - progress}
    />
    {[
      `M 0 18 V 0 H 18`,
      `M ${width - 8} 0 H ${width + 10} V 18`,
      `M 0 ${height - 8} V ${height + 10} H 18`,
      `M ${width - 8} ${height + 10} H ${width + 10} V ${height - 8}`,
    ].map((d, i) => (
      <path key={i} d={d} stroke={color} strokeWidth="2.8" fill="none" />
    ))}
  </svg>
);

export const ConnectionTrace: React.FC<{ progress: number }> = ({ progress }) => (
  <svg
    style={{ position: 'absolute', inset: 0, width: 1920, height: 1080 }}
    viewBox="0 0 1920 1080"
  >
    <path
      d="M 881 618 C 817 604 850 430 754 430"
      fill="none"
      stroke={COLORS.red}
      strokeWidth="2"
      pathLength="1"
      strokeDasharray="1"
      strokeDashoffset={1 - progress}
    />
  </svg>
);

export const Provenance: React.FC<{ scene: number }> = ({ scene }) => (
  <>
    <div
      style={{
        position: 'absolute',
        top: 47,
        left: 108,
        color: COLORS.muted,
        fontSize: 16,
        fontWeight: 550,
        letterSpacing: 3,
      }}
    >
      {String(scene).padStart(2, '0')} / 08
    </div>
    <div
      style={{
        position: 'absolute',
        top: 45,
        right: 108,
        fontSize: 17,
        letterSpacing: 1.5,
        fontWeight: 550,
        color: '#BDC3CA',
        borderLeft: `2px solid ${COLORS.red}`,
        paddingLeft: 14,
      }}
    >
      {TEXT.provenance}
    </div>
  </>
);

export const StructuralBackground: React.FC = () => (
  <AbsoluteFill
    style={{
      backgroundColor: COLORS.background,
      backgroundImage:
        'linear-gradient(#87919C08 1px, transparent 1px), linear-gradient(90deg,#87919C08 1px, transparent 1px)',
      backgroundSize: '120px 120px',
    }}
  />
);

export const EdgeFade: React.FC = () => (
  <AbsoluteFill
    style={{
      pointerEvents: 'none',
      background:
        'linear-gradient(90deg,#080A0D 0%,#080A0DF7 11%,#080A0DCC 25%,#080A0D50 45%,transparent 64%),linear-gradient(0deg,#080A0D 0%,transparent 18%,transparent 87%,#080A0D 100%)',
    }}
  />
);
