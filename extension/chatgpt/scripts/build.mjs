import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
const root = fileURLToPath(new URL('..', import.meta.url));
const out = join(root, 'dist');
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await cp(join(root, 'manifest.json'), join(out, 'manifest.json'));
for (const file of ['core.js', 'editor.js', 'background.js', 'popup.js', 'popup.html', 'popup.css']) await cp(join(root, 'src', file), join(out, file));
const css = await readFile(join(root, 'src/content.css'), 'utf8');
const content = await readFile(join(root, 'src/content.js'), 'utf8');
const ghost = await readFile(join(root, 'src/ghost.js'), 'utf8');
// Keep the existing entry points and permissions. Chrome caches installed
// content scripts, so reload the extension before refreshing existing tabs.
await writeFile(join(out, 'content.js'), ghost + '\n' + content.replace('/* BUILD_CSS */ ""', JSON.stringify(css)));
if (process.argv.includes('--zip')) {
  await rm(join(root, 'prompt-enhance-chatgpt.zip'), { force: true });
  execFileSync('/usr/bin/zip', ['-q', '-r', join(root, 'prompt-enhance-chatgpt.zip'), '.'], { cwd: out });
}
console.log(out);
