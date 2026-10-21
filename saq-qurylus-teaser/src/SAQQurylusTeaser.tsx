import { AbsoluteFill, Sequence } from 'remotion';
import { SCENES } from './config/timing';
import { AudioTimeline } from './components/AudioTimeline';
import {
  BrandReveal,
  CityReveal,
  ConnectionsReveal,
  DocumentReveal,
  DossierReveal,
  ReverseZoom,
  TargetAcquisition,
  VerificationReveal,
} from './scenes/Scenes';
import { COLORS } from './config/theme';

export const SAQQurylusTeaser = () => (
  <AbsoluteFill
    style={{ backgroundColor: COLORS.background, fontFamily: 'Inter', overflow: 'hidden' }}
  >
    <Sequence name="01 City" from={SCENES.city.start} durationInFrames={SCENES.city.duration}>
      <CityReveal />
    </Sequence>
    <Sequence name="02 Target" from={SCENES.target.start} durationInFrames={SCENES.target.duration}>
      <TargetAcquisition />
    </Sequence>
    <Sequence
      name="03 Dossier"
      from={SCENES.dossier.start}
      durationInFrames={SCENES.dossier.duration}
    >
      <DossierReveal />
    </Sequence>
    <Sequence
      name="04 Connections"
      from={SCENES.connections.start}
      durationInFrames={SCENES.connections.duration}
    >
      <ConnectionsReveal />
    </Sequence>
    <Sequence
      name="05 Primary source"
      from={SCENES.document.start}
      durationInFrames={SCENES.document.duration}
    >
      <DocumentReveal />
    </Sequence>
    <Sequence
      name="06 Specific fact"
      from={SCENES.verification.start}
      durationInFrames={SCENES.verification.duration}
    >
      <VerificationReveal />
    </Sequence>
    <Sequence
      name="07 Investigation withdrawal"
      from={SCENES.reverseZoom.start}
      durationInFrames={SCENES.reverseZoom.duration}
    >
      <ReverseZoom />
    </Sequence>
    <Sequence name="08 Brand" from={SCENES.brand.start} durationInFrames={SCENES.brand.duration}>
      <BrandReveal />
    </Sequence>
    <AudioTimeline />
  </AbsoluteFill>
);

export const Cover = () => (
  <AbsoluteFill style={{ fontFamily: 'Inter' }}>
    <BrandReveal still />
  </AbsoluteFill>
);
