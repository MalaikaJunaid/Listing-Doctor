const HISTORY_KEY = "listing-doctor:reviews:v1";
const MAX_SAVED_REVIEWS = 8;
const SAMPLE_LISTING = "A lovely family home in a great location. This bright and spacious property has a modern kitchen and a nice garden. Close to shops, schools and transport. Call today to arrange a viewing.";

const elements = {
  input: document.getElementById("listingInput"),
  tone: document.getElementById("toneSelect"),
  analyzeButton: document.getElementById("analyzeButton"),
  analyzeButtonText: document.getElementById("analyzeButtonText"),
  error: document.getElementById("errorMessage"),
  historyPanel: document.getElementById("historyPanel"),
  historyButton: document.getElementById("historyButton"),
  historyList: document.getElementById("historyList"),
  toast: document.getElementById("toast")
};

let reviews = readHistory();
let activeReview = null;
let requestController = null;
let queuedVerifiedFeatures = [];

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("show");
  window.clearTimeout(showToast.timeout);
  showToast.timeout = window.setTimeout(() => elements.toast.classList.remove("show"), 2800);
}

function importListingFromExtension() {
  const fragment = new URLSearchParams(window.location.hash.slice(1));
  const listing = fragment.get("listing");
  if (listing === null) return;

  window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
  if (listing.length > 5000) {
    showError("The selected text is longer than 5,000 characters. Select a shorter listing and try again.");
    return;
  }
  elements.input.value = listing;
  elements.input.dispatchEvent(new Event("input"));
  elements.input.focus();
  showToast("Selected text added. Review it, then analyze when ready.");
}

function editGeneratedCopy(button) {
  if (!activeReview) return;
  const target = document.getElementById(button.dataset.edit);
  if (!target || target.dataset.editing === "true") return;
  const field = target.id === "generatedTitle" ? "improved_title" : "improved_description";
  const original = target.textContent;
  target.dataset.editing = "true";
  target.hidden = true;

  const editor = document.createElement("div");
  const textarea = document.createElement("textarea");
  textarea.className = "edit-area";
  textarea.maxLength = field === "improved_title" ? 180 : 1800;
  textarea.setAttribute("aria-label", field === "improved_title" ? "Edit improved title" : "Edit improved description");
  textarea.value = original;
  const actions = document.createElement("div");
  actions.className = "edit-actions";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "copy-button";
  cancel.textContent = "Cancel";
  const save = document.createElement("button");
  save.type = "button";
  save.className = "copy-button";
  save.textContent = "Save copy";
  actions.append(cancel, save);
  editor.append(textarea, actions);
  target.after(editor);
  document.querySelectorAll("[data-copy], #exportButton, [data-edit]").forEach(control => {
    control.disabled = true;
  });
  textarea.focus();

  const finish = value => {
    editor.remove();
    target.hidden = false;
    delete target.dataset.editing;
    document.querySelectorAll("[data-copy], #exportButton, [data-edit]").forEach(control => {
      control.disabled = false;
    });
    if (value !== null) {
      target.textContent = value;
      activeReview.analysis[field] = value;
      const selectedOption = activeReview.analysis.copy_options?.find(option => option.tone === activeReview.tone);
      if (selectedOption) selectedOption[field === "improved_title" ? "title" : "description"] = value;
      updateChannelCopyState();
      saveActiveReview();
      showToast("Your edited copy has been saved.");
    }
  };
  cancel.addEventListener("click", () => finish(null));
  save.addEventListener("click", () => {
    const value = textarea.value.trim();
    if (!value) {
      textarea.setCustomValidity("Copy cannot be empty.");
      textarea.reportValidity();
      return;
    }
    finish(value);
  });
}

function showError(message) {
  elements.error.textContent = message;
  elements.error.hidden = false;
}

function clearError() {
  elements.error.textContent = "";
  elements.error.hidden = true;
}

function readHistory() {
  try {
    const stored = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    if (!Array.isArray(stored)) throw new Error("Saved review history is not a list.");
    return stored.filter(review =>
      review &&
      typeof review.id === "string" &&
      typeof review.listing === "string" &&
      review.analysis &&
      typeof review.analysis.improved_title === "string"
    ).slice(0, MAX_SAVED_REVIEWS);
  } catch (error) {
    showToast("Saved reviews could not be loaded from this browser.");
    console.error("Could not read review history:", error);
    return [];
  }
}

function persistHistory() {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(reviews));
    renderHistory();
    return true;
  } catch (error) {
    console.error("Could not save review history:", error);
    showToast("Analysis is ready, but this browser could not save it to history.");
    renderHistory();
    return false;
  }
}

function makeSuggestion(text, section) {
  const key = `${section}:${text}`;
  const item = document.createElement("button");
  item.type = "button";
  item.className = "opportunity-item";
  item.dataset.suggestion = key;
  const isDone = activeReview?.completedSuggestions.includes(key) || false;
  item.classList.toggle("is-done", isDone);
  item.setAttribute("aria-pressed", String(isDone));
  const check = document.createElement("span");
  check.className = "suggestion-check";
  check.setAttribute("aria-hidden", "true");
  check.textContent = "✓";
  const message = document.createElement("span");
  message.textContent = text;
  item.append(check, message);
  return item;
}

function renderSuggestions(target, items, section) {
  target.replaceChildren();
  if (!items.length) {
    const empty = document.createElement("p");
    empty.className = "history-empty";
    empty.textContent = "No suggestions for this section.";
    target.append(empty);
    updateQuickProgress();
    return;
  }
  items.forEach(item => target.append(makeSuggestion(item, section)));
  updateQuickProgress();
}

function updateFeatureQueue() {
  const queue = document.getElementById("featureQueue");
  queue.replaceChildren();
  queue.hidden = queuedVerifiedFeatures.length === 0;
  queuedVerifiedFeatures.forEach((feature, index) => {
    const row = document.createElement("div");
    row.className = "feature-queue-item";
    const text = document.createElement("span");
    const category = document.createElement("strong");
    category.textContent = `${feature.category}: `;
    text.append(category, document.createTextNode(feature.text));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "feature-remove";
    remove.dataset.removeQueuedFeature = String(index);
    remove.setAttribute("aria-label", `Remove ${feature.category} detail`);
    remove.textContent = "Remove";
    row.append(text, remove);
    queue.append(row);
  });

  const count = queuedVerifiedFeatures.length;
  document.getElementById("featureQueueCount").textContent = count
    ? `${count} verified detail${count === 1 ? "" : "s"} queued`
    : "No details queued";
  document.getElementById("applyFeaturesButton").disabled = count === 0;
}

function updateGuidedFactsButton() {
  const hasFact = [...document.querySelectorAll("[data-fact]")].some(input => input.value.trim());
  document.getElementById("applyGuidedFacts").disabled =
    !hasFact || !document.getElementById("guidedFactsVerified").checked;
}

function applyGuidedFacts() {
  if (!document.getElementById("guidedFactsVerified").checked) {
    showToast("Confirm each entered detail is accurate before adding it.");
    return;
  }
  const facts = [...document.querySelectorAll("[data-fact]")]
    .map(input => ({ field: input.dataset.fact, value: input.value.trim() }))
    .filter(fact => fact.value);
  if (!facts.length) return;

  const currentListing = elements.input.value.trim();
  const normalizedListing = currentListing.toLocaleLowerCase();
  const newFacts = facts.filter(fact =>
    !normalizedListing.includes(`${fact.field}: ${fact.value}`.toLocaleLowerCase())
  );
  if (!newFacts.length) {
    showToast("Those details are already in your listing.");
    return;
  }
  const addition = [
    "Additional verified property details:",
    ...newFacts.map(fact => `- ${fact.field}: ${fact.value}`)
  ].join("\n");
  const updatedListing = [currentListing, addition].filter(Boolean).join("\n\n");
  if (updatedListing.length > 5000) {
    showToast("There isn't enough room in the listing for these details. Shorten it and try again.");
    elements.input.focus();
    return;
  }

  elements.input.value = updatedListing;
  elements.input.dispatchEvent(new Event("input"));
  [...document.querySelectorAll("[data-fact]")].forEach(input => { input.value = ""; });
  document.getElementById("guidedFactsVerified").checked = false;
  updateGuidedFactsButton();
  showToast("Verified details added. Run the analysis again to update your results.");
}

function focusGuidedFact(field) {
  const guide = document.querySelector(".guided-facts");
  guide.open = true;
  const normalizedField = field.toLocaleLowerCase();
  const inputs = [...document.querySelectorAll("[data-fact]")];
  const aliases = [
    { match: /price|cost|guide|rent/, id: "factPrice" },
    { match: /location|area|address|neighbou?rhood/, id: "factLocation" },
    { match: /bed|room/, id: "factBedrooms" },
    { match: /bath|washroom/, id: "factBathrooms" },
    { match: /floor|floor area|size|square|measurement/, id: "factFloorArea" },
    { match: /tenure|ownership|freehold|leasehold/, id: "factTenure" },
    { match: /fee|service charge|maintenance/, id: "factFees" },
    { match: /availability|viewing|move|completion/, id: "factAvailability" }
  ];
  const match = aliases.find(alias => alias.match.test(normalizedField));
  const input = (match && document.getElementById(match.id)) || inputs.find(item => !item.value.trim()) || inputs[0];
  input.scrollIntoView({ behavior: "smooth", block: "center" });
  input.focus({ preventScroll: true });
}

function updateQueueFeatureButton() {
  const hasText = document.getElementById("featureInput").value.trim().length > 0;
  const isVerified = document.getElementById("featureVerified").checked;
  document.getElementById("queueFeatureButton").disabled = !hasText || !isVerified || queuedVerifiedFeatures.length >= 8;
}

function queueVerifiedFeature(event) {
  event.preventDefault();
  const text = document.getElementById("featureInput").value.trim();
  const category = document.getElementById("featureCategory").value;
  if (!text || !document.getElementById("featureVerified").checked) {
    showToast("Enter a detail and confirm it is accurate before adding it.");
    return;
  }
  if (queuedVerifiedFeatures.length >= 8) {
    showToast("Queue up to 8 details at a time.");
    return;
  }
  const duplicate = queuedVerifiedFeatures.some(feature =>
    feature.category === category && feature.text.toLocaleLowerCase() === text.toLocaleLowerCase()
  );
  if (duplicate) {
    showToast("That detail is already in your queue.");
    return;
  }

  queuedVerifiedFeatures.push({ category, text });
  document.getElementById("featureInput").value = "";
  document.getElementById("featureVerified").checked = false;
  updateQueueFeatureButton();
  updateFeatureQueue();
  document.getElementById("featureInput").focus();
}

function renderCopyOptions(analysis, selectedTone) {
  const container = document.getElementById("copyOptions");
  container.replaceChildren();
  const options = Array.isArray(analysis.copy_options) && analysis.copy_options.length
    ? analysis.copy_options
    : [{ tone: selectedTone, title: analysis.improved_title, description: analysis.improved_description }];
  options.forEach(option => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "copy-option";
    button.dataset.copyTone = option.tone;
    button.setAttribute("aria-pressed", String(option.tone === selectedTone));
    button.disabled = !Array.isArray(analysis.copy_options) || analysis.copy_options.length < 2;
    button.textContent = option.tone;
    container.append(button);
  });
}

function applyCopyOption(tone) {
  if (!activeReview) return;
  const option = activeReview.analysis.copy_options?.find(item => item.tone === tone);
  if (!option) return;
  activeReview.tone = tone;
  elements.tone.value = tone;
  activeReview.analysis.improved_title = option.title;
  activeReview.analysis.improved_description = option.description;
  document.getElementById("generatedTitle").textContent = option.title;
  document.getElementById("generatedDescription").textContent = option.description;
  renderCopyOptions(activeReview.analysis, tone);
  updateChannelCopyState();
  saveActiveReview();
  showToast(`${tone} copy selected.`);
}

function selectedChannelLimits() {
  return {
    title: Number(document.getElementById("titleCharacterLimit").value),
    description: Number(document.getElementById("descriptionCharacterLimit").value)
  };
}

function updateChannelCopyState() {
  const title = document.getElementById("generatedTitle").textContent;
  const description = document.getElementById("generatedDescription").textContent;
  const limits = selectedChannelLimits();
  const titleValid = Number.isInteger(limits.title) && limits.title > 0 && limits.title <= 500 && title.length <= limits.title;
  const descriptionValid = Number.isInteger(limits.description) && limits.description > 0 && limits.description <= 5000 && description.length <= limits.description;
  const titleCount = document.getElementById("titleCharacterCount");
  const descriptionCount = document.getElementById("descriptionCharacterCount");
  titleCount.textContent = `Title: ${title.length.toLocaleString()} / ${limits.title.toLocaleString() || "—"}`;
  descriptionCount.textContent = `Description: ${description.length.toLocaleString()} / ${limits.description.toLocaleString() || "—"}`;
  titleCount.classList.toggle("over-limit", !titleValid);
  descriptionCount.classList.toggle("over-limit", !descriptionValid);
  document.getElementById("copyChannelButton").disabled = !activeReview || !titleValid || !descriptionValid;
}

function updateChannelPreset() {
  const limitsByChannel = {
    portal: [100, 2000],
    social: [80, 500],
    flyer: [70, 900]
  };
  const limits = limitsByChannel[document.getElementById("targetChannel").value];
  if (limits) {
    document.getElementById("titleCharacterLimit").value = limits[0];
    document.getElementById("descriptionCharacterLimit").value = limits[1];
  }
  updateChannelCopyState();
}

function copyFormattedListing() {
  if (!activeReview) return;
  updateChannelCopyState();
  if (document.getElementById("copyChannelButton").disabled) {
    showToast("Copy exceeds the selected channel limits. Adjust the copy or its character guides.");
    return;
  }
  const formatted = `${document.getElementById("generatedTitle").textContent}\n\n${document.getElementById("generatedDescription").textContent}`;
  copyText(formatted);
}

function applyVerifiedFeatures() {
  if (!queuedVerifiedFeatures.length) return;
  const currentListing = elements.input.value.trim();
  const existingText = currentListing.toLocaleLowerCase();
  const newFeatures = queuedVerifiedFeatures.filter(feature =>
    !existingText.includes(feature.text.toLocaleLowerCase())
  );
  if (!newFeatures.length) {
    showToast("Those details are already in your listing.");
    return;
  }
  const addition = [
    "Additional verified property details:",
    ...newFeatures.map(feature => `- ${feature.category}: ${feature.text}`)
  ].join("\n");
  const updatedListing = [currentListing, addition].filter(Boolean).join("\n\n");
  if (updatedListing.length > 5000) {
    showToast("There isn't enough room in the listing for these details. Shorten it and try again.");
    elements.input.focus();
    return;
  }

  elements.input.value = updatedListing;
  elements.input.dispatchEvent(new Event("input"));
  queuedVerifiedFeatures = [];
  updateFeatureQueue();
  elements.input.focus();
  elements.input.scrollIntoView({ behavior: "smooth", block: "center" });
  showToast("Verified details added. Run the analysis again to update your results.");
}

function updateQuickProgress() {
  const suggestions = [...document.querySelectorAll("[data-suggestion]")];
  const completed = suggestions.filter(item => item.getAttribute("aria-pressed") === "true").length;
  const total = suggestions.length;
  const percent = total ? Math.round(completed / total * 100) : 0;
  document.getElementById("quickProgressText").textContent = total ? `${completed} of ${total} complete` : "Analyze to see quick wins";
  document.getElementById("quickProgressFill").style.width = `${percent}%`;
  document.querySelector(".progress-track").setAttribute("aria-valuenow", String(percent));
}

function renderAnalysis(analysis, listing = elements.input.value, tone = elements.tone.value, reviewId = null, completedSuggestions = []) {
  const scorecard = analysis.listing_scorecard;
  const scoreMetrics = [
    ["completeness", "completenessValue", "completenessFill"],
    ["clarity", "clarityValue", "clarityFill"],
    ["searchability", "searchabilityValue", "searchabilityFill"]
  ];
  scoreMetrics.forEach(([key, valueId, fillId]) => {
    const value = Number.isInteger(scorecard?.[key]) ? scorecard[key] : null;
    document.getElementById(valueId).textContent = value === null ? "—" : `${value}%`;
    const fill = document.getElementById(fillId);
    fill.style.width = `${value ?? 0}%`;
    fill.parentElement.setAttribute("aria-valuenow", String(value ?? 0));
  });
  const missingCritical = Array.isArray(scorecard?.missing_critical_fields)
    ? scorecard.missing_critical_fields
    : [];
  const missingCount = Number.isInteger(scorecard?.missing_critical_count)
    ? scorecard.missing_critical_count
    : null;
  document.getElementById("criticalMissingValue").textContent = missingCount === null ? "—" : String(missingCount);
  document.getElementById("criticalMissingFields").textContent = missingCount === null
    ? "Re-analyze this saved draft to calculate the text-based scorecard."
    : missingCount
      ? `Not detected in the draft: ${missingCritical.join(", ")}.`
      : "All five critical fields were detected in the draft text.";
  document.getElementById("scoreSummary").textContent = analysis.summary;

  const missingList = document.getElementById("missingList");
  missingList.replaceChildren();
  if (analysis.missing_information.length) {
    analysis.missing_information.forEach(item => {
      const row = document.createElement("div");
      row.className = "missing-item";
      const copy = document.createElement("div");
      copy.className = "missing-item-copy";
      const heading = document.createElement("strong");
      heading.textContent = item.field;
      const explanation = document.createElement("span");
      explanation.textContent = item.why;
      copy.append(heading, explanation);
      const addButton = document.createElement("button");
      addButton.type = "button";
      addButton.dataset.missingField = item.field;
      addButton.textContent = "Add detail";
      row.append(copy, addButton);
      missingList.append(row);
    });
    const count = analysis.missing_information.length;
    document.getElementById("missingSubtitle").textContent = `${count} useful ${count === 1 ? "detail is" : "details are"} missing. Add what you know to the guided checklist below.`;
  } else {
    const done = document.createElement("span");
    done.className = "all-set";
    done.textContent = "✓ The key details appear to be covered.";
    missingList.append(done);
    document.getElementById("missingSubtitle").textContent = "The AI did not identify any major missing details.";
  }

  document.getElementById("generatedTitle").textContent = analysis.improved_title;
  document.getElementById("generatedDescription").textContent = analysis.improved_description;
  activeReview = { id: reviewId, analysis, listing, tone, completedSuggestions: [...completedSuggestions] };
  renderCopyOptions(analysis, tone);
  updateChannelCopyState();
  renderSuggestions(document.getElementById("photoSuggestions"), analysis.photo_suggestions, "photo");
  renderSuggestions(document.getElementById("featureSuggestions"), analysis.feature_suggestions, "feature");
  document.getElementById("leadValue").textContent = analysis.lead_readiness;
  document.getElementById("leadSubtext").textContent = analysis.lead_readiness_rationale;
  document.querySelectorAll("[data-copy], [data-edit], #exportButton").forEach(button => {
    button.disabled = false;
  });
}

function resetAnalysis() {
  activeReview = null;
  document.getElementById("scoreSummary").textContent = "Add a listing to see what’s already working and where to make improvements.";
  ["completenessValue", "clarityValue", "searchabilityValue", "criticalMissingValue"].forEach(id => {
    document.getElementById(id).textContent = "—";
  });
  ["completenessFill", "clarityFill", "searchabilityFill"].forEach(id => {
    const fill = document.getElementById(id);
    fill.style.width = "0%";
    fill.parentElement.setAttribute("aria-valuenow", "0");
  });
  document.getElementById("criticalMissingFields").textContent = "";
  document.getElementById("missingSubtitle").textContent = "A few specifics can help build buyer confidence.";
  const missingPlaceholder = document.createElement("p");
  missingPlaceholder.className = "history-empty";
  missingPlaceholder.textContent = "Missing information appears after analysis.";
  document.getElementById("missingList").replaceChildren(missingPlaceholder);
  document.getElementById("generatedTitle").textContent = "Your improved title will appear here.";
  document.getElementById("generatedDescription").textContent = "Your AI-refreshed description will appear here.";
  document.getElementById("copyOptions").replaceChildren();
  renderSuggestions(document.getElementById("photoSuggestions"), [], "photo");
  renderSuggestions(document.getElementById("featureSuggestions"), [], "feature");
  document.getElementById("leadValue").textContent = "—";
  document.getElementById("leadSubtext").textContent = "Run an analysis to see";
  updateChannelCopyState();
  document.querySelectorAll("[data-copy], [data-edit], #exportButton").forEach(button => {
    button.disabled = true;
  });
}

function saveActiveReview() {
  if (!activeReview?.id) return;
  reviews = reviews.map(review => review.id === activeReview.id
    ? {
        ...review,
      tone: activeReview.tone,
      analysis: activeReview.analysis,
      completedSuggestions: [...activeReview.completedSuggestions]
    }
    : review);
  persistHistory();
}

function renderHistory() {
  elements.historyList.replaceChildren();
  document.getElementById("historyCount").textContent = reviews.length ? `(${reviews.length})` : "";
  if (!reviews.length) {
    const empty = document.createElement("p");
    empty.className = "history-empty";
    empty.textContent = "Your reviews will be saved here in this browser.";
    elements.historyList.append(empty);
    return;
  }

  reviews.forEach(review => {
    const row = document.createElement("div");
    row.className = "history-entry";
    const open = document.createElement("button");
    open.type = "button";
    open.className = "history-open";
    open.dataset.openReview = review.id;
    const title = document.createElement("strong");
    title.textContent = review.analysis.improved_title;
    const metadata = document.createElement("span");
    const date = new Date(review.createdAt);
    const completed = review.completedSuggestions?.length || 0;
    const total = review.analysis.photo_suggestions.length + review.analysis.feature_suggestions.length;
    const completeness = review.analysis.listing_scorecard?.completeness;
    metadata.textContent = `${Number.isFinite(date.getTime()) ? date.toLocaleString() : "Saved review"} · Completeness ${Number.isInteger(completeness) ? `${completeness}%` : "re-analyze"} · ${completed}/${total} quick wins`;
    open.append(title, metadata);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "history-delete";
    remove.dataset.deleteReview = review.id;
    remove.setAttribute("aria-label", `Delete review: ${review.analysis.improved_title}`);
    remove.textContent = "Delete";
    row.append(open, remove);
    const duplicate = document.createElement("button");
    duplicate.type = "button";
    duplicate.className = "history-duplicate";
    duplicate.dataset.duplicateReview = review.id;
    duplicate.setAttribute("aria-label", `Use ${review.analysis.improved_title} as a new draft`);
    duplicate.textContent = "Use as new draft";
    row.insertBefore(duplicate, remove);
    elements.historyList.append(row);
  });
}

async function analyzeListing() {
  const listing = elements.input.value.trim();
  if (listing.length < 20) {
    showError("Add at least 20 characters of listing text before analyzing.");
    elements.input.focus();
    return;
  }
  if (listing.length > 5000) {
    showError("This listing is too long. Please keep it under 5,000 characters.");
    elements.input.focus();
    return;
  }

  const tone = elements.tone.value;
  clearError();
  if (activeReview && (activeReview.listing !== listing || activeReview.tone !== tone)) resetAnalysis();
  requestController?.abort();
  const controller = new AbortController();
  requestController = controller;
  elements.analyzeButton.disabled = true;
  elements.analyzeButtonText.textContent = "Analyzing with Groq AI…";
  try {
    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ listing, tone }),
      signal: controller.signal
    });
    let payload;
    try {
      payload = await response.json();
    } catch (error) {
      throw new Error("The app returned an unreadable response. Please refresh and try again.");
    }
    if (!response.ok) throw new Error(payload.error || `Analysis failed (HTTP ${response.status}).`);
    if (!payload.analysis || typeof payload.analysis.quality_score !== "number") {
      throw new Error("The AI response was incomplete. Please try again.");
    }

    renderAnalysis(payload.analysis, listing, tone);
    const review = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: new Date().toISOString(),
      listing,
      tone,
      analysis: payload.analysis,
      completedSuggestions: []
    };
    activeReview.id = review.id;
    reviews = [review, ...reviews.filter(item => item.listing !== listing || item.tone !== tone)].slice(0, MAX_SAVED_REVIEWS);
    persistHistory();
    showToast("AI listing review is ready.");
  } catch (error) {
    if (error.name === "AbortError") return;
    const message = error instanceof TypeError
      ? "Could not reach the analysis API. Run this app with npm run dev or try again after deployment."
      : error.message;
    showError(message);
    console.error("Listing analysis request failed:", error);
  } finally {
    if (requestController === controller) {
      elements.analyzeButton.disabled = false;
      elements.analyzeButtonText.textContent = "Analyze with AI";
      requestController = null;
    }
  }
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    showToast("Copied to clipboard.");
  } catch (error) {
    const temporary = document.createElement("textarea");
    temporary.value = text;
    temporary.setAttribute("readonly", "");
    temporary.style.position = "fixed";
    temporary.style.opacity = "0";
    document.body.append(temporary);
    temporary.select();
    const copied = document.execCommand("copy");
    temporary.remove();
    if (copied) showToast("Copied to clipboard.");
    else showToast("Could not copy. Select the text to copy it.");
  }
}

function exportReview() {
  if (!activeReview) {
    showToast("Analyze a listing before exporting a review.");
    return;
  }
  const analysis = activeReview.analysis;
  const channel = document.getElementById("targetChannel").selectedOptions[0].textContent;
  const limits = selectedChannelLimits();
  const title = document.getElementById("generatedTitle").textContent;
  const description = document.getElementById("generatedDescription").textContent;
  const formattedListing = `${title}\n\n${description}`;
  const report = [
    "LISTING DOCTOR — LISTING REVIEW",
    "",
    `Writing style: ${activeReview.tone}`,
    `Target format: ${channel}`,
    `Character guides: title ${title.length}/${limits.title}, description ${description.length}/${limits.description}`,
    "",
    "LISTING COMPLETENESS SCORECARD",
    `Completeness: ${analysis.listing_scorecard?.completeness ?? "Not available"}%`,
    `Clarity: ${analysis.listing_scorecard?.clarity ?? "Not available"}%`,
    `Searchability: ${analysis.listing_scorecard?.searchability ?? "Not available"}%`,
    `Missing critical fields: ${analysis.listing_scorecard?.missing_critical_count ?? "Not available"}`,
    "",
    "COPY-READY LISTING",
    formattedListing,
    "",
    `AI quality assessment (separate estimate): ${analysis.quality_score}/100`,
    `Assessment: ${analysis.summary}`,
    "",
    "IMPROVED TITLE",
    analysis.improved_title,
    "",
    "IMPROVED DESCRIPTION",
    analysis.improved_description,
    "",
    "DETAILS TO ADD",
    ...analysis.missing_information.map(item => `- ${item.field}: ${item.why}`),
    "",
    "PHOTO IDEAS",
    ...analysis.photo_suggestions.map(item => `- ${item}`),
    "",
    "FEATURES TO MENTION IF ACCURATE",
    ...analysis.feature_suggestions.map(item => `- ${item}`),
    "",
    "QUICK WINS COMPLETED",
    ...activeReview.completedSuggestions.map(item => `- ${item.slice(item.indexOf(":") + 1)}`),
    "",
    `Lead-generation readiness: ${analysis.lead_readiness}`,
    analysis.lead_readiness_rationale,
    "",
    "Review all AI-generated content and verify facts before publishing."
  ].join("\n");
  const blob = new Blob([report], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `listing-review-${new Date().toISOString().slice(0, 10)}.txt`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast("Review exported.");
}

elements.input.addEventListener("input", () => {
  requestController?.abort();
  document.getElementById("charCount").textContent = `${elements.input.value.length.toLocaleString()} / 5,000`;
  clearError();
  if (activeReview && activeReview.listing !== elements.input.value.trim()) resetAnalysis();
});
elements.tone.addEventListener("change", () => {
  requestController?.abort();
  if (activeReview) {
    resetAnalysis();
    showToast("Writing style changed. Run the analysis again to update the copy.");
  }
});
elements.analyzeButton.addEventListener("click", analyzeListing);
document.getElementById("sampleButton").addEventListener("click", () => {
  elements.input.value = SAMPLE_LISTING;
  elements.input.dispatchEvent(new Event("input"));
  elements.input.focus();
  showToast("Sample listing added. Make it your own or analyze it as is.");
});
document.getElementById("clearButton").addEventListener("click", () => {
  requestController?.abort();
  elements.input.value = "";
  elements.input.dispatchEvent(new Event("input"));
  elements.tone.value = "Warm and welcoming";
  clearError();
  resetAnalysis();
  elements.input.focus();
  showToast("Ready for a new listing.");
});
elements.historyButton.addEventListener("click", () => {
  const show = elements.historyPanel.hidden;
  elements.historyPanel.hidden = !show;
  elements.historyButton.setAttribute("aria-expanded", String(show));
  if (show) {
    renderHistory();
    elements.historyPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  }
});
elements.historyList.addEventListener("click", event => {
  const deleteButton = event.target.closest("[data-delete-review]");
  if (deleteButton) {
    reviews = reviews.filter(review => review.id !== deleteButton.dataset.deleteReview);
    persistHistory();
    if (activeReview && !reviews.some(review => review.listing === activeReview.listing)) resetAnalysis();
    showToast("Review removed from this browser.");
    return;
  }

  const duplicateButton = event.target.closest("[data-duplicate-review]");
  if (duplicateButton) {
    const review = reviews.find(item => item.id === duplicateButton.dataset.duplicateReview);
    if (!review) {
      showError("That saved review is no longer available.");
      return;
    }
    requestController?.abort();
    elements.input.value = review.listing;
    elements.tone.value = review.tone;
    elements.input.dispatchEvent(new Event("input"));
    resetAnalysis();
    clearError();
    elements.input.focus();
    elements.input.scrollIntoView({ behavior: "smooth", block: "center" });
    showToast("Draft copied. Edit it and analyze to create a new review.");
    return;
  }

  const openButton = event.target.closest("[data-open-review]");
  if (openButton) {
    const review = reviews.find(item => item.id === openButton.dataset.openReview);
    if (!review) {
      showError("That saved review is no longer available.");
      return;
    }
    elements.input.value = review.listing;
    elements.input.dispatchEvent(new Event("input"));
    elements.tone.value = review.tone;
    clearError();
    renderAnalysis(review.analysis, review.listing, review.tone, review.id, review.completedSuggestions || []);
    document.getElementById("results").scrollIntoView({ behavior: "smooth", block: "start" });
    showToast("Saved review restored.");
  }
});
document.getElementById("missingList").addEventListener("click", event => {
  const button = event.target.closest("[data-missing-field]");
  if (button) focusGuidedFact(button.dataset.missingField);
});
document.querySelectorAll("[data-fact]").forEach(input => {
  input.addEventListener("input", updateGuidedFactsButton);
});
document.getElementById("guidedFactsVerified").addEventListener("change", updateGuidedFactsButton);
document.getElementById("applyGuidedFacts").addEventListener("click", applyGuidedFacts);
document.getElementById("clearHistoryButton").addEventListener("click", () => {
  if (!reviews.length) return;
  if (!window.confirm("Delete all saved reviews from this browser?")) return;
  try {
    localStorage.removeItem(HISTORY_KEY);
  } catch (error) {
    console.error("Could not clear review history:", error);
    showError("Could not remove reviews from this browser. Check your browser storage settings.");
    return;
  }
  reviews = [];
  resetAnalysis();
  renderHistory();
  showToast("All saved reviews were removed.");
});
document.querySelectorAll("[data-copy]").forEach(button => {
  button.addEventListener("click", () => copyText(document.getElementById(button.dataset.copy).textContent));
});
document.querySelectorAll("[data-edit]").forEach(button => {
  button.addEventListener("click", () => editGeneratedCopy(button));
});
document.querySelector(".advice-groups").addEventListener("click", event => {
  const button = event.target.closest("[data-suggestion]");
  if (!button || !activeReview) return;
  const key = button.dataset.suggestion;
  const completed = new Set(activeReview.completedSuggestions);
  if (completed.has(key)) completed.delete(key);
  else completed.add(key);
  activeReview.completedSuggestions = [...completed];
  button.classList.toggle("is-done", completed.has(key));
  button.setAttribute("aria-pressed", String(completed.has(key)));
  updateQuickProgress();
  saveActiveReview();
});
document.getElementById("exportButton").addEventListener("click", exportReview);
document.getElementById("copyOptions").addEventListener("click", event => {
  const button = event.target.closest("[data-copy-tone]");
  if (button) applyCopyOption(button.dataset.copyTone);
});
document.getElementById("targetChannel").addEventListener("change", updateChannelPreset);
document.getElementById("titleCharacterLimit").addEventListener("input", updateChannelCopyState);
document.getElementById("descriptionCharacterLimit").addEventListener("input", updateChannelCopyState);
document.getElementById("copyChannelButton").addEventListener("click", copyFormattedListing);
document.getElementById("featureBuilder").addEventListener("submit", queueVerifiedFeature);
document.getElementById("featureInput").addEventListener("input", updateQueueFeatureButton);
document.getElementById("featureVerified").addEventListener("change", updateQueueFeatureButton);
document.getElementById("featureQueue").addEventListener("click", event => {
  const removeButton = event.target.closest("[data-remove-queued-feature]");
  if (!removeButton) return;
  queuedVerifiedFeatures.splice(Number(removeButton.dataset.removeQueuedFeature), 1);
  updateFeatureQueue();
  updateQueueFeatureButton();
});
document.getElementById("applyFeaturesButton").addEventListener("click", applyVerifiedFeatures);
elements.input.addEventListener("keydown", event => {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    event.preventDefault();
    analyzeListing();
  }
});

renderHistory();
updateGuidedFactsButton();
updateQueueFeatureButton();
updateFeatureQueue();
updateChannelCopyState();
importListingFromExtension();
