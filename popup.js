(() => {
  const LIFE_KEY = 'enabled_life';
  const WORK_KEY = 'enabled_work';
  const lifeBtn = document.getElementById('toggle-life');
  const workBtn = document.getElementById('toggle-work');

  function renderSection(buttonEl, label, enabled) {
    buttonEl.textContent = `${label}: ${enabled ? 'ON' : 'OFF'}`;
    buttonEl.className = enabled ? 'on' : 'off';
  }

  async function getStates() {
    return new Promise((resolve) => {
      chrome.storage.local.get([LIFE_KEY, WORK_KEY], (res) => {
        const life = typeof res[LIFE_KEY] === 'boolean' ? res[LIFE_KEY] : true;
        const work = typeof res[WORK_KEY] === 'boolean' ? res[WORK_KEY] : true;
        resolve({ life, work });
      });
    });
  }

  function setState(key, enabled) {
    return new Promise((resolve) => chrome.storage.local.set({ [key]: enabled }, resolve));
  }

  async function apply(states) {
    const enable = [];
    const disable = [];
    if (states.life) enable.push('life'); else disable.push('life');
    if (states.work) enable.push('work'); else disable.push('work');

    const ops = [];
    if (enable.length) ops.push(chrome.declarativeNetRequest.updateEnabledRulesets({ enableRulesetIds: enable }));
    if (disable.length) ops.push(chrome.declarativeNetRequest.updateEnabledRulesets({ disableRulesetIds: disable }));
    await Promise.all(ops);
  }

  (async () => {
    const states = await getStates();
    renderSection(lifeBtn, 'Life Improvement', states.life);
    renderSection(workBtn, 'Work Focus', states.work);
    apply(states);

    lifeBtn.addEventListener('click', async () => {
      const current = await getStates();
      const next = { ...current, life: !current.life };
      await setState(LIFE_KEY, next.life);
      await apply(next);
      renderSection(lifeBtn, 'Life Improvement', next.life);
    });

    workBtn.addEventListener('click', async () => {
      const current = await getStates();
      const next = { ...current, work: !current.work };
      await setState(WORK_KEY, next.work);
      await apply(next);
      renderSection(workBtn, 'Work Focus', next.work);
    });
  })();
})();