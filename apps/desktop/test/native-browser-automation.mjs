import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';

/** @typedef {import('@internal/multi-mind').ResponseReport} ResponseReport */
/** @typedef {{ mode: string, text: string, nativeOpen: boolean }} Submission */
/** @typedef {{ bridge: boolean, error?: string }} Diagnostic */
/** @typedef {{ url: string, webSocketDebuggerUrl: string }} DebugTarget */
/** @typedef {{ result?: { value?: unknown }, exceptionDetails?: { exception?: { description?: string, value?: unknown } } }} ProtocolResult */
/** @typedef {{ resolveResult: (result: ProtocolResult) => void, reject: (error: Error) => void, timer: ReturnType<typeof setTimeout> }} PendingCommand */

// Run against `pnpm dev` started with WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=13223.
// Only this test uses a debug port. Production automation uses the in-process WebView2 API.
async function main() {
  const endpoint = 'http://127.0.0.1:13223';
  const fixtureOrigin = 'http://127.0.0.1';
  /** @type {Submission[]} */
  const submissions = [];
  /** @type {Diagnostic[]} */
  const diagnostics = [];
  const fixture = `<!doctype html><html><head><title>Automation fixture</title>
<style>#send{position:relative}#send::before{content:'';position:absolute;inset:0}</style></head><body>
<button disabled id="disabled">Disabled</button>
<div hidden><button class="busy">Hidden stop indicator</button></div>
<div aria-hidden="true"><button class="busy">Accessibility-hidden stop indicator</button></div>
<div hidden><textarea id="input">Hidden composer</textarea></div>
<button id="send">Send</button><div id="messages"></div>
<script>
const mode = new URL(location.href).searchParams.get('mode');
if (mode === 'cancel') {
  window.__TAURI_INTERNALS__.invoke('guest_message',{message:'__clicked__'})
    .then(() => fetch('/diagnostics',{method:'POST',body:JSON.stringify({bridge:true})}))
    .catch(error => fetch('/diagnostics',{method:'POST',body:JSON.stringify({bridge:false,error:String(error)})}));
}
let input;
if (mode === 'rich') {
  input = document.createElement('div');
  input.contentEditable = 'true'; input.textContent = 'Old draft';
} else {
  input = document.createElement('textarea'); input.value = 'Old draft';
}
input.id = 'input'; input.style.cssText = 'display:block;width:400px;min-height:70px;border:1px solid';
if (mode === 'shadow') {
  const host = document.createElement('div'); document.body.prepend(host);
  host.attachShadow({mode:'open'}).append(input);
} else document.body.prepend(input);
const contents = [...document.body.children].filter(element => element.tagName !== 'SCRIPT');
const wrapper = document.createElement('div');
let deepest = wrapper;
for (let depth = 0; depth < 200; depth += 1) {
  const child = document.createElement('div'); deepest.append(child); deepest = child;
}
document.body.append(wrapper); deepest.append(...contents);
document.querySelector('#send').onclick = () => {
  const text = input.value === undefined ? input.innerText : input.value;
  const user = document.createElement('div'); user.className = 'user'; user.textContent = text;
  const turn = document.createElement('article');
  turn.innerHTML = '<div class="assistant">Streaming</div><button class="busy">Stop</button>';
  document.querySelector('#messages').append(user, turn);
  fetch('/submitted', {method:'POST', body: JSON.stringify({mode,text,nativeOpen:window.open.toString().includes('[native code]')})});
  setTimeout(() => {
    turn.querySelector('.assistant').textContent = 'Complete answer';
    turn.querySelector('.busy').remove();
    turn.insertAdjacentHTML('beforeend','<button class="complete">Copy answer</button>');
  }, mode === 'cancel' ? 5000 : 1200);
};
</script></body></html>`;

  const server = createServer(async (request, response) => {
    if (request.url === '/submitted' || request.url === '/diagnostics') {
      let body = '';
      for await (const chunk of request) body += chunk;
      (request.url === '/submitted' ? submissions : diagnostics).push(JSON.parse(body));
      response.end('ok');
      return;
    }
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(fixture);
  });
  // Existing guest capabilities allow standard HTTP(S) ports only.
  server.listen(80, '127.0.0.1');
  await once(server, 'listening');

  /** @type {WebSocket | undefined} */
  let socket;
  let sequence = 0;
  /** @type {Map<number, PendingCommand>} */
  const pending = new Map();
  let initialized = false;
  const root = resolve(import.meta.dirname, '../../..').replaceAll('\\', '/');
  const apiUrl = `/@fs/${root}/packages/tauri-api/src/index.ts`;
  const domainUrl = `/@fs/${root}/packages/multi-mind/src/index.ts`;

  /** @param {string} method @param {Record<string, unknown>} params @returns {Promise<ProtocolResult>} */
  async function command(method, params) {
    const id = ++sequence;
    const result = new Promise((resolveResult, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Timed out: ${method}`));
      }, 30_000);
      pending.set(id, { resolveResult, reject, timer });
    });
    assert.ok(socket, 'The native app connection must be open.');
    socket.send(JSON.stringify({ id, method, params }));
    return result;
  }

  /** @param {string} expression @returns {Promise<unknown>} */
  async function evaluate(expression) {
    const result = await command('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails)
      throw new Error(
        String(
          result.exceptionDetails.exception?.description ??
            result.exceptionDetails.exception?.value ??
            JSON.stringify(result.exceptionDetails),
        ),
      );
    return result.result?.value;
  }

  try {
    /** @type {DebugTarget | undefined} */
    let host;
    const startupDeadline = Date.now() + 30_000;
    while (!host && Date.now() < startupDeadline) {
      /** @type {DebugTarget[]} */
      const targets = await fetch(`${endpoint}/json/list`)
        .then((response) => response.json())
        .catch(() => []);
      host = targets.find((target) => target.url === 'http://localhost:13222/');
      if (!host) await delay(500);
    }
    assert.ok(host, 'Start the native app with the test debug port first.');
    socket = new WebSocket(host.webSocketDebuggerUrl);
    socket.addEventListener('message', ({ data }) => {
      const message =
        /** @type {{ id?: number, result?: ProtocolResult, error?: { message: string } }} */ (
          JSON.parse(data)
        );
      if (message.id === undefined) return;
      const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id);
      clearTimeout(entry.timer);
      if (message.error) entry.reject(new Error(message.error.message));
      else entry.resolveResult(message.result ?? {});
    });
    await once(socket, 'open');
    await evaluate(`(async () => {
    const api = await import(${JSON.stringify(apiUrl)});
    const domain = await import(${JSON.stringify(domainUrl)});
    const settings = await api.appApi.invoke.getSettings();
    const normal = domain.getActiveWebsites(settings).flatMap(site => {
      const box = [...document.querySelectorAll('[data-website]')].find(el => el.dataset.website === site.id)?.firstElementChild;
      if (!box) return [];
      const {x,y,width,height} = box.getBoundingClientRect();
      return [{websiteId:site.id, url:site.url, bounds:{x,y,width,height}, scripts:[]}];
    });
    const config = await api.appApi.invoke.getGuestConfig();
    const site = {...domain.DEFAULT_WEBSITES[0], id:'automation-smoke', name:'fixture',
      url:${JSON.stringify(fixtureOrigin)}, inputSelector:'#input', buttonSelector:'#send',
      responseSelectors:{responseSelector:'.assistant',turnSelector:'article',busySelector:'.busy',completeSelector:'.complete',userSelector:'.user',errorSelector:'.error'}};
    window.__automationSmoke = {api,domain,normal,config,site,reports:[],messages:[]};
    window.__automationSmoke.stop = api.appApi.events.onGuestMessage(event => {
      if(event.websiteId === site.id) window.__automationSmoke.messages.push(event.message);
      if(event.websiteId === site.id && event.message.startsWith('__response__'))
        window.__automationSmoke.reports.push(JSON.parse(event.message.slice('__response__'.length)));
    });
    await api.appApi.guest.sync([...normal, {websiteId:site.id,url:site.url,bounds:{x:30,y:30,width:600,height:450},scripts:domain.createGuestScripts(site,config)}]);
    return true;
  })()`);
    initialized = true;
    await delay(750);

    for (const mode of ['textarea', 'rich', 'shadow']) {
      await evaluate(`(async () => {
      const state = window.__automationSmoke;
      state.reports = [];
      await state.api.appApi.guest.navigate(state.site.id, ${JSON.stringify(`${fixtureOrigin}/?mode=${mode}`)});
      return true;
    })()`);
      await delay(500);
      const text = `Hello from ${mode}\nQuotes: " ' and Unicode ☃`;
      const disabled =
        await evaluate(`window.__TAURI_INTERNALS__.invoke('guest_automation', {
      websiteId:'automation-smoke', request:{action:{kind:'click',selector:'#disabled'},
      expectedOrigin:${JSON.stringify(fixtureOrigin)},prepareScript:null,
      fallbackScript:'throw new Error("Windows must not execute the JavaScript fallback")'}
    })`);
      assert.equal(disabled, false);
      await evaluate(`(async () => {
      const state = window.__automationSmoke;
      await state.api.appApi.guest.sendPrompt(state.site.id,{website:state.site,prompt:${JSON.stringify(text)},attemptId:${JSON.stringify(mode)}});
      return true;
    })()`);
      /** @type {ResponseReport[]} */
      let reports = [];
      for (let attempt = 0; attempt < 24; attempt += 1) {
        await delay(300);
        reports = /** @type {ResponseReport[]} */ (
          await evaluate('window.__automationSmoke.reports')
        );
        if (
          reports.some((report) =>
            ['completed', 'failed', 'unknown', 'cancelled'].includes(report.status),
          )
        )
          break;
      }
      assert.equal(
        reports.filter((report) => report.status === 'completed').length,
        1,
        JSON.stringify(reports),
      );
      const submitted = submissions.filter((entry) => entry.mode === mode);
      assert.equal(submitted.length, 1, `Send must be clicked exactly once for ${mode}`);
      const submission = submitted[0];
      assert.ok(submission);
      assert.equal(submission.text.replace(/\s+/gu, ''), text.replace(/\s+/gu, ''));
      assert.equal(submission.nativeOpen, true, 'window.open must remain native');
      console.log(
        `PASS ${mode}: native fill, disabled-button guard, single send, response completion, native window.open`,
      );
    }
    const originGuarded =
      await evaluate(`window.__TAURI_INTERNALS__.invoke('guest_automation', {
      websiteId:'automation-smoke', request:{action:{kind:'fill',selector:'#input',text:'Must never be entered'},
      expectedOrigin:'https://wrong-origin.example',prepareScript:null,fallbackScript:''}
    }).then(() => false, error => String(error).includes('changed origin'))`);
    assert.equal(originGuarded, true);
    await evaluate(`(async () => {
      const state = window.__automationSmoke;
      state.reports = [];
      await state.api.appApi.guest.navigate(state.site.id, ${JSON.stringify(`${fixtureOrigin}/?mode=cancel`)});
      return true;
    })()`);
    await delay(500);
    const stopClicked = await evaluate(`(async () => {
      const state = window.__automationSmoke;
      await state.api.appApi.guest.sendPrompt(state.site.id,{website:state.site,prompt:'Cancel this fixture response',attemptId:'cancel'});
      return window.__TAURI_INTERNALS__.invoke('guest_automation', {
        websiteId:state.site.id, request:{action:{kind:'click',selector:'.busy'},
        expectedOrigin:${JSON.stringify(fixtureOrigin)},prepareScript:null,fallbackScript:''}
      });
    })()`);
    assert.equal(
      stopClicked,
      true,
      JSON.stringify(await evaluate('window.__automationSmoke.messages')),
    );
    await delay(6500);
    const cancelled = /** @type {ResponseReport[]} */ (
      await evaluate('window.__automationSmoke.reports')
    );
    assert.ok(
      cancelled.some((report) => report.status === 'cancelled'),
      JSON.stringify({
        cancelled,
        diagnostics,
        messages: await evaluate('window.__automationSmoke.messages'),
      }),
    );
    assert.equal(
      cancelled.some((report) => report.status === 'completed'),
      false,
    );
    assert.deepEqual(diagnostics, [{ bridge: true }]);
    console.log('PASS origin guard and native Stop click cancellation');
    const audit = await evaluate(`(async () => {
    const state = window.__automationSmoke;
    const source = state.domain.createGuestScripts(state.site,state.config).join('\\n');
    return {startupListeners:state.domain.createGuestScripts(state.site,state.config).length,
      queryHelper:source.includes('findInDocumentOrShadowRoots'),observer:source.includes('MutationObserver'),
      timer:source.includes('setInterval'),popupOverride:source.includes('window.open =')};
  })()`);
    assert.deepEqual(audit, {
      startupListeners: 2,
      queryHelper: false,
      observer: false,
      timer: false,
      popupOverride: false,
    });
    console.log(`PASS startup-script audit: ${JSON.stringify(audit)}`);
  } finally {
    if (initialized && socket?.readyState === WebSocket.OPEN) {
      await evaluate(`(async () => {
      const state = window.__automationSmoke;
      state.api.appApi.guest.cancelPrompt(state.site.id);
      state.stop();
      await state.api.appApi.guest.sync(state.normal);
      delete window.__automationSmoke;
      return true;
    })()`).catch((error) => console.error('Smoke-test cleanup failed:', error.message));
    }
    socket?.close();
    server.close();
    server.closeAllConnections();
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new Error('Test ended'));
    }
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
