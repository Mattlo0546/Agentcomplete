const fs = require('node:fs/promises');
const path = require('node:path');
const frontend = path.resolve(__dirname, '../../../frontend');
const { test, expect } = require(require.resolve('@playwright/test', { paths: [frontend] }));
const extension = path.resolve(__dirname, '..');

test('native composer ghost suffix, keyboard, lifecycle and centered Skill Issue launcher', async ({ page }, info) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const calls = [];
    window.__nativeCalls = calls;
    window.__nativeEnter = 0;
    window.__nativeTab = [];
    const saved = {};
    window.chrome = {
      runtime: {
        id: 'offline-native',
        getURL: name => 'https://fixture.test/' + name,
        onMessage: { addListener() {}, removeListener() {} },
        sendMessage: async message => {
          calls.push(message);
          if (message.path === '/v1/settings') return { status: 200, data: { trigger_delay_ms: 60, autocomplete_enabled: true, questions_enabled: true, max_options: 3 } };
          if (message.path === '/v1/outcomes') return { status: 204, data: null };
          if (message.path !== '/v1/enhance') return { status: 200, data: {} };
          const body = message.body;
          if (body.prompt === 'A slow original draft') await new Promise(resolve => setTimeout(resolve, 500));
          if (body.prompt === 'Continue retry policy') await new Promise(resolve => setTimeout(resolve, 350));
          const base = { schema_version: 1, request_id: body.request_id, prompt_revision: body.prompt_revision };
          const suffixes = {
            'Retry with backoff': ' and jitter.',
            'Continue retry policy': ' with exponential backoff and jitter.',
            'Write a useful prompt': ' with clear constraints.',
            'A slow original draft': ' stale suffix.',
            'Explain the API': ' in plain language.',
            'Typed during composition': ' with examples.',
            'Summarize the implementation': ' with a clear implementation plan, bounded retries with exponential backoff and jitter, and explicit timeout and cancellation behavior. Preserve existing interfaces, retry only transient idempotent failures, honor Retry-After, and cover success, exhausted retries, and non-retryable errors with focused tests.',
          };
          return { status: 200, data: suffixes[body.prompt] ? { ...base, type: 'autocomplete', insert_at: body.prompt.length, text: suffixes[body.prompt] } : { ...base, type: 'none' } };
        },
      },
      storage: { local: { get: async key => ({ [key]: saved[key] }), set: async data => Object.assign(saved, data) }, onChanged: { addListener() {}, removeListener() {} } },
    };
    document.addEventListener('keydown', event => {
      if (event.key === 'Tab') setTimeout(() => window.__nativeTab.push({ shift: event.shiftKey, prevented: event.defaultPrevented }), 0);
    }, true);
    document.addEventListener('keydown', event => {
      if (event.key === 'Enter' && event.target.matches('[data-composer-markdown]')) {
        if (!event.defaultPrevented) window.__nativeEnter++;
        event.preventDefault();
      }
    });
  });
  await page.route('https://chatgpt.com/**', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><style>
  body{font:16px/26px system-ui;margin:24px;background:#fff;color:#0d0d0d}main{max-width:760px;margin:30px auto}#composer-wrap{position:relative}
  [data-composer-body]{display:flex;border:1px solid #ddd;border-radius:26px;background:white}
  [data-composer-footer-responsive]{display:grid;width:100%;padding:8px;grid-template-columns:36px minmax(0,1fr) 154px;gap:8px;align-items:center}
  [data-composer-input]{display:flow-root;min-width:0}
  [data-composer-input-layout]{display:flex;overflow:hidden;line-height:26px;margin:5px 0;min-width:0}
  [data-composer-input-layout=single-line]{height:1lh}
  [data-composer-input-layout=multi-line]{height:auto}
  [contenteditable]{outline:none;white-space:pre-wrap;overflow-wrap:anywhere;padding:0;border:0;min-width:0;width:100%;font:inherit;overflow:hidden}
  [data-composer-input-layout]>[contenteditable]{height:100%!important}
  [contenteditable] p{margin:0}#attach,#send{height:36px;min-height:36px}#right-controls{display:flex;align-items:center;justify-content:flex-end;gap:8px;height:36px}#send{width:36px;border-radius:999px}#attach{width:36px;border-radius:999px}
  @media(max-width:600px){[data-composer-input]{grid-column:1/-1;grid-row:1}#attach{grid-column:1;grid-row:2}#right-controls{grid-column:3;grid-row:2}}
  </style></head><body><main><h1>Native composer fixture</h1><div id="composer-wrap"><div data-composer-body data-composer-layout="single-line"><div data-composer-footer-responsive data-composer-layout="single-line"><button id="attach" aria-label="Add files">+</button><div data-composer-input data-composer-layout="single-line"><div data-composer-input-layout="single-line" data-rich-text-layout="single-line"><div contenteditable="true" data-composer-markdown class="ProseMirror" role="textbox" aria-label="Ask ChatGPT"><p><br></p></div></div></div><div id="right-controls"><span>Pro</span><button id="send">Send</button></div></div></div></div></main><script>
  // Emulate the host's own committed-text autosize. Ghost text never enters this editor.
  document.addEventListener('input', event => {
    const editor=event.target.closest('[data-composer-markdown]');if(!editor)return;
    const previous=editor.style.getPropertyValue('height'),priority=editor.style.getPropertyPriority('height');
    editor.style.setProperty('height','auto','important');const height=editor.scrollHeight;
    if(previous)editor.style.setProperty('height',previous,priority);else editor.style.removeProperty('height');
    const wrapper=editor.closest('[data-composer-input-layout]');
    wrapper.dataset.composerInputLayout=height>27?'multi-line':'single-line';
    wrapper.dataset.richTextLayout=wrapper.dataset.composerInputLayout;
  });
  </script></body></html>` }));
  await page.goto('https://chatgpt.com/');
  await page.addScriptTag({ content: await fs.readFile(path.join(extension, 'dist/workspace-host.js'), 'utf8') });
  await page.addScriptTag({ content: await fs.readFile(path.join(extension, 'native-autocomplete.js'), 'utf8') });
  await page.addScriptTag({ content: await fs.readFile(path.join(extension, 'content.js'), 'utf8') });
  const editor = page.getByRole('textbox', { name: 'Ask ChatGPT', exact: true });
  const ghost = page.getByTestId('native-ghost-text');
  const launcher = page.getByRole('button', { name: 'Skill Issue', exact: true });
  await expect(launcher).toBeVisible();
  const [buttonBox, chatBox] = await Promise.all([launcher.boundingBox(), page.locator('[data-composer-body]').boundingBox()]);
  expect(Math.abs(buttonBox.x + buttonBox.width / 2 - chatBox.x - chatBox.width / 2)).toBeLessThan(2);
  expect(buttonBox.y).toBeGreaterThanOrEqual(chatBox.y + chatBox.height);
  expect(buttonBox.y - chatBox.y - chatBox.height).toBeLessThan(20);
  await expect(page.getByText('Draft updated', { exact: true })).toHaveCount(0);

  await editor.fill('Retry with backoff');
  await expect(ghost).toContainText('and jitter.');
  await expect(ghost).toBeVisible();
  await expect(editor).toHaveText('Retry with backoff');
  expect(await ghost.evaluate(el => el.closest('[contenteditable]') === null)).toBe(true);
  const ghostColor = await ghost.evaluate(el => getComputedStyle(el).color);
  expect(ghostColor).not.toBe('rgb(13, 13, 13)');
  const channels = ghostColor.match(/\d+/g).map(Number);
  expect(channels[0]).toBe(channels[1]); expect(channels[1]).toBe(channels[2]);
  await expect(page.getByRole('dialog', { name: 'Prompt Enhance workspace', exact: true })).toBeHidden();
  await editor.press('Tab');
  await expect(editor).toHaveText('Retry with backoff and jitter.');
  await expect(ghost).not.toBeVisible();
  await editor.press('Tab');
  await expect(editor).toHaveText('Retry with backoff and jitter.');
  await expect.poll(() => page.evaluate(() => window.__nativeTab.length)).toBeGreaterThanOrEqual(2);
  const tabs = await page.evaluate(() => window.__nativeTab.slice(-2));
  expect(tabs[0].prevented).toBe(true);
  expect(tabs[1].prevented).toBe(false);
  expect(await page.evaluate(() => window.__nativeEnter)).toBe(0);

  await editor.fill('Write a useful prompt');
  await expect(ghost).toContainText('with clear constraints.');
  await editor.press('Shift+Tab');
  await expect(editor).toHaveText('Write a useful prompt');
  await expect.poll(() => page.evaluate(() => window.__nativeTab.at(-1)?.shift)).toBe(true);
  expect(await page.evaluate(() => window.__nativeTab.at(-1).prevented)).toBe(false);
  await editor.focus();
  await editor.press('End');
  // Focus/caret restoration may require fresh input to request again.
  await editor.fill('Explain the API');
  await expect(ghost).toContainText('in plain language.');
  await editor.press('Escape');
  await expect(ghost).not.toBeVisible();
  await expect(editor).toHaveText('Explain the API');
  await editor.press('Enter');
  expect(await page.evaluate(() => window.__nativeEnter)).toBe(1);
  await expect(editor).toHaveText('Explain the API');

  // A moved caret cannot accept an end-of-draft suggestion.
  await editor.fill('Retry with backoff');
  await expect(ghost).toContainText('and jitter.');
  await editor.press('Home');
  await editor.press('Tab');
  await expect(editor).toHaveText('Retry with backoff');

  // The original webapp reducer adopts the remaining suffix from a compatible in-flight request.
  await editor.fill('Continue retry policy');
  await expect.poll(() => page.evaluate(() => window.__nativeCalls.some(call => call.body?.prompt === 'Continue retry policy'))).toBe(true);
  await editor.pressSequentially(' with');
  await expect(ghost).toContainText('exponential backoff and jitter.');
  await expect(editor).toHaveText('Continue retry policy with');
  await editor.press('Tab');
  await expect(editor).toHaveText('Continue retry policy with exponential backoff and jitter.');

  // Old network results cannot appear after editing the snapshot.
  await editor.fill('A slow original draft');
  await expect.poll(() => page.evaluate(() => window.__nativeCalls.some(call => call.body?.prompt === 'A slow original draft'))).toBe(true);
  await editor.fill('A changed draft with no suggestion');
  await page.waitForTimeout(600);
  await expect(ghost).not.toBeVisible();
  await editor.press('Tab');
  await expect(editor).toHaveText('A changed draft with no suggestion');

  // Full server chunks must wrap inside the native composer; presentation must not truncate them.
  const longPrompt = 'Summarize the implementation';
  const fullSuffix = ' with a clear implementation plan, bounded retries with exponential backoff and jitter, and explicit timeout and cancellation behavior. Preserve existing interfaces, retry only transient idempotent failures, honor Retry-After, and cover success, exhausted retries, and non-retryable errors with focused tests.';
  expect(fullSuffix.length).toBeLessThanOrEqual(400);
  await editor.fill(longPrompt);
  const composer = page.locator('[data-composer-body]');
  const baselineStyles = await page.locator('[data-composer-body], [data-composer-footer-responsive], [data-composer-input], [data-composer-input-layout], [data-composer-markdown]').evaluateAll(nodes => nodes.map(node => node.getAttribute('style') || ''));
  const collapsedBody = await composer.boundingBox();
  await expect(ghost).toHaveText(fullSuffix);
  await expect(ghost).toBeVisible();
  await expect(editor).toHaveText(longPrompt);
  const expanded = await composer.boundingBox();
  expect(expanded.height).toBeGreaterThan(collapsedBody.height + 25);
  const boxes = await ghost.evaluate(el => {const range=document.createRange();range.selectNodeContents(el);return Array.from(range.getClientRects(),r=>({x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height})).filter(r=>r.width>0&&r.height>0);});
  expect(boxes.length).toBeGreaterThan(1);
  expect(Math.max(...boxes.map(box => box.bottom))).toBeLessThanOrEqual(expanded.y + expanded.height + 1);
  expect(Math.min(...boxes.map(box => box.x))).toBeGreaterThanOrEqual(expanded.x - 1);
  expect(Math.max(...boxes.map(box => box.right))).toBeLessThanOrEqual(expanded.x + expanded.width + 1);
  const controls = await page.locator('#attach, #right-controls').evaluateAll(nodes=>nodes.map(node=>{const r=node.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};}));
  for (const box of boxes) for (const control of controls) {
    const overlaps=box.x<control.right-1&&box.right>control.left+1&&box.y<control.bottom-1&&box.bottom>control.top+1;
    expect(overlaps).toBe(false);
  }
  await page.screenshot({path:`/tmp/skill-issue-full-chunk-${info.project.name}.png`,animations:'disabled'});
  await editor.press('Escape');
  await expect(ghost).not.toBeVisible();
  await expect(editor).toHaveText(longPrompt);
  await expect.poll(()=>page.locator('[data-composer-body], [data-composer-footer-responsive], [data-composer-input], [data-composer-input-layout], [data-composer-markdown]').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('style') || ''))).toEqual(baselineStyles);
  const afterEscape=await composer.boundingBox();expect(afterEscape.height).toBeCloseTo(collapsedBody.height,0);
  // Fresh input restores the complete suggestion, and one Tab accepts it all.
  await editor.fill(longPrompt+' ');await editor.fill(longPrompt);
  await expect(ghost).toHaveText(fullSuffix);await expect(ghost).toBeVisible();
  await editor.press('Tab');
  await expect(editor).toHaveText(longPrompt+fullSuffix);
  await expect(ghost).not.toBeVisible();
  await editor.press('Tab');await expect(editor).toHaveText(longPrompt+fullSuffix);
  expect(await page.evaluate(()=>window.__nativeEnter)).toBe(1);
  // Blur must remove the reservation without modifying the unaccepted prompt.
  await editor.fill(longPrompt);await expect(ghost).toHaveText(fullSuffix);await expect(ghost).toBeVisible();
  await page.getByRole('button',{name:'Send',exact:true}).focus();
  await expect(ghost).not.toBeVisible();await expect(editor).toHaveText(longPrompt);
  const afterBlur=await composer.boundingBox();expect(afterBlur.height).toBeCloseTo(collapsedBody.height,0);

  await editor.focus();
  await editor.dispatchEvent('compositionstart');
  const beforeComposition = await page.evaluate(() => window.__nativeCalls.filter(call => call.path === '/v1/enhance').length);
  await editor.fill('Typed during composition');
  await page.waitForTimeout(180);
  expect(await page.evaluate(() => window.__nativeCalls.filter(call => call.path === '/v1/enhance').length)).toBe(beforeComposition);
  await editor.press('Tab');
  await expect(editor).toHaveText('Typed during composition');
  await editor.focus();
  await editor.dispatchEvent('compositionend');
  await editor.press('End');
  await expect(ghost).toContainText('with examples.');
  const requests = await page.evaluate(() => window.__nativeCalls.filter(call => call.path === '/v1/enhance'));
  expect(requests.length).toBeGreaterThan(0);
  expect(requests.every(call => call.body.autocomplete_only === true)).toBe(true);
  expect(errors).toEqual([]);
  await page.screenshot({ path: `/tmp/skill-issue-native-${info.project.name}.png`, animations: 'disabled' });
});
