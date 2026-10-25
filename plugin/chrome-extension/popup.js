const status = document.getElementById('status');
document.getElementById('workspace').addEventListener('click',async () => {
  try {
    const [tab] = await chrome.tabs.query({active:true,currentWindow:true});
    if (!tab?.id) throw new Error();
    const reply = await chrome.tabs.sendMessage(tab.id,{type:'open-workspace'});
    if (!reply?.ok) throw new Error();
    window.close();
  } catch {status.textContent = 'Open ChatGPT, then click Skill Issue below the composer.';}
});
document.getElementById('open').addEventListener('click',() => chrome.tabs.create({url:'https://chatgpt.com/'}));
chrome.runtime.sendMessage({type:'health'}).then(data => {
  status.textContent = data?.ready ? `Connected · ${data.model}` : data?.error || 'Start the local OpenAI bridge to connect.';
}).catch(() => {status.textContent='Start the local OpenAI bridge and reload the extension.';});
