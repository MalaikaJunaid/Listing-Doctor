const appUrlInput = document.getElementById("appUrl");
const status = document.getElementById("status");

chrome.storage.local.get("appUrl").then(({ appUrl }) => {
  appUrlInput.value = appUrl || "http://localhost:3000/";
}).catch(error => {
  console.error("Could not read Listing Doctor extension settings:", error);
  status.textContent = "Could not load settings. Check the browser extension storage.";
});

document.getElementById("settingsForm").addEventListener("submit", async event => {
  event.preventDefault();
  let url;
  try {
    url = new URL(appUrlInput.value.trim());
  } catch {
    status.textContent = "Enter a valid app URL.";
    return;
  }
  if (!["http:", "https:"].includes(url.protocol) || !url.host || url.username || url.password) {
    status.textContent = "Use an HTTP or HTTPS app URL without credentials.";
    return;
  }
  url.hash = "";
  try {
    await chrome.storage.local.set({ appUrl: url.href });
    appUrlInput.value = url.href;
    status.textContent = "App URL saved.";
  } catch (error) {
    console.error("Could not save Listing Doctor extension settings:", error);
    status.textContent = "Could not save settings. Check the browser extension storage.";
  }
});
