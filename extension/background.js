// Marginer injects on demand rather than running as a content script on every
// page: nothing touches a tab until you click the icon (or hit the shortcut).
// The bundle parks itself on window.__marginer, so a second click toggles the
// sidebar instead of injecting a second copy.
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id || !/^https?:|^file:/.test(tab.url ?? '')) return
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: false },
      files: ['marginer.js'],
    })
  } catch (e) {
    console.error('[marginer] injection failed', e)
  }
})
