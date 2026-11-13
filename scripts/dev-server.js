const http = require("node:http");
const { readFileSync } = require("node:fs");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const analyzeHandler = require("../api/analyze");

const root = path.resolve(__dirname, "..");
const port = Number(process.env.PORT || 3000);
const MAX_BODY_BYTES = 22_000;
const staticFiles = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
  ["/listing-doctor-logo.jpg", ["listing-doctor-logo.jpg", "image/jpeg"]],
  ["/ld-icon.jpg", ["ld-icon.jpg", "image/jpeg"]]
]);

for (const filename of [".env.local", ".env"]) {
  try {
    const localEnvironment = readFileSync(path.join(root, filename), "utf8");
    for (const line of localEnvironment.split(/\r?\n/)) {
      const entry = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!entry || Object.hasOwn(process.env, entry[1])) continue;
      const value = entry[2].replace(/^(?:"(.*)"|'(.*)')$/, (_, doubleQuoted, singleQuoted) => doubleQuoted ?? singleQuoted);
      process.env[entry[1]] = value;
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req, res) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      sendJson(res, 413, { error: "Request body is too large." });
      return null;
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    sendJson(res, 400, { error: "Send a valid JSON request body." });
    return null;
  }
}

const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, `http://${req.headers.host || "localhost"}`).pathname;
  if (pathname === "/api/analyze") {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      sendJson(res, 405, { error: "Use POST to analyze a listing." });
      return;
    }
    const body = await readJsonBody(req, res);
    if (body === null) return;
    req.body = body;
    await analyzeHandler(req, res);
    return;
  }

  const asset = staticFiles.get(pathname);
  if (!asset || !["GET", "HEAD"].includes(req.method)) {
    sendJson(res, 404, { error: "Not found." });
    return;
  }
  try {
    const content = await readFile(path.join(root, asset[0]));
    res.writeHead(200, {
      "Content-Type": asset[1],
      "Content-Length": content.length,
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "X-Frame-Options": "DENY",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=()"
    });
    res.end(req.method === "HEAD" ? undefined : content);
  } catch (error) {
    console.error("Could not serve app asset:", error);
    sendJson(res, 500, { error: "Could not load the app." });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Listing Doctor is running at http://localhost:${port}`);
  if (!process.env.GROQ_API_KEY) console.log("Set GROQ_API_KEY in .env or .env.local to enable live AI analysis.");
});
