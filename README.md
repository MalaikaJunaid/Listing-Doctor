# Listing Doctor

Listing Doctor is an AI-assisted property-listing copilot. It helps an agent improve a draft, check whether important details are present, choose a writing style, work through photo ideas, and export copy for further review.

> **Project status:** This is a working product prototype, not a Property Finder product or an officially integrated Property Finder service. It has no user accounts, shared team workspace, listing-portal connection, or publishing capability. AI-generated content and text-based scores need human review.

## What it does

### 1. Listing review and AI assessment

An agent pastes or imports up to 5,000 characters of listing text and chooses one of four tones: Warm and welcoming, Premium and polished, Clear and factual, or Short and punchy. After the agent selects **Analyze**, the browser sends the draft and tone to the app's server-side API. The API asks Groq for a structured review that includes:

- A short summary and an AI quality assessment.
- Details the draft may be missing, with explanations.
- A title and description in each of the four tones.
- Photo ideas and feature ideas. Feature ideas are prompts, not claims that the home has those features.
- A relative listing-readiness label and explanation.

The selected tone determines the initial title and description. Agents can switch between the returned tone options, edit the selected title or description, copy either field, and export a text report.

The AI prompt instructs the model to treat the listing as untrusted input, use only explicitly stated facts, avoid inventing property claims, and avoid protected-characteristic language or audience steering. The server validates the structured response and derives a weighted AI quality score from the model's score breakdown:

| AI assessment component | Weight |
|---|---:|
| Completeness | 35% |
| Appeal | 25% |
| Readability | 25% |
| Photo readiness | 15% |

This is an AI assessment, not the deterministic scorecard below. The separate lead-readiness label is derived from this AI score: 75 or higher is “High readiness,” 50–74 is “Moderate,” and below 50 is “Needs a boost.” It is not a forecast of views, enquiries, offers, or sales.

### 2. Listing completeness scorecard

The scorecard is a deterministic server-side text heuristic. It is intentionally separate from the AI's opinion so agents can see what the app actually checked.

| Metric | What it checks | Calculation |
|---|---|---|
| **Completeness** | Price, location, bedrooms, bathrooms, floor area, tenure, fees, availability/viewing | Percentage of 8 keyword-pattern groups detected in the original draft. |
| **Clarity** | Average words in each sentence or non-empty line | Average of 8–20 words scores 100. Subtract 4 points per word below 8 or 3 points per word above 20; clamp the result to 0–100. |
| **Searchability** | Property type, location, beds, baths, floor area, property features, nearby amenities | Percentage of 7 keyword-pattern groups detected in the draft. It is not a search ranking or portal placement prediction. |
| **Missing critical fields** | Price, location, bedroom count, bathroom count, floor area | Count and names of the five critical-field patterns not detected. |

The keyword groups are deliberately simple. A detail may be present but missed if expressed with an unrecognized phrase; a detected word does not mean the fact is true, complete, legally sufficient, or formatted correctly for a portal. Review the source and local listing rules before publishing.

### 3. Guided completeness and verified facts

- **Guided completeness:** Optional fields cover asking price, location, bedrooms, bathrooms, floor area, tenure, fees, and availability/viewing. An agent must affirm that the entered details are accurate before the app adds them to the listing text.
- **Missing-detail shortcuts:** An AI-identified missing field can open the guided fields at the likely matching input. The AI list and deterministic scorecard are separate checks, so they may not match exactly.
- **Verified property-detail composer:** Agents can add a categorized detail not covered by the fixed fields, explicitly confirm it, queue up to eight details, remove queued details, and add confirmed details to the draft. Duplicate queue entries are prevented.
- Changing the source draft invalidates the displayed analysis. The agent can run analysis again with their updated text. Listing details added to the draft are sent to Groq only if the agent analyzes again.

The confirmation is a user workflow safeguard, not independent verification by Listing Doctor.

### 4. Photo ideas and quick wins

The review displays AI photo and feature suggestions as clickable checklist items. Agents can track completed quick wins; the browser saves their completion state with the review. This is a planning checklist only: there is no image upload, image-quality analysis, photo storage, or photo publishing.

### 5. Channel copy guides

Agents can choose generic Property portal, Social post, or Print flyer presets, or enter custom title and description character guides. The interface shows character counts and disables copy when a field exceeds the selected guide. The copy action combines the chosen title and description.

The presets are editable examples, not official Property Finder or other portal specifications. Confirm the destination's current limits and content rules. The text export also includes the active channel and guide counts.

### 6. History, reuse, and export

- Up to eight recent reviews are held in browser `localStorage`; they are not attached to an account or synchronized between browsers.
- Restore a saved review, delete one review, clear the local history, or start a new draft using a saved listing as its starting text.
- Export a plain-text report with the current copy, scorecard, separate AI assessment, missing-information prompts, suggestions, selected tone/channel, and completed quick wins.
- **Ctrl+Enter** (or **Command+Enter** on macOS) starts analysis.

### 7. Browser extension

The optional Chrome/Edge Manifest V3 extension provides a toolbar popup and a right-click action for selected text. It opens the configured Listing Doctor URL with the selected text prefilled; it does not crawl pages or send the text to Groq itself. The app removes the imported text from the URL fragment after loading. The extension is supplied for unpacked developer installation and is not published in a browser store.

## How a request works

```text
Browser UI or extension selection
  -> Listing Doctor page (draft remains in the browser)
  -> POST /api/analyze with listing text + selected tone
  -> Vercel serverless handler (or local Node development server)
  -> Groq chat-completions API (server-side API key)
  -> validated structured AI review + deterministic scorecard
  -> browser renders the result and stores review in localStorage
```

The Groq key is never intended to be placed in frontend JavaScript or the extension. The extension only opens the app; the app makes the AI request after the agent selects Analyze.

## Technology and developer tools

| Area | Technology / tool | Role |
|---|---|---|
| UI | HTML, CSS, browser JavaScript | Responsive red-and-white interface, interactions, local review history, copy and export. No frontend framework or build step. |
| API | Node.js serverless function at `api/analyze.js` | Input validation, same-origin check, rate limiting, Groq request, schema validation, deterministic scorecard. |
| AI provider | Groq Chat Completions API | Generates the structured listing review; model defaults to `openai/gpt-oss-120b` and can be overridden with `GROQ_MODEL`. |
| Local development | Node.js 20+ and custom `scripts/dev-server.js` | Serves the UI, the API handler, and local assets on port 3000 by default; reads `.env.local` then `.env`. |
| Hosting | Vercel | Serves the static app and deploys `api/analyze.js` as a serverless function. |
| Optional shared rate limit | Upstash Redis REST API | Shared counter across serverless instances when configured; not required for local/small-scale use. |
| Browser companion | Chrome/Edge Manifest V3 | Explicitly imports user-selected text into the app. |
| Tests | Node built-in `node:test` and `node:assert` | Tests API validation, mocked Groq requests, scorecard calculations, and rate-limit behavior. |
| Dependencies | None at runtime or development | `package.json` defines scripts and Node engine; it does not add npm packages. |

### Important files

```text
api/analyze.js                       Vercel API, Groq integration, validation, scorecard
app.js                               Browser interactions, analysis rendering, history, export
index.html                           UI, styles, responsive layout, favicon reference
scripts/dev-server.js                Local Node server and .env loading
tests/api.test.js                    API and scorecard tests
browser-extension/manifest.json      Extension permissions and entry points
browser-extension/service-worker.js  Selection context menu and app launch
browser-extension/popup.*            Toolbar popup and selected-text action
browser-extension/options.*          Local/deployed app URL setting
listing-doctor-logo.jpg              Full Listing Doctor logo
ld-icon.jpg                          Website favicon image
vercel.json                          Function timeout and response headers
.env.example                         Safe template for local environment variables
```

## Run locally

1. Install Node.js 20 or newer.
2. No dependency installation is needed; the project uses Node built-ins only.
3. Copy `.env.example` to `.env` or `.env.local`; set `GROQ_API_KEY` to a key from [Groq Console](https://console.groq.com/keys). Environment files are gitignored; `.env.local` takes precedence over `.env`.
4. Run `npm run dev`, then open `http://localhost:3000`.
5. To check the API and scorecard, run `npm test`.

Opening `index.html` directly as a `file://` URL does not run the API. If port 3000 is already occupied, use another port such as PowerShell `$env:PORT=3101; npm run dev`.

## Deploy to Vercel

1. Push the project to a GitHub repository and import it into Vercel.
2. Keep the root directory as the project root. Vercel detects the `api/` function; no frontend framework or build command is required.
3. Set `GROQ_API_KEY` in **Project Settings → Environment Variables**. Optionally set `GROQ_MODEL` to a model available to your Groq account. Keep the key private.
4. Redeploy after changing environment variables.
5. Test the live site with **Try with a sample listing**.

### Rate limiting

The API allows up to 8 analyses per client identity in a 10-minute window. Without Redis, this is a best-effort per-process memory counter; serverless instances can restart or scale independently. For a shared Vercel limit, configure both `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`. If only one is set or the service fails, the API fails closed.

## Install the browser extension (Chrome or Edge)

1. Start the app locally or deploy it to Vercel.
2. Open `chrome://extensions` or `edge://extensions`, enable **Developer mode**, choose **Load unpacked**, and select the `browser-extension` folder.
3. Open the extension's **Details → Extension options** and set the app URL (for example `http://localhost:3000/` or your deployed HTTPS URL).
4. Select listing copy on a page and use the extension button or right-click **Review selection with Listing Doctor**.

The extension uses the browser's active-tab permission when invoked, does not read page content in the background, and does not send selected text to the AI. The app opens with the selection prefilled; the user decides whether to analyze it.

## How it could work with Property Finder

There is **no integration in this prototype**: it does not connect to Property Finder systems, import live listings, authenticate a Property Finder user, or publish changes. Incorporation would require an approved product and technical partnership, and the actual available integration points would need to be confirmed with Property Finder. A sensible product path would be:

1. **Start in the listing creation/editing flow.** Add a “Review with Listing Doctor” action beside the description fields. Send the existing draft and structured property fields to an approved backend endpoint, rather than asking agents to copy/paste or using a browser scraper.
2. **Use Property Finder's canonical listing data.** Analyze structured fields (price, location, beds, baths, area, amenities, availability) as well as copy. Keep source facts separate from generated wording; never let a rewrite silently alter structured facts.
3. **Return suggestions as a reviewable diff.** Show completeness gaps, score explanations, and alternative copy in a side panel. Let the agent preview each change and explicitly accept or reject it. Do not auto-publish.
4. **Save versioned drafts.** Associate a review with the listing ID, agent/team identity, timestamp, model/prompt version, and accepted changes under appropriate access controls. Preserve the ability to undo and compare versions.
5. **Validate against current portal rules.** Source field requirements and character limits from the portal's maintained schema/configuration, not hardcoded generic presets. Show whether a field is missing, invalid, or requires agent confirmation.
6. **Measure outcomes responsibly.** With approved, privacy-reviewed analytics, compare adoption, time-to-publish, correction/rejection rates, and downstream engagement. Use controlled experiments before claiming that a higher score produces more leads.

An integration could be embedded directly in Property Finder's web/mobile agent tools, or exposed through a partner API if one is approved. Either route should use Property Finder authentication and authorization, server-to-server credentials, data minimization, auditability, rate limits, retention controls, and a clear agent confirmation step. Do not send customer or listing data to an external AI provider until the data-processing, residency, security, and contractual requirements are approved. This README describes a proposed integration pattern, not a claim about Property Finder's APIs or internal systems.

## Product-builder review (prototype assessment)

If I were reviewing this as an AI Product Builder for Property Finder, I would rate the current prototype **6.5/10 as a product experiment**—promising enough to test with agents, but not ready to be embedded in a production portal.

| Dimension | Rating | Review |
|---|---:|---|
| Problem and workflow | 8/10 | A real agent job is addressed: improve draft quality and find missing details before publishing. The review, verified inputs, copy choices, checklist, and export create a coherent single-user workflow. |
| Trust and safety | 7/10 | The prompt explicitly discourages invented claims; server validates output; the scorecard is explainable; facts require user confirmation. But prompt rules and confirmation checkboxes do not prove accuracy. AI suggestions still need review and could be wrong. |
| Product differentiation | 6/10 | The combination of completeness checks, fact-safe rewrites, photo prompts, and channel guides is useful. Most of the differentiating workflow remains prototype-level and the channel presets are generic. |
| Usability and actionability | 7/10 | Copy variants, guided fields, missing-detail shortcuts, quick wins, extension import, and export make analysis actionable. There is no multi-agent collaboration, saved workspace, or direct listing-system handoff. |
| Measurement and evidence | 3/10 | There is no product analytics, agent feedback capture, experiment framework, or outcome evidence. “Lead readiness” is a label, not a prediction. |
| Production readiness | 4/10 | The frontend is lightweight and the API has validation and basic rate limiting, but there is no authentication, server-side persistence, organizational policy, operational monitoring, or verified Property Finder integration. |

**Why 6.5:** Good prototype scope, visible product thinking, and unusually clear separation between heuristic scores and AI opinion. The main gap is evidence and integration: the product does not yet know whether its checks are correct or improve agent outcomes, and it remains a standalone tool.

### What I would validate next

Run a small, consented agent pilot before expanding the feature set:

- How often do agents accept, edit, or reject each suggestion?
- Which completeness checks are useful, and which wording creates false alarms?
- Does the workflow reduce time to a publish-ready draft?
- How often do human reviewers find unsupported facts or compliance issues?
- Do agents return to the product or export the result?

Set guardrails and success criteria before the pilot—for example, a low unsupported-claim rate, high agent correction visibility, and a measurable reduction in time-to-ready—then iterate using observed results. Do not use the current scorecard as a proxy for listing performance or lead volume.

## Privacy, security, and limitations

- Listing text is sent to Groq only after the user selects **Analyze**. The app does not save listings to a server-side database.
- Successful reviews are stored in that browser's local storage (up to 8). They are not synced across devices and can be removed in the history UI or browser storage settings.
- The Groq API key belongs in server environment variables, never in the browser or extension.
- The extension passes selected text to the app in a URL fragment and the app removes the fragment after reading it. Avoid selecting sensitive or personal information.
- AI output can be inaccurate or non-compliant. An agent must verify facts, wording, permissions, and applicable advertising rules before publishing.
- Scorecard metrics use text patterns; they can miss equivalent wording and cannot verify truth. Searchability is not SEO ranking. Character guides are not official portal rules. Readiness is not a lead forecast.
- No login, roles, team review, cloud history, CRM/portal synchronization, image analysis, or automatic publishing is implemented.
- Without Upstash, rate limiting is not global across serverless instances. Configure Upstash for a shared deployment limit.
