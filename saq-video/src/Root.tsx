import {Composition} from 'remotion';
import {ProductFilm} from './Film';

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition id="SAQ-QURYLYS-60s" component={ProductFilm} durationInFrames={1800} fps={30} width={1920} height={1080}/>
    </>
  );
};
