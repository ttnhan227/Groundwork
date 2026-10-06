import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';

const commit = execFileSync('git', ['rev-parse', 'HEAD'], {encoding:'utf8'}).trim();
if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('Invalid deployment commit');
writeFileSync('dist/deployment.json', JSON.stringify({commit}) + '\n');
