// Independent regression of S2 isolation. Local temporary users only; no provider call.
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
const config = JSON.parse(readFileSync('supabase/.temp/status.json', 'utf8').replace(/^\uFEFF/, ''));
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(config.API_URL)) throw new Error('Local Supabase required');
if (!config.ANON_KEY || !config.SERVICE_ROLE_KEY) throw new Error('Local credentials missing');
const child = spawn(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', '--config', 'playwright.live.config.ts', 'backup-isolation.spec.ts'], {
  windowsHide: true, stdio: 'inherit', env: {...process.env,
    SAQ_LIVE_SUPABASE_URL: config.API_URL, SAQ_LIVE_SUPABASE_KEY: config.ANON_KEY,
    SAQ_LIVE_SERVICE_KEY: config.SERVICE_ROLE_KEY},
});
child.on('error', e => { console.error(e.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
