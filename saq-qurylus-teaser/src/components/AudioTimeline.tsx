import { Audio } from '@remotion/media';
import { staticFile } from 'remotion';
import music from '../config/music.json';

/** Offline, seeded synthesis. All three stems are sample-aligned, 48 kHz stereo. */
export const AudioTimeline = () => (
  <>
    <Audio
      name="Cinematic Tension 002 — Sascha Ende (CC BY 4.0)"
      src={staticFile('audio/music-edit.wav')}
      volume={music.gains.music}
    />
    <Audio
      name="Industrial room and tonal tension"
      src={staticFile('audio/atmosphere.wav')}
      volume={music.gains.atmosphere}
    />
    <Audio
      name="Pulses and precision mechanics"
      src={staticFile('audio/mechanics.wav')}
      volume={music.gains.mechanics}
    />
    <Audio
      name="Selection, verification, reverse and brand impacts"
      src={staticFile('audio/impacts.wav')}
      volume={music.gains.impacts}
    />
  </>
);
