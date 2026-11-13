const status = document.getElementById("status");

document.getElementById("analyzeSelection").addEventListener("click", async () => {
  status.textContent = "";
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("Could not access the current tab.");
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => window.getSelection()?.toString().trim() || ""
    });
    const listing = result?.result || "";
    if (listing.length < 20) {
      status.textContent = "Select at least 20 characters of listing text first.";
      return;
    }
    if (listing.length > 5000) {
      status.textContent = "Select a shorter section (up to 5,000 characters).";
      return;
    }
    const response = await chrome.runtime.sendMessage({ type: "open-listing", listing });
    if (!response?.ok) throw new Error(response?.error || "Could not open Listing Doctor.");
    window.close();
  } catch (error) {
    status.textContent = error.message || "Could not read the selected text on this page.";
  }
});

document.getElementById("openApp").addEventListener("click", async () => {
  const response = await chrome.runtime.sendMessage({ type: "open-listing", listing: "" });
  if (!response?.ok) status.textContent = response?.error || "Could not open Listing Doctor.";
  else window.close();
});

document.getElementById("openSettings").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});
