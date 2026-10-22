/**
 * Content tabs on a container (`root`); without JS, tabs remain disclosures. The source is a
 * string so it runs as is in the Reader, the workspace panel and the static site (CSP-compatible).
 */
const richTabs = `(root) => root.querySelectorAll('.rich-tabs').forEach((group, groupIndex) => {
  const container = group.querySelector(':scope > .rich-content');
  if (!container) return;
  const disclosures = [...container.children].filter((child) => child.matches('details.rich-tab'));
  if (!disclosures.length) return;
  const list = document.createElement('div');
  list.className = 'rich-tab-list';
  list.setAttribute('role', 'tablist');
  list.setAttribute('aria-label', group.querySelector(':scope > .rich-title')?.textContent || 'Content tabs');
  const tabs = [];
  const panels = [];
  disclosures.forEach((disclosure, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'rich-tab-button';
    button.setAttribute('role', 'tab');
    button.id = 'wiki-tab-' + groupIndex + '-' + index;
    const panel = document.createElement('div');
    panel.className = 'rich-tab-panel';
    panel.setAttribute('role', 'tabpanel');
    panel.id = 'wiki-panel-' + groupIndex + '-' + index;
    button.setAttribute('aria-controls', panel.id);
    panel.setAttribute('aria-labelledby', button.id);
    button.textContent = disclosure.querySelector(':scope > summary')?.textContent || 'Tab ' + (index + 1);
    const content = disclosure.querySelector(':scope > .rich-content');
    if (content) panel.append(...content.childNodes);
    list.append(button);
    container.insertBefore(panel, disclosure);
    disclosure.remove();
    tabs.push(button);
    panels.push(panel);
  });
  container.insertBefore(list, panels[0]);
  const select = (index, focus) => {
    tabs.forEach((tab, at) => {
      const active = at === index;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      panels[at].hidden = !active;
    });
    if (focus) tabs[index].focus();
  };
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => select(index, false));
    tab.addEventListener('keydown', (event) => {
      const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length
        : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length
        : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1;
      if (next >= 0) { event.preventDefault(); select(next, true); }
    });
  });
  select(0, false);
})`;
/** Shared behavior for preview and static export, applied to the whole page. */
// The leading `;` keeps it separate from a script it is appended to (the static site).
export const readerInteractions = `;(${richTabs})(document);`;
/** Defines `window.wikiRichTabs(root)` for pages inserted later (the workspace panel). */
export const richTabsScript = `window.wikiRichTabs = ${richTabs};`;
