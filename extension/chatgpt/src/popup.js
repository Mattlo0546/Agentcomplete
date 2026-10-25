/* global chrome */
const toggle = document.getElementById('toggle'), status = document.getElementById('status');
let enabled = false;
async function send(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(response?.error || 'Reload the extension and try again.');
  return response.data;
}
function render() { toggle.textContent = enabled ? 'Pause suggestions' : 'Enable suggestions'; toggle.setAttribute('aria-pressed', String(enabled)); toggle.disabled = false; }
send({ type: 'settings' }).then(value => { enabled = value.enabled; render(); }).catch(error => { status.textContent = error.message; });
toggle.addEventListener('click', async () => {
  toggle.disabled = true;
  try { enabled = (await send({ type: 'set-enabled', enabled: !enabled })).enabled; }
  catch (error) { status.textContent = error.message; }
  render();
});
document.getElementById('check').addEventListener('click', async event => {
  event.target.disabled = true; status.textContent = 'Checking…';
  try { const health = await send({ type: 'health' }); status.textContent = health.db === 'ok' ? 'Connected. Ready for your next draft.' : 'Backend connected; check its database configuration.'; }
  catch (error) { status.textContent = error.message; }
  finally { event.target.disabled = false; }
});
