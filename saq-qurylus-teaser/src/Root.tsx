import { Composition, Still, staticFile } from 'remotion';
import { loadFont } from '@remotion/fonts';
import { SAQQurylusTeaser, Cover } from './SAQQurylusTeaser';
import { ASSETS } from './config/assets';

loadFont({ family: 'Inter', url: staticFile(ASSETS.font), weight: '100 900' });

export const RemotionRoot = () => (
  <>
    <Composition
      id="SAQQurylusTeaser"
      component={SAQQurylusTeaser}
      durationInFrames={450}
      fps={30}
      width={1920}
      height={1080}
    />
    <Still id="SAQQurylusCover" component={Cover} width={1920} height={1080} />
  </>
);
