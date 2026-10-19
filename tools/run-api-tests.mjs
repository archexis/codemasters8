import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const local = process.platform === 'win32' ? 'backend/.venv/Scripts/python.exe' : 'backend/.venv/bin/python';
const python = process.env.SAQ_PYTHON || (existsSync(local) ? local : 'python');
const result = spawnSync(python, ['-m', 'pytest', 'backend/tests', '-q', ...process.argv.slice(2)], { stdio: 'inherit', windowsHide: true });
if (result.error) console.error('Cannot start Python; create backend/.venv from backend/requirements.lock.txt or set SAQ_PYTHON.');
process.exit(result.status ?? 1);
