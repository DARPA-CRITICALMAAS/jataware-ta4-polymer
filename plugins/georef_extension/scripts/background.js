// Listen for messages from content scripts
chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
    if (message.action === "openNewTab") {
      // Open a new tab with the specified URL
      chrome.tabs.create({ url: message.url });
    }
});
