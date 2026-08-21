const ONETRUST_SELECTORS = [
  "#onetrust-banner-sdk",
  "#onetrust-consent-sdk",
  ".onetrust-pc-dark-filter",
  ".ot-sdk-container",
];

const ACCEPT_TEXTS = [
  "accept all",
  "accept",
  "agree",
  "allow all",
  "allow",
  "ok",
  "yes",
  "i accept",
  "agree & proceed",
  "continue",
];

const WALL_SRC_RE = /cmpv2|sourcepoint|privacy-mgmt|consent|didomi|onetrust|cookielaw|tcf|sp-prod/i;

export async function dismissCookies(client, sessionId) {
  // Pattern 1: OneTrust — remove banner/consent elements
  for (const sel of ONETRUST_SELECTORS) {
    try {
      await client.send(
        "Runtime.evaluate",
        {
          expression: `(function(){var e=document.querySelector('${sel}');if(e){e.remove();return'removed'}return'not found'})()`,
          returnByValue: true,
        },
        sessionId,
      );
    } catch {}
  }

  // Pattern 2: Sourcepoint — hide parent of consent iframe
  try {
    await client.send(
      "Runtime.evaluate",
      {
        expression: `(function(){var e=document.querySelector('iframe[src*="sourcepoint"],iframe[src*="privacy-mgmt"]');if(e){var p=e;while(p&&p!==document.body){p.style.display='none';p=p.parentElement}return'hidden'}return'not found'})()`,
        returnByValue: true,
      },
      sessionId,
    );
  } catch {}

  // Pattern 3: Generic — click visible accept buttons
  try {
    const { result } = await client.send(
      "Runtime.evaluate",
      {
        expression: `(function(){var texts=[${ACCEPT_TEXTS.map((t) => `"${t}"`).join(",")}];var buttons=document.querySelectorAll('button,[role="button"],a.button');for(var i=0;i<buttons.length;i++){var b=buttons[i];var t=b.textContent.toLowerCase().trim();var r=b.getBoundingClientRect();if(r.width>0&&r.height>0&&r.top<window.innerHeight&&texts.some(function(x){return t===x||t.includes(x)})){b.click();return'clicked: '+t.substring(0,30)} }return'no match'})()`,
        returnByValue: true,
      },
      sessionId,
    );
    if (result && result.value && result.value !== "no match") {
      await new Promise((r) => setTimeout(r, 1000)); // let click settle
    }
  } catch {}

  // Pattern 4: Fixed privacy overlays — remove position:fixed elements mentioning privacy
  try {
    await client.send(
      "Runtime.evaluate",
      {
        expression: `(function(){var all=document.querySelectorAll('*');for(var i=0;i<all.length;i++){var e=all[i];var s=getComputedStyle(e);if((s.position==='fixed'||s.position==='sticky')&&e.offsetHeight>0&&e.offsetHeight<window.innerHeight){var t=e.textContent.toLowerCase();if(t.includes('privacy')||t.includes('consent')||t.includes('cookie')||t.includes('data')){e.remove()}}}})()`,
        returnByValue: true,
      },
      sessionId,
    );
  } catch {}

  // Pattern 5: full-viewport consent-wall iframes (Sourcepoint cmpv2 and similar)
  try {
    const { result: found } = await client.send(
      "Runtime.evaluate",
      {
        expression: `(function(){
        var re=new RegExp(${JSON.stringify(WALL_SRC_RE.source)},'i');
        var out=[];
        var ifs=document.querySelectorAll('iframe');
        for(var i=0;i<ifs.length;i++){
          var f=ifs[i];
          var s=(f.src||'');
          var r=f.getBoundingClientRect();
          if(r.width>=window.innerWidth*0.9&&r.height>=window.innerHeight*0.9&&re.test(s)){out.push(s)}
        }
        return out;
      })()`,
        returnByValue: true,
      },
      sessionId,
    );
    const walls = (found && found.value) || [];
    if (walls.length === 0) return;
  } catch {
    return;
  }

  // Pattern 6: try clicking an accept button inside the wall's own execution context
  let clicked = false;
  const contexts = new Map();
  const onCtx = (p) => {
    const c = p.context;
    if (c && c.auxData && c.auxData.frameId) contexts.set(c.auxData.frameId, c.id);
  };
  client.on("Runtime.executionContextCreated", onCtx);
  // F-065: the off() must run even when any intermediate CDP call rejects,
  // or the listener leaks on the daemon's long-lived client.
  try {
    try {
      try {
        await client.send("Runtime.enable", {}, sessionId);
      } catch {}
      try {
        await client.send("Page.enable", {}, sessionId);
      } catch {}
      await new Promise((r) => setTimeout(r, 300));

      const { frameTree } = await client.send("Page.getFrameTree", {}, sessionId);
      const frames = [];
      const walk = (n) => {
        frames.push(n.frame);
        (n.childFrames || []).forEach(walk);
      };
      walk(frameTree);
      const wallFrame = frames.find((f) => WALL_SRC_RE.test(f.url));
      const ctxId = wallFrame && contexts.get(wallFrame.id);
      if (ctxId) {
        const { result } = await client.send(
          "Runtime.evaluate",
          {
            expression: `(function(){
            var texts=[${ACCEPT_TEXTS.map((t) => `"${t}"`).join(",")}];
            var all=document.querySelectorAll('button,a,[role="button"]');
            for(var i=0;i<all.length;i++){
              var b=all[i];
              var t=(b.textContent||'').toLowerCase().trim();
              var r=b.getBoundingClientRect();
              if(r.width>0&&r.height>0&&texts.some(function(x){return t===x||t.includes(x)})){
                b.click(); return 'clicked';
              }
            }
            return 'no match';
          })()`,
            returnByValue: true,
            contextId: ctxId,
          },
          sessionId,
        );
        clicked = !!(result && result.value === "clicked");
      }
    } finally {
      client.off("Runtime.executionContextCreated", onCtx);
    }
  } catch {}
  if (clicked) {
    await new Promise((r) => setTimeout(r, 1000));
  }

  // Pattern 7: fallback — remove any remaining full-viewport wall iframes and unlock scroll
  try {
    await client.send(
      "Runtime.evaluate",
      {
        expression: `(function(){
        var re=new RegExp(${JSON.stringify(WALL_SRC_RE.source)},'i');
        var n=0;
        var ifs=document.querySelectorAll('iframe');
        for(var i=0;i<ifs.length;i++){
          var f=ifs[i];
          var s=(f.src||'');
          var r=f.getBoundingClientRect();
          if(r.width>=window.innerWidth*0.9&&r.height>=window.innerHeight*0.9&&re.test(s)){
            f.remove(); n++;
          }
        }
        if(n>0){
          document.body.style.overflow='visible';
          document.documentElement.style.overflow='auto';
          document.body.style.position='static';
          document.documentElement.style.position='static';
        }
        return 'removed='+n;
      })()`,
        returnByValue: true,
      },
      sessionId,
    );
  } catch {}
}
