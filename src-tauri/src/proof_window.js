(() => {
  'use strict';
  // Main frame, fixed developer script. The production invoke function is untouched.
  const proof = globalThis.__INSTO_PROOF__ ?? { staged: false, home: null };
  const tick = () => new Promise(resolve => setTimeout(resolve, 50));
  const mark = code => { document.title = `insto-proof:${code}`; };
  const check = (condition, code) => { if (!condition) throw code; };
  const call = (command, payload) => window.__TAURI_INTERNALS__.invoke(command, payload);
  const until = async (found, code, end) => {
    while (Date.now() < end) {
      check(!document.querySelector('.loading-panel [role="alert"]'), 'initialization_failed');
      const value = found();
      if (value) return value;
      await tick();
    }
    throw code;
  };
  const poll = async (probe, ok, code, end) => {
    while (Date.now() < end) {
      const value = await probe();
      if (ok(value)) return value;
      await tick();
    }
    throw code;
  };
  const press = async (selector, end) => {
    const button = await until(() => { const el = document.querySelector(selector); return el && !el.disabled ? el : null; }, 'timeout', end);
    button.click();
    await tick();
  };
  const facts = () => call('inspect_service', {});
  const onboarding = async (end) => {
    const input = await until(() => { const el = document.querySelector('#hiker-token'); return el && !el.disabled ? el : null; }, 'timeout', end);
    mark('form_ready');
    await tick();
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
    for (const command of ['configure_setup', 'replace_credentials']) {
      for (const payload of [{ credentials: { token: 'abc' } }, { credentials: { token: 'bad token' } }, { credentials: { token: 7 } }, { credentials: { token: 'abc', extra: true } }]) {
        let rejected = false;
        try { await call(command, payload); } catch (error) { rejected = error === 'invalid_token'; }
        check(rejected, 'ipc');
      }
    }
    const response = await call('inspect_setup', {});
    check(response.kind === 'profile' && response.data.status === 'unconfigured' && response.data.configured === false && response.data.service_running === false, 'profile');
  };
  // Leg (a): the application migrated its own registration at startup, with no
  // gesture from this script. Everything here only reads the result.
  const migration = async (end) => {
    const binding = await call('inspect_binding', {});
    check(binding.state === 'own' && binding.home === null, 'profile');
    const moved = await poll(facts, value => value.kind === 'service_inspection' && value.data.registration === 'owned' && value.data.interpreter === 'current', 'profile', end);
    check(moved.data.interpreter_exists === true && moved.data.settings === 'matching', 'profile');
    const profile = await call('inspect_setup', {});
    check(profile.kind === 'profile' && profile.data.configured === true && profile.data.service_running === true, 'profile');
    await press('#tab-service', end);
    await until(() => document.querySelector('.registration-facts'), 'timeout', end);
    check(!document.querySelector('[data-action="migrate-service"]'), 'form');
  };
  // Leg (b): an existing CLI home, adopted and taken over by explicit
  // confirmation, then disabled and released — all through the real controls.
  const adoption = async (home, end) => {
    const input = await until(() => { const el = document.querySelector('[data-field="home-path"]'); return el && !el.disabled ? el : null; }, 'timeout', end);
    input.value = home;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await tick();
    await press('[data-action="check-home"]', end);
    await until(() => document.querySelector('.home-report'), 'timeout', end);
    const report = await call('inspect_home', { query: { path: home } });
    check(report.kind === 'home_inspection' && report.data.adoptable === true && report.data.backend === 'hikerapi' && report.data.registration === 'owned' && report.data.interpreter === 'other', 'profile');
    await press('[data-action="adopt-home"]', end);
    await press('[data-action="confirm-adopt"]', end);
    await until(() => document.querySelector('.app-nav [role="tab"]'), 'timeout', end);
    const bound = await call('inspect_binding', {});
    check(bound.state === 'adopted' && bound.home === home, 'profile');
    const before = await facts();
    check(before.kind === 'service_inspection' && before.data.registration === 'owned' && before.data.interpreter === 'other', 'profile');
    await press('#tab-service', end);
    await press('[data-action="migrate-service"]', end);
    await press('[data-action="confirm-takeover"]', end);
    await poll(facts, value => value.kind === 'service_inspection' && value.data.interpreter === 'current', 'profile', end);
    await press('#tab-settings', end);
    await press('[data-action="uninstall"]', end);
    await press('[data-action="confirm-uninstall"]', end);
    await poll(facts, value => value.kind === 'service_inspection' && value.data.registration === 'none', 'profile', end);
    await press('[data-action="release-home"]', end);
    await press('[data-action="confirm-release"]', end);
    await until(() => document.querySelector('#hiker-token'), 'timeout', end);
    const released = await call('inspect_binding', {});
    check(released.state === 'own' && released.home === null, 'profile');
  };
  const run = async () => {
    // Initialization scripts can precede the HTML title element.
    const end = Date.now() + (proof.staged ? 600000 : 240000);
    while (!document.head && Date.now() < end) await tick();
    mark('script_started');
    await tick();
    const shell = await until(() => {
      const input = document.querySelector('#hiker-token');
      if (input && !input.disabled) return 'setup';
      if (document.querySelector('.app-nav [role="tab"]')) return 'configured';
      return null;
    }, 'timeout', end);
    if (proof.home !== null) { check(shell === 'setup', 'profile'); await adoption(proof.home, end); }
    else if (shell === 'configured') await migration(end);
    else await onboarding(end);
    mark('ui_ready');
  };
  run().catch(code => mark(['form', 'visibility', 'validation', 'geometry', 'ipc', 'profile', 'timeout', 'initialization_failed'].includes(code) ? code : 'script'));
})();
