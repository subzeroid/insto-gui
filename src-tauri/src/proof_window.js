(() => {
  'use strict';
  // Main frame, fixed developer script. The production invoke function is untouched.
  const tick = () => new Promise(resolve => setTimeout(resolve, 50));
  const mark = code => { document.title = `insto-proof:${code}`; };
  const check = (condition, code) => { if (!condition) throw code; };
  const run = async () => {
    let input;
    for (let i = 0; i < 4800; i++) {
      input = document.querySelector('#hiker-token');
      if (input && !input.disabled) break;
      await tick();
    }
    check(input && !input.disabled, 'timeout');
    const form = input.closest('form');
    const toggle = form.querySelector('.visibility');
    const submit = form.querySelector('[type="submit"]');
    check(input.type === 'password' && input.labels.length === 1 && input.labels[0].textContent === 'Токен HikerAPI', 'form');
    check(input.autocomplete === 'off' && submit.disabled, 'form');
    toggle.click(); await tick();
    check(input.type === 'text' && toggle.getAttribute('aria-pressed') === 'true' && toggle.getAttribute('aria-label') === 'Скрыть токен', 'visibility');
    toggle.click(); await tick();
    check(input.type === 'password' && toggle.getAttribute('aria-pressed') === 'false', 'visibility');
    for (const value of ['', 'abc', 'bad token', 'токен']) {
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await tick();
      check(submit.disabled, 'validation');
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await tick();
      check(!input.disabled && input.value === value && submit.disabled, 'validation');
    }
    input.value = ''; input.dispatchEvent(new Event('input', { bubbles: true }));
    await tick();
    for (const element of [document.querySelector('.app-shell'), form, input, toggle, submit]) {
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      check(box.width > 0 && box.height > 0 && box.left >= 0 && box.right <= innerWidth + 1 && style.visibility === 'visible' && style.display !== 'none' && Number(style.opacity) > 0, 'geometry');
    }
    check(document.documentElement.scrollWidth <= innerWidth + 1 && form.scrollWidth <= form.clientWidth + 1, 'geometry');
    const invoke = window.__TAURI_INTERNALS__.invoke;
    for (const command of ['configure_setup', 'replace_credentials']) {
      for (const payload of [{ credentials: { token: 'abc' } }, { credentials: { token: 'bad token' } }, { credentials: { token: 7 } }, { credentials: { token: 'abc', extra: true } }]) {
        let rejected = false;
        try { await invoke(command, payload); } catch (error) { rejected = error === 'invalid_token'; }
        check(rejected, 'ipc');
      }
    }
    const response = await invoke('inspect_setup', {});
    check(response.kind === 'profile' && response.data.status === 'unconfigured' && response.data.configured === false && response.data.service_running === false, 'profile');
    mark('ui_ready');
  };
  run().catch(code => mark(['form', 'visibility', 'validation', 'geometry', 'ipc', 'profile', 'timeout'].includes(code) ? code : 'script'));
})();
