const assert = require("node:assert/strict");
const { test } = require("node:test");
const handler = require("../api/analyze");

const validModelResult = {
  summary: "The draft has a clear location and several useful property details.",
  quality_score: 72,
  score_breakdown: {
    completeness: 80,
    appeal: 70,
    readability: 75,
    photo_readiness: 60
  },
  missing_information: [{ field: "Price guide", why: "Buyers may want to understand the asking range." }],
  copy_options: [
    { tone: "Warm and welcoming", title: "Sunny 3-bedroom home near the park", description: "A bright home with a garden, close to the park." },
    { tone: "Premium and polished", title: "Elegant 3-bedroom residence near the park", description: "A bright residence with a garden, moments from the park." },
    { tone: "Clear and factual", title: "3-bedroom home with garden near the park", description: "The property has three bedrooms and a garden, and is close to the park." },
    { tone: "Short and punchy", title: "3-bedroom home, garden, great location", description: "Bright home with a garden near the park." }
  ],
  photo_suggestions: ["Add a well-lit photo of the living room."],
  feature_suggestions: ["If accurate, include the floor area."],
  lead_readiness_rationale: ""
};

function createResponse() {
  return {
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value;
    },
    end(value) {
      this.body = value;
    }
  };
}

function createRequest({ method = "POST", body, headers = {} } = {}) {
  return {
    method,
    body,
    headers: { host: "localhost:3000", ...headers }
  };
}

async function callHandler(request) {
  const response = createResponse();
  await handler(request, response);
  return { status: response.statusCode, headers: response.headers, body: JSON.parse(response.body) };
}

test("rejects methods other than POST", async () => {
  const response = await callHandler(createRequest({ method: "GET" }));
  assert.equal(response.status, 405);
  assert.equal(response.headers.Allow, "POST");
});

test("validates listing length before making an upstream request", async () => {
  const response = await callHandler(createRequest({ body: { listing: "too short" } }));
  assert.equal(response.status, 400);
  assert.match(response.body.error, /at least 20 characters/);
});

test("rejects cross-origin browser requests", async () => {
  const response = await callHandler(createRequest({
    body: { listing: "A sufficiently long property listing to review." },
    headers: { origin: "https://example.com" }
  }));
  assert.equal(response.status, 403);
});

test("returns a validated analysis from Groq", async t => {
  const originalFetch = global.fetch;
  const originalKey = process.env.GROQ_API_KEY;
  const originalModel = process.env.GROQ_MODEL;
  process.env.GROQ_API_KEY = "test-key";
  delete process.env.GROQ_MODEL;
  global.fetch = async (url, options) => {
    assert.equal(url, "https://api.groq.com/openai/v1/chat/completions");
    assert.equal(options.headers.Authorization, "Bearer test-key");
    const request = JSON.parse(options.body);
    assert.equal(request.model, "openai/gpt-oss-120b");
    assert.equal(request.max_completion_tokens, 3000);
    assert.equal(request.reasoning_effort, "low");
    assert.equal(request.response_format.json_schema.strict, true);
    assert.equal(request.response_format.json_schema.schema.additionalProperties, false);
    assert.match(request.messages[1].content, /Sunny 3-bedroom listing/);
    assert.match(request.messages[0].content, /copy option for each/);
    return {
      ok: true,
      async json() {
        return { choices: [{ message: { content: JSON.stringify(validModelResult) } }] };
      }
    };
  };
  t.after(() => {
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = originalKey;
    if (originalModel === undefined) delete process.env.GROQ_MODEL;
    else process.env.GROQ_MODEL = originalModel;
  });

  const response = await callHandler(createRequest({
    body: { listing: "Sunny 3-bedroom listing with a garden and a nearby park.", tone: "Warm and welcoming" }
  }));
  assert.equal(response.status, 200);
  assert.equal(response.body.analysis.quality_score, 73);
  assert.equal(response.body.analysis.lead_readiness, "Moderate");
  assert.equal(response.body.analysis.missing_information[0].field, "Price guide");
  assert.match(response.body.analysis.lead_readiness_rationale, /Adding Price guide/);
  assert.equal(response.body.analysis.listing_scorecard.completeness, 13);
  assert.equal(response.body.analysis.listing_scorecard.searchability, 43);
  assert.equal(response.body.analysis.listing_scorecard.missing_critical_count, 4);
  assert.equal(response.body.model, "openai/gpt-oss-120b");
});

test("does not call Groq when the API key is missing", async t => {
  const originalKey = process.env.GROQ_API_KEY;
  delete process.env.GROQ_API_KEY;
  t.after(() => {
    if (originalKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = originalKey;
  });

  const response = await callHandler(createRequest({
    body: { listing: "A sufficiently detailed property listing for this test." }
  }));
  assert.equal(response.status, 503);
  assert.match(response.body.error, /not configured/);
});

test("explains Groq model and request rejections", async t => {
  const originalFetch = global.fetch;
  const originalKey = process.env.GROQ_API_KEY;
  process.env.GROQ_API_KEY = "test-key";
  global.fetch = async () => ({
    ok: false,
    status: 400,
    async text() {
      return JSON.stringify({ error: { message: "The model is not available.", code: "model_not_found" } });
    }
  });
  t.after(() => {
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = originalKey;
  });

  const response = await callHandler(createRequest({
    body: { listing: "A sufficiently detailed property listing for this test." }
  }));
  assert.equal(response.status, 502);
  assert.match(response.body.error, /The model is not available/);
});

test("validates model score ranges instead of returning malformed results", () => {
  const malformed = {
    ...validModelResult,
    score_breakdown: { ...validModelResult.score_breakdown, appeal: 101 }
  };
  assert.throws(() => handler._test.validateAnalysis(malformed, "Warm and welcoming"), /invalid appeal score/);
});

test("scores listing completeness, clarity, searchability, and critical gaps deterministically", () => {
  const complete = handler._test.scoreListing(
    "AED 1,250,000 apartment located near the metro in Dubai Marina with 2 bedrooms and 2 bathrooms, covering 1,250 sq ft. The freehold home has an annual service fee and is vacant for viewing. It features a balcony, pool, and nearby shops."
  );
  assert.deepEqual(complete, {
    completeness: 100,
    clarity: 100,
    searchability: 100,
    missing_critical_count: 0,
    missing_critical_fields: []
  });

  const sparse = handler._test.scoreListing("Nice home.");
  assert.equal(sparse.completeness, 0);
  assert.equal(sparse.clarity, 76);
  assert.equal(sparse.searchability, 0);
  assert.equal(sparse.missing_critical_count, 5);
  assert.deepEqual(sparse.missing_critical_fields, ["Price", "Location", "Bedrooms", "Bathrooms", "Floor area"]);

  const longSentence = handler._test.scoreListing(
    "This exceptionally spacious residence offers a carefully arranged living and dining space with a well-appointed kitchen and a number of thoughtfully designed areas for comfortable everyday use throughout the home"
  );
  assert.ok(longSentence.clarity < 100);
});

test("requires exactly one safe copy option per writing style", () => {
  const analysis = handler._test.validateAnalysis(validModelResult, "Warm and welcoming");
  assert.equal(analysis.improved_title, analysis.copy_options[0].title);
  assert.equal(analysis.copy_options.length, 4);
  const premium = handler._test.validateAnalysis(validModelResult, "Premium and polished");
  assert.equal(premium.improved_title, "Elegant 3-bedroom residence near the park");
  assert.throws(() => handler._test.validateAnalysis({
    ...validModelResult,
    copy_options: validModelResult.copy_options.slice(1)
  }, "Warm and welcoming"), /invalid set of copy options/);
  assert.throws(() => handler._test.validateAnalysis({
    ...validModelResult,
    copy_options: validModelResult.copy_options.map(option => ({ ...option, tone: "Invented claims" }))
  }, "Warm and welcoming"), /invalid copy style/);
});

test("keeps oversized suggestion lists within the supported UI size", () => {
  const analysis = handler._test.validateAnalysis({
    ...validModelResult,
    feature_suggestions: [
      "One feature",
      "Two feature",
      "Three feature",
      "Four feature",
      "Five feature",
      "Six feature"
    ],
    copy_options: validModelResult.copy_options
  });
  assert.equal(analysis.feature_suggestions.length, 5);
  assert.equal(analysis.feature_suggestions[4], "Five feature");
});

test("limits analysis calls within a client rate-limit window", () => {
  const identity = `rate-limit-test-${Date.now()}`;
  const now = Date.now();
  for (let count = 0; count < 8; count += 1) {
    assert.equal(handler._test.checkLocalRateLimit(identity, now + count), true);
  }
  assert.equal(handler._test.checkLocalRateLimit(identity, now + 9), false);
  assert.equal(handler._test.checkLocalRateLimit(identity, now + 10 * 60 * 1000 + 1), true);
});
