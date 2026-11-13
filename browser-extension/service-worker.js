const DEFAULT_APP_URL = "http://localhost:3000/";
const MENU_ID = "listing-doctor-review-selection";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: "Review selection with Listing Doctor",
    contexts: ["selection"]
  });
});

async function getAppUrl() {
  const { appUrl } = await chrome.storage.local.get("appUrl");
  const candidate = typeof appUrl === "string" ? appUrl : DEFAULT_APP_URL;
  const url = new URL(candidate);
  if (!["http:", "https:"].includes(url.protocol)) return DEFAULT_APP_URL;
  url.hash = "";
  return url.href;
}

async function openListingDoctor(listing) {
  const selectedText = typeof listing === "string" ? listing.trim() : "";
  const url = new URL(await getAppUrl());
  if (selectedText) url.hash = new URLSearchParams({ listing: selectedText }).toString();
  await chrome.tabs.create({ url: url.href });
}

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId !== MENU_ID) return;
  openListingDoctor(info.selectionText).catch(error => {
    console.error("Could not open Listing Doctor for the selected text:", error);
  });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "open-listing" || typeof message.listing !== "string") return;
  openListingDoctor(message.listing).then(
    () => sendResponse({ ok: true }),
    error => {
      console.error("Could not open Listing Doctor:", error);
      sendResponse({ ok: false, error: "Could not open Listing Doctor. Check the app URL in extension settings." });
    }
  );
  return true;
});
