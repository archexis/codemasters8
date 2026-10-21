import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const final = resolve(root, 'out/saq-qurylus-teaser.mp4');
const original = resolve(root, 'out/saq-qurylus-teaser-original-sfx.mp4');
const audio = resolve(root, 'out/saq-qurylus-music-mix.wav');
const temporary = resolve(root, 'out/music-remux.mp4');
const run = (exe, args) => {
  const result = spawnSync(exe, args, { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
};
if (!existsSync(original)) copyFileSync(final, original);
if (!process.argv.includes('--reuse-audio')) {
  run(process.execPath, [
    'node_modules/@remotion/cli/remotion-cli.js',
    'render',
    'src/index.ts',
    'SAQQurylusTeaser',
    audio,
    '--codec=wav',
  ]);
}
const ffmpeg =
  process.platform === 'win32'
    ? resolve(root, 'node_modules/@remotion/compositor-win32-x64-msvc/ffmpeg.exe')
    : 'ffmpeg';
run(ffmpeg, [
  '-hide_banner',
  '-loglevel',
  'warning',
  '-y',
  '-i',
  original,
  '-i',
  audio,
  '-map',
  '0:v:0',
  '-map',
  '1:a:0',
  '-c:v',
  'copy',
  '-c:a',
  'aac',
  '-b:a',
  '320k',
  '-ar',
  '48000',
  '-ac',
  '2',
  '-af',
  'atrim=duration=15,asetpts=PTS-STARTPTS',
  '-t',
  '15',
  '-movflags',
  '+faststart',
  '-metadata',
  'comment=Cinematic Tension 002 by Sascha Ende; https://ende.app/en/song/12249-cinematic-tension-002; CC BY 4.0 https://creativecommons.org/licenses/by/4.0/; excerpt, fades and mix edited.',
  temporary,
]);
renameSync(temporary, final);
copyFileSync(final, resolve(root, 'out/saq-qurylus-teaser-with-music.mp4'));
console.log('Applied Cinematic Tension 002; original video stream copied without re-encoding.');
