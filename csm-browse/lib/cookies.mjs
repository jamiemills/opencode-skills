const ONETRUST_SELECTORS = [
  '#onetrust-banner-sdk',
  '#onetrust-consent-sdk',
  '.onetrust-pc-dark-filter',
  '.ot-sdk-container',
];

const ACCEPT_TEXTS = [
  'accept all', 'accept', 'agree', 'allow all', 'allow',
  'ok', 'yes', 'i accept', 'agree & proceed', 'continue',
];

export async function dismissCookies(client, sessionId) {
  // Pattern 1: OneTrust — remove banner/consent elements
  for (const sel of ONETRUST_SELECTORS) {
    try {
      await client.send('Runtime.evaluate', {
        expression: `(function(){var e=document.querySelector('${sel}');if(e){e.remove();return'removed'}return'not found'})()`,
        returnByValue: true
      }, sessionId);
    } catch {}
  }

  // Pattern 2: Sourcepoint — hide parent of consent iframe
  try {
    await client.send('Runtime.evaluate', {
      expression: `(function(){var e=document.querySelector('iframe[src*="sourcepoint"],iframe[src*="privacy-mgmt"]');if(e){var p=e;while(p&&p!==document.body){p.style.display='none';p=p.parentElement}return'hidden'}return'not found'})()`,
      returnByValue: true
    }, sessionId);
  } catch {}

  // Pattern 3: Generic — click visible accept buttons
  try {
    const { result } = await client.send('Runtime.evaluate', {
      expression: `(function(){var texts=[${ACCEPT_TEXTS.map(t => `"${t}"`).join(',')}];var buttons=document.querySelectorAll('button,[role="button"],a.button');for(var i=0;i<buttons.length;i++){var b=buttons[i];var t=b.textContent.toLowerCase().trim();var r=b.getBoundingClientRect();if(r.width>0&&r.height>0&&r.top<window.innerHeight&&texts.some(function(x){return t===x||t.includes(x)})){b.click();return'clicked: '+t.substring(0,30)} }return'no match'})()`,
      returnByValue: true
    }, sessionId);
    if (result && result.value && result.value !== 'no match') {
      await new Promise(r => setTimeout(r, 1000)); // let click settle
    }
  } catch {}

  // Pattern 4: Fixed privacy overlays — remove position:fixed elements mentioning privacy
  try {
    await client.send('Runtime.evaluate', {
      expression: `(function(){var all=document.querySelectorAll('*');for(var i=0;i<all.length;i++){var e=all[i];var s=getComputedStyle(e);if((s.position==='fixed'||s.position==='sticky')&&e.offsetHeight>0&&e.offsetHeight<window.innerHeight){var t=e.textContent.toLowerCase();if(t.includes('privacy')||t.includes('consent')||t.includes('cookie')||t.includes('data')){e.remove()}}}})()`,
      returnByValue: true
    }, sessionId);
  } catch {}
}
