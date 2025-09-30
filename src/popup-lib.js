(() => {
  const storageKeyFor = (id) => `enabled_${id}`;
  const getButton = (id) => document.getElementById(`toggle-${id}`);

  function render(buttonEl, title, enabled) {
    buttonEl.textContent = `${title}: ${enabled ? 'ON' : 'OFF'}`;
    buttonEl.className = enabled ? 'on' : 'off';
  }

  function getStates(sections) {
    return new Promise((resolve) => {
      const keys = sections.map((s) => storageKeyFor(s.id));
      chrome.storage.local.get(keys, (res) => {
        const states = {};
        for (const s of sections) {
          const val = res[storageKeyFor(s.id)];
          states[s.id] = typeof val === 'boolean' ? val : (s.enabledByDefault !== false);
        }
        resolve(states);
      });
    });
  }

  function setState(id, enabled) {
    return new Promise((resolve) => chrome.storage.local.set({ [storageKeyFor(id)]: enabled }, resolve));
  }

  async function apply(sections, states) {
    const enable = [];
    const disable = [];
    for (const s of sections) {
      if (states[s.id]) enable.push(s.id); else disable.push(s.id);
    }
    const ops = [];
    if (enable.length) ops.push(chrome.declarativeNetRequest.updateEnabledRulesets({ enableRulesetIds: enable }));
    if (disable.length) ops.push(chrome.declarativeNetRequest.updateEnabledRulesets({ disableRulesetIds: disable }));
    await Promise.all(ops);
  }

  async function initPopup(sections) {
    const states = await getStates(sections);
    for (const s of sections) {
      const btn = getButton(s.id);
      render(btn, s.title, states[s.id]);
      btn.addEventListener('click', async () => {
        const current = await getStates(sections);
        const next = { ...current, [s.id]: !current[s.id] };
        await setState(s.id, next[s.id]);
        await apply(sections, next);
        render(btn, s.title, next[s.id]);
      });
    }
    apply(sections, states);
  }

  window.PopupLib = { initPopup };
})();


