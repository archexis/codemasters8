const {spawnSync}=require('node:child_process');
const path=require('node:path');
process.chdir(path.resolve(__dirname,'..'));
const r=spawnSync(process.execPath,['node_modules/@remotion/cli/remotion-cli.js','render','src/index.ts','SAQ-QURYLYS-60s','out/remotion-master.mp4','--codec=h264','--crf=16','--pixel-format=yuv420p','--audio-codec=aac','--concurrency=2'],{stdio:'inherit'});
if(r.status!==0)process.exit(r.status??1);
const final=spawnSync('python',['scripts/finalize.py'],{stdio:'inherit'});
process.exit(final.status??1);
