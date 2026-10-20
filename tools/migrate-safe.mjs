// The retired reset only changed seed/workspace data, not schema. Record it as
// skipped before applying pending migrations; the replacement seed is supplied
// by 20261020000200 without modifying existing workspaces or result tables.
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
if (args.some(arg => !['--local', '--linked', '--dry-run'].includes(arg)) || (args.includes('--local') && args.includes('--linked'))) {
  throw new Error('Usage: npm run migrate:safe -- [--local | --linked] [--dry-run]');
}
const target = args.includes('--linked') ? '--linked' : '--local';
const commands = [
  ['supabase', 'migration', 'repair', '20261019194027', '--status', 'applied', target],
  ['supabase', 'migration', 'up', '--include-all', target],
];
for (const command of commands) {
  console.log(`npx ${command.join(' ')}`);
  if (args.includes('--dry-run')) continue;
  const result = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', command, {
    stdio: 'inherit', windowsHide: true, shell: process.platform === 'win32',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
