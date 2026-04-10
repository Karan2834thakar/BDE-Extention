chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {
    // Ignore startup errors on unsupported versions.
  });
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab || typeof tab.windowId !== "number") {
    return;
  }

  try {
    await chrome.sidePanel.open({ windowId: tab.windowId });
  } catch (error) {
    console.error("Failed to open side panel:", error);
  }
});
