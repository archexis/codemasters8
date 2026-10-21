import { spawnSync } from 'node:child_process';
import { existsSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const master = resolve(root, 'out/remotion-master.mp4');
const final = resolve(root, 'out/saq-qurylus-teaser.mp4');
const run = (executable, args) => {
  const result = spawnSync(executable, args, { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
};

if (process.argv.includes('--normalize-existing')) {
  if (!existsSync(master)) renameSync(final, master);
} else {
  run(process.execPath, [
    'node_modules/@remotion/cli/remotion-cli.js',
    'render',
    'src/index.ts',
    'SAQQurylusTeaser',
    master,
    '--codec=h264',
    '--pixel-format=yuv420p',
    '--audio-codec=aac',
    '--crf=16',
    '--audio-bitrate=320k',
    '--concurrency=4',
  ]);
}

// Remotion 4.0.537's JPEG path may signal full-range YUV and retain AAC padding.
// Explicitly convert color levels/matrix and trim the final mux to the delivery spec.
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
  master,
  '-map',
  '0:v:0',
  '-map',
  '0:a:0',
  '-vf',
  'scale=in_range=full:out_range=limited:in_color_matrix=bt601:out_color_matrix=bt709,format=yuv420p',
  '-c:v',
  'libx264',
  '-preset',
  'slow',
  '-crf',
  '15',
  '-pix_fmt',
  'yuv420p',
  '-color_range',
  'tv',
  '-colorspace',
  'bt709',
  '-color_primaries',
  'bt709',
  '-color_trc',
  'bt709',
  '-video_track_timescale',
  '30000',
  '-af',
  'atrim=duration=15,asetpts=PTS-STARTPTS',
  '-c:a',
  'aac',
  '-b:a',
  '320k',
  '-ar',
  '48000',
  '-ac',
  '2',
  '-t',
  '15',
  '-movflags',
  '+faststart',
  '-metadata',
  'comment=Cinematic Tension 002 by Sascha Ende; https://ende.app/en/song/12249-cinematic-tension-002; CC BY 4.0 https://creativecommons.org/licenses/by/4.0/; excerpt, fades and mix edited.',
  final,
]);
console.log('Delivery MP4:', final);
