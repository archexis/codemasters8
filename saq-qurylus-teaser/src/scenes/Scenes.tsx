import React from 'react';
import { AbsoluteFill, CanvasImage, interpolate, staticFile, useCurrentFrame } from 'remotion';
import { ASSETS, ANCHORS, CAMERAS, CROPS } from '../config/assets';
import { COLORS, TEXT } from '../config/theme';
import {
  CinematicCamera,
  ConnectionTrace,
  EdgeFade,
  KineticText,
  Provenance,
  SelectionOutline,
  StructuralBackground,
  UIFrame,
  clamp,
  ease,
  ramp,
} from '../components/Cinematic';

/** This is photographed application geography, never a generated city model. */
export const CityWorld: React.FC<{ time: number }> = ({ time }) => {
  const push = interpolate(time, [12, 74], [1, 1.5], {
    ...clamp,
    easing: t => t * t * (3 - 2 * t),
  });
  const close = ramp(time, 64, 84);
  return (
    <>
      <AbsoluteFill style={{ opacity: 1 - close }}>
        <CinematicCamera
          scale={push}
          x={-40 * ramp(time, 12, 74)}
          y={-65 * ramp(time, 12, 74)}
          origin="48% 56%"
        >
          <div
            style={{
              position: 'absolute',
              left: -192,
              top: -216,
              width: 2304,
              height: 1296,
              filter: 'invert(1) grayscale(1) brightness(.84) contrast(1.10)',
            }}
          >
            <CanvasImage src={staticFile(ASSETS.map)} style={{ width: 2304, height: 1296 }} />
          </div>
          <div
            style={{
              position: 'absolute',
              left: ANCHORS.cityTarget.x * 1.2 - 202,
              top: ANCHORS.cityTarget.y * 1.2 - 226,
              width: 20,
              height: 20,
              border: `1px solid ${COLORS.red}`,
              borderRadius: 20,
              opacity: ramp(time, 40, 63),
            }}
          />
        </CinematicCamera>
      </AbsoluteFill>
      <CinematicCamera
        opacity={close}
        scale={interpolate(time, [75, 134], [1, 1.045], { ...clamp, easing: ease })}
        origin="63% 53%"
      >
        <div
          style={{
            position: 'absolute',
            top: 0,
            width: 1920,
            height: 1130,
            overflow: 'hidden',
            filter: 'invert(1) grayscale(1) brightness(.80) contrast(1.10)',
          }}
        >
          <CanvasImage
            src={staticFile(ASSETS.target)}
            style={{ position: 'absolute', left: 0, top: -226, width: 2409.4, height: 1355.3 }}
          />
        </div>
        {time >= 75 && (
          <SelectionOutline x={1178} y={520} width={53} height={61} progress={ramp(time, 75, 82)} />
        )}
      </CinematicCamera>
      <EdgeFade />
      <div
        style={{
          position: 'absolute',
          bottom: 45,
          left: 108,
          fontSize: 15,
          letterSpacing: 2,
          color: COLORS.muted,
        }}
      >
        ӨСКЕМЕН <span style={{ margin: '0 16px', color: COLORS.red }}>—</span> 49.889851° N /
        82.615020° E
      </div>
      <div style={{ position: 'absolute', right: 108, bottom: 43, fontSize: 14, color: '#87919C' }}>
        © OpenStreetMap contributors
      </div>
    </>
  );
};

export const CityReveal: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill>
      <StructuralBackground />
      <AbsoluteFill style={{ opacity: ramp(f, 12, 28) }}>
        <CityWorld time={f} />
      </AbsoluteFill>
      <KineticText start={24} size={112} y={330} width={750}>
        ГОРОД
        <br />
        РАСТЁТ.
      </KineticText>
      <AbsoluteFill style={{ background: '#000', opacity: 1 - ramp(f, 0, 13) }} />
      <div style={{ opacity: ramp(f, 13, 25) }}>
        <Provenance scene={1} />
      </div>
    </AbsoluteFill>
  );
};

export const TargetAcquisition: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill>
      <CityWorld time={75 + f} />
      <KineticText start={3} size={68} y={355} width={920}>
        НО ЧТО СТОИТ
        <br />
        ЗА ФАСАДОМ?
      </KineticText>
      <div
        style={{
          opacity: ramp(f, 13, 23),
          translate: interpolate(f, [13, 28], ['36px 0px', '0px 0px'], { ...clamp, easing: ease }),
        }}
      >
        <UIFrame role="target" crop={CROPS.selected} x={1445} y={245} width={355} />
      </div>
      <div
        style={{
          position: 'absolute',
          left: 1206,
          top: 595,
          width: interpolate(f, [15, 35], [0, 230], clamp),
          height: 1,
          background: COLORS.red,
          opacity: 0.8,
        }}
      />
      <Provenance scene={2} />
      {/* A narrow optical match cut into the dossier, contained within scene 02. */}
      {f >= 53 && (
        <>
          <AbsoluteFill style={{ opacity: ramp(f, 53, 60) }}>
            <StructuralBackground />
          </AbsoluteFill>
          <AbsoluteFill
            style={{
              clipPath: `inset(${interpolate(f, [53, 60], [245, 145], clamp)}px ${interpolate(f, [53, 60], [120, 195], clamp)}px ${interpolate(f, [53, 60], [248, 39], clamp)}px ${interpolate(f, [53, 60], [1445, 315], clamp)}px)`,
            }}
          >
            <UIFrame role="dossier" crop={CROPS.dossier} {...CAMERAS.dossier} />
          </AbsoluteFill>
        </>
      )}
    </AbsoluteFill>
  );
};

export const DossierReveal: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill>
      <StructuralBackground />
      <CinematicCamera
        scale={interpolate(f, [0, 44], [1, 1.045], { ...clamp, easing: ease })}
        x={-8 * ramp(f, 0, 44)}
        y={-8 * ramp(f, 0, 44)}
      >
        <UIFrame role="dossier" crop={CROPS.dossier} {...CAMERAS.dossier}>
          <SelectionOutline {...ANCHORS.developer} progress={ramp(f, 7, 17)} />
        </UIFrame>
      </CinematicCamera>
      <Provenance scene={3} />
    </AbsoluteFill>
  );
};

export const ConnectionsReveal: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill>
      <StructuralBackground />
      <CinematicCamera
        scale={interpolate(f, [0, 59], [0.97, 1.055], { ...clamp, easing: ease })}
        x={interpolate(f, [0, 59], [45, 0], { ...clamp, easing: ease })}
        y={-12 * ramp(f, 22, 59)}
      >
        <UIFrame role="connections" crop={CROPS.connections} {...CAMERAS.connections}>
          <SelectionOutline {...ANCHORS.centralNode} progress={ramp(f, 0, 8)} />
          <ConnectionTrace progress={ramp(f, 15, 31)} />
          <SelectionOutline {...ANCHORS.sourceNode} progress={ramp(f, 31, 40)} />
        </UIFrame>
      </CinematicCamera>
      {f < 31 ? (
        <KineticText size={90}>{TEXT.connections}</KineticText>
      ) : (
        <KineticText start={31} size={90}>
          {TEXT.documents}
        </KineticText>
      )}
      <Provenance scene={4} />
    </AbsoluteFill>
  );
};

export const DocumentReveal: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill>
      <StructuralBackground />
      <CinematicCamera
        scale={interpolate(f, [0, 59], [0.965, 1.035], { ...clamp, easing: ease })}
        x={interpolate(f, [0, 59], [-32, 0], { ...clamp, easing: ease })}
      >
        <UIFrame role="document" crop={CROPS.document} {...CAMERAS.document}>
          <SelectionOutline {...ANCHORS.sourcePassage} progress={ramp(f, 15, 28)} />
        </UIFrame>
      </CinematicCamera>
      <KineticText size={82}>{TEXT.document}</KineticText>
      <Provenance scene={5} />
    </AbsoluteFill>
  );
};

export const VerificationReveal: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill>
      <StructuralBackground />
      <CinematicCamera
        scale={interpolate(f, [0, 14, 40, 50], [0.985, 1, 1, 1.1], { ...clamp, easing: ease })}
      >
        <UIFrame role="verification" crop={CROPS.verification} {...CAMERAS.verification}>
          <SelectionOutline {...ANCHORS.confirmedFact} progress={ramp(f, 12, 22)} />
        </UIFrame>
      </CinematicCamera>
      <KineticText start={12} size={65} y={113}>
        {TEXT.verification}
      </KineticText>
      <Provenance scene={6} />
    </AbsoluteFill>
  );
};

export const ReverseZoom: React.FC = () => {
  const f = useCurrentFrame();
  const stage = Math.min(5, Math.floor(f / 4));
  const plate =
    stage === 0
      ? 'verification'
      : stage === 1
        ? 'document'
        : stage === 2
          ? 'connections'
          : 'dossier';
  return (
    <AbsoluteFill>
      <StructuralBackground />
      {stage < 4 ? (
        <CinematicCamera
          scale={interpolate(f % 4, [0, 3], [1.13, 0.93], clamp)}
          y={interpolate(f % 4, [0, 3], [10, -25], clamp)}
        >
          <UIFrame role={plate} crop={CROPS[plate]} {...CAMERAS[plate]} />
        </CinematicCamera>
      ) : (
        <CinematicCamera scale={interpolate(f, [16, 23], [1.25, 1], clamp)}>
          <CityWorld time={stage === 4 ? 105 : 45} />
        </CinematicCamera>
      )}
      <Provenance scene={7} />
    </AbsoluteFill>
  );
};

export const BrandReveal: React.FC<{ still?: boolean }> = ({ still = false }) => {
  const actual = useCurrentFrame();
  const f = still ? 60 : actual;
  return (
    <AbsoluteFill
      style={{ backgroundColor: COLORS.background, alignItems: 'center', justifyContent: 'center' }}
    >
      <div
        style={{
          position: 'absolute',
          top: 401,
          width: '100%',
          textAlign: 'center',
          opacity: ramp(f, 6, 15),
          scale: interpolate(f, [6, 17], [0.985, 1], { ...clamp, easing: ease }),
        }}
      >
        {ASSETS.logo ? (
          <CanvasImage
            src={staticFile(ASSETS.logo)}
            style={{ width: 900, height: 120, objectFit: 'contain' }}
          />
        ) : (
          <div
            style={{
              fontSize: 126,
              lineHeight: 1.1,
              fontWeight: 790,
              letterSpacing: '-.055em',
              color: COLORS.white,
            }}
          >
            {TEXT.brand}
          </div>
        )}
      </div>
      <div
        style={{
          position: 'absolute',
          left: 910,
          top: 586,
          width: 100,
          height: 2,
          background: COLORS.red,
          scale: `${ramp(f, 15, 24)} 1`,
        }}
      />
      <div
        style={{
          position: 'absolute',
          top: 631,
          width: '100%',
          textAlign: 'center',
          fontSize: 29,
          fontWeight: 470,
          letterSpacing: 5,
          color: '#AEB5BD',
          opacity: ramp(f, 18, 28),
        }}
      >
        {TEXT.tagline}
      </div>
    </AbsoluteFill>
  );
};
