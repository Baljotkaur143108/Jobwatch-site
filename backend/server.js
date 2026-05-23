"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const PORT = Number(process.env.PORT || 8787);
const MAX_BODY_BYTES = 256 * 1024;

loadEnvFile();

function loadEnvFile() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) return;

  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex < 0) continue;

    const key = trimmed.slice(0, equalsIndex).trim();
    const value = trimmed.slice(equalsIndex + 1).trim().replace(/^["']|["']$/g, "");
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

function jsonResponse(response, statusCode, body) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "POST, OPTIONS, GET",
    "access-control-allow-headers": "content-type, x-alert-secret",
  });
  response.end(JSON.stringify(body));
}

function htmlResponse(response, statusCode, html) {
  response.writeHead(statusCode, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "public, max-age=300",
  });
  response.end(html);
}

function safeHttpUrl(value, fallback = "") {
  const url = String(value || "").trim();
  return /^https?:\/\//i.test(url) ? url : fallback;
}

function renderLandingPage() {
  const landingPath = path.join(__dirname, "landing.html");
  const checkoutUrl = safeHttpUrl(process.env.STRIPE_CHECKOUT_URL, "https://buy.stripe.com/fZu00j4As2VK3aK3oQ2wU00");
  const storeUrl = safeHttpUrl(process.env.CHROME_WEB_STORE_URL);
  const privacyUrl = safeHttpUrl(
    process.env.PRIVACY_POLICY_URL,
    "https://github.com/Baljotkaur143108/Jobwatch-site/blob/main/PRIVACY.md",
  );
  const installHref = storeUrl || "#install";
  const installLabel = storeUrl ? "Add to Chrome" : "Chrome Web Store review pending";
  const installNote = storeUrl
    ? "Install from Chrome Web Store, then enter your Stripe billing email inside the extension."
    : "Chrome Web Store listing is being reviewed. This button will be updated as soon as the extension is approved.";

  return fs.readFileSync(landingPath, "utf8")
    .replaceAll("__CHECKOUT_URL__", checkoutUrl)
    .replaceAll("__STORE_URL__", storeUrl)
    .replaceAll("__PRIVACY_URL__", privacyUrl)
    .replaceAll("__INSTALL_HREF__", installHref)
    .replaceAll("__INSTALL_LABEL__", installLabel)
    .replaceAll("__INSTALL_NOTE__", installNote);
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";

    request.on("data", (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
        reject(new Error("Request body is too large."));
        request.destroy();
      }
    });

    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Invalid JSON body."));
      }
    });

    request.on("error", reject);
  });
}

function normalizePayload(payload) {
  const matches = Array.isArray(payload.matches) ? payload.matches : [];
  const cleanMatches = matches
    .map((match) => ({
      id: String(match.id || match.url || match.title || "").slice(0, 500),
      title: String(match.title || "New job match").slice(0, 300),
      company: String(match.company || payload.company || "Employer").slice(0, 120),
      url: String(match.url || "").slice(0, 1000),
      preferenceLabel: String(match.preferenceLabel || "").slice(0, 80),
      preferenceMatch: Boolean(match.preferenceMatch),
      shiftTags: Array.isArray(match.shiftTags) ? match.shiftTags.map(String).slice(0, 10) : [],
      jobTypeTags: Array.isArray(match.jobTypeTags) ? match.jobTypeTags.map(String).slice(0, 10) : [],
    }))
    .filter((match) => match.url || match.title);

  const filters = payload.filters && typeof payload.filters === "object" ? payload.filters : {};
  return {
    email: String(payload.email || "").trim(),
    telegramChatId: String(payload.telegramChatId || "").trim(),
    company: String(payload.company || "Canada Job Watcher").slice(0, 120),
    filters: {
      employers: Array.isArray(filters.employers) ? filters.employers.map(String).slice(0, 20) : [],
      keyword: String(filters.keyword || "").slice(0, 120),
      location: String(filters.location || "").slice(0, 120),
      cities: Array.isArray(filters.cities) ? filters.cities.map(String).slice(0, 30) : [],
      shifts: Array.isArray(filters.shifts) ? filters.shifts.map(String).slice(0, 10) : [],
      jobTypes: Array.isArray(filters.jobTypes) ? filters.jobTypes.map(String).slice(0, 10) : [],
      checkMode: String(filters.checkMode || "normal").slice(0, 40),
    },
    matches: cleanMatches.slice(0, 25),
  };
}

function buildAlertText(payload) {
  const lines = [
    `Canada Job Watcher: ${payload.matches.length} new match${payload.matches.length === 1 ? "" : "es"}`,
  ];

  const filters = [];
  if (payload.filters.employers.length) filters.push(`Employers: ${payload.filters.employers.join(", ")}`);
  if (payload.filters.keyword) filters.push(`Keyword: ${payload.filters.keyword}`);
  if (payload.filters.location) filters.push(`Location: ${payload.filters.location}`);
  if (payload.filters.cities.length) filters.push(`Cities: ${payload.filters.cities.join(", ")}`);
  if (payload.filters.shifts.length) filters.push(`Shifts: ${payload.filters.shifts.join(", ")}`);
  if (payload.filters.jobTypes.length) filters.push(`Job types: ${payload.filters.jobTypes.join(", ")}`);
  if (filters.length) lines.push("", ...filters);

  lines.push("");
  for (const match of payload.matches.slice(0, 10)) {
    const tags = [
      match.preferenceLabel,
      match.shiftTags.length ? `Shift: ${match.shiftTags.join(", ")}` : "",
      match.jobTypeTags.length ? `Type: ${match.jobTypeTags.join(", ")}` : "",
    ].filter(Boolean);
    lines.push(`- ${match.title}${tags.length ? ` (${tags.join(" | ")})` : ""}`);
    if (match.url) lines.push(`  ${match.url}`);
  }

  if (payload.matches.length > 10) {
    lines.push("", `Plus ${payload.matches.length - 10} more match${payload.matches.length - 10 === 1 ? "" : "es"}.`);
  }

  return lines.join("\n");
}

function buildAlertHtml(payload) {
  const escapeHtml = (value) =>
    String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const filterItems = [];
  if (payload.filters.employers.length) filterItems.push(`<li><strong>Employers:</strong> ${escapeHtml(payload.filters.employers.join(", "))}</li>`);
  if (payload.filters.keyword) filterItems.push(`<li><strong>Keyword:</strong> ${escapeHtml(payload.filters.keyword)}</li>`);
  if (payload.filters.location) filterItems.push(`<li><strong>Location:</strong> ${escapeHtml(payload.filters.location)}</li>`);
  if (payload.filters.cities.length) filterItems.push(`<li><strong>Cities:</strong> ${escapeHtml(payload.filters.cities.join(", "))}</li>`);
  if (payload.filters.shifts.length) filterItems.push(`<li><strong>Shifts:</strong> ${escapeHtml(payload.filters.shifts.join(", "))}</li>`);
  if (payload.filters.jobTypes.length) filterItems.push(`<li><strong>Job types:</strong> ${escapeHtml(payload.filters.jobTypes.join(", "))}</li>`);

  const matchItems = payload.matches
    .slice(0, 10)
    .map((match) => {
      const title = escapeHtml(match.title);
      const company = escapeHtml(match.company);
      const url = escapeHtml(match.url);
      const tags = [
        match.preferenceLabel,
        match.shiftTags.length ? `Shift: ${match.shiftTags.join(", ")}` : "",
        match.jobTypeTags.length ? `Type: ${match.jobTypeTags.join(", ")}` : "",
      ].filter(Boolean);
      return `<li><strong>${title}</strong><br><span>${company}</span>${tags.length ? `<br><em>${escapeHtml(tags.join(" | "))}</em>` : ""}${url ? `<br><a href="${url}">${url}</a>` : ""}</li>`;
    })
    .join("");

  return `<!doctype html>
<html>
  <body>
    <h2>${payload.matches.length} new job match${payload.matches.length === 1 ? "" : "es"}</h2>
    ${filterItems.length ? `<ul>${filterItems.join("")}</ul>` : ""}
    <ol>${matchItems}</ol>
  </body>
</html>`;
}

async function sendEmail(payload) {
  if (!payload.email) return { skipped: true, reason: "missing_email" };

  const apiKey = process.env.SENDGRID_API_KEY;
  const fromEmail = process.env.ALERT_FROM_EMAIL;
  if (!apiKey || !fromEmail) return { skipped: true, reason: "sendgrid_not_configured" };

  const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: payload.email }] }],
      from: {
        email: fromEmail,
        name: process.env.ALERT_FROM_NAME || "Canada Job Watcher",
      },
      subject: `${payload.matches.length} new Canada warehouse job match${payload.matches.length === 1 ? "" : "es"}`,
      content: [
        { type: "text/plain", value: buildAlertText(payload) },
        { type: "text/html", value: buildAlertHtml(payload) },
      ],
    }),
  });

  if (!response.ok) throw new Error(`SendGrid failed with ${response.status}: ${await response.text()}`);
  return { sent: true };
}

async function sendTelegram(payload) {
  if (!payload.telegramChatId) return { skipped: true, reason: "missing_telegram_chat_id" };

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return { skipped: true, reason: "telegram_not_configured" };

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: payload.telegramChatId,
      text: buildAlertText(payload).slice(0, 3900),
      disable_web_page_preview: true,
    }),
  });

  if (!response.ok) throw new Error(`Telegram failed with ${response.status}: ${await response.text()}`);
  return { sent: true };
}

function getStripeSecretKey() {
  return process.env.STRIPE_SECRET_KEY || "";
}

function formEncode(values) {
  return new URLSearchParams(values).toString();
}

async function stripeRequest(pathname, options = {}) {
  const secretKey = getStripeSecretKey();
  if (!secretKey) {
    const error = new Error("Stripe is not configured.");
    error.statusCode = 503;
    throw error;
  }

  const response = await fetch(`https://api.stripe.com/v1${pathname}`, {
    method: options.method || "GET",
    headers: {
      authorization: `Bearer ${secretKey}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: options.body ? formEncode(options.body) : undefined,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.error?.message || `Stripe failed with ${response.status}.`);
    error.statusCode = response.status;
    throw error;
  }

  return data;
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

async function findStripeCustomerByEmail(email) {
  const cleanEmail = normalizeEmail(email);
  if (!cleanEmail) return null;

  const escapedEmail = cleanEmail.replace(/'/g, "\\'");
  const result = await stripeRequest(`/customers/search?${formEncode({ query: `email:'${escapedEmail}'`, limit: "1" })}`);
  return Array.isArray(result.data) && result.data.length ? result.data[0] : null;
}

async function getActiveSubscription(customerId) {
  if (!customerId) return null;

  const result = await stripeRequest(`/subscriptions?${formEncode({ customer: customerId, status: "all", limit: "10" })}`);
  const subscriptions = Array.isArray(result.data) ? result.data : [];
  return subscriptions.find((subscription) => ["active", "trialing"].includes(subscription.status)) || null;
}

async function lookupSubscriptionByEmail(email) {
  const customer = await findStripeCustomerByEmail(email);
  if (!customer) return { active: false, status: "inactive", message: "No Stripe customer found for that email." };

  const subscription = await getActiveSubscription(customer.id);
  if (!subscription) {
    return {
      active: false,
      status: "inactive",
      customerId: customer.id,
      message: "No active subscription found for that email.",
    };
  }

  return {
    active: true,
    status: subscription.status,
    customerId: customer.id,
    subscriptionId: subscription.id,
    currentPeriodEnd: subscription.current_period_end || null,
  };
}

async function handleLicenseCheck(request, response) {
  const body = await readJsonBody(request);
  const email = normalizeEmail(body.email);
  if (!email) {
    jsonResponse(response, 400, { active: false, status: "inactive", message: "Enter your Stripe billing email." });
    return;
  }

  const result = await lookupSubscriptionByEmail(email);
  jsonResponse(response, 200, result);
}

async function handleBillingPortal(request, response) {
  const body = await readJsonBody(request);
  const email = normalizeEmail(body.email);
  if (!email) {
    jsonResponse(response, 400, { ok: false, error: "Enter your Stripe billing email." });
    return;
  }

  const subscription = await lookupSubscriptionByEmail(email);
  if (!subscription.active || !subscription.customerId) {
    jsonResponse(response, 404, { ok: false, error: subscription.message || "No active subscription found." });
    return;
  }

  const returnUrl = String(body.returnUrl || process.env.STRIPE_PORTAL_RETURN_URL || "https://chrome.google.com/webstore").slice(0, 1000);
  const session = await stripeRequest("/billing_portal/sessions", {
    method: "POST",
    body: {
      customer: subscription.customerId,
      return_url: returnUrl,
    },
  });

  jsonResponse(response, 200, { ok: true, url: session.url });
}

async function handleNotify(request, response) {
  const sharedSecret = process.env.ALERT_SHARED_SECRET;
  if (sharedSecret && request.headers["x-alert-secret"] !== sharedSecret) {
    jsonResponse(response, 401, { ok: false, error: "Unauthorized" });
    return;
  }

  const payload = normalizePayload(await readJsonBody(request));
  if (!payload.matches.length) {
    jsonResponse(response, 400, { ok: false, error: "No matches were provided." });
    return;
  }

  const results = {};
  const errors = [];

  try {
    results.email = await sendEmail(payload);
  } catch (error) {
    errors.push(error.message || "Email failed.");
    results.email = { sent: false };
  }

  try {
    results.telegram = await sendTelegram(payload);
  } catch (error) {
    errors.push(error.message || "Telegram failed.");
    results.telegram = { sent: false };
  }

  if (errors.length) {
    jsonResponse(response, 502, { ok: false, errors, results });
    return;
  }

  jsonResponse(response, 200, { ok: true, results });
}

const server = http.createServer(async (request, response) => {
  try {
    if (request.method === "OPTIONS") {
      jsonResponse(response, 204, {});
      return;
    }

    if (request.method === "GET" && (request.url === "/" || request.url === "/index.html")) {
      htmlResponse(response, 200, renderLandingPage());
      return;
    }

    if (request.method === "GET" && request.url === "/health") {
      jsonResponse(response, 200, { ok: true });
      return;
    }

    if (request.method === "POST" && request.url === "/billing/license") {
      await handleLicenseCheck(request, response);
      return;
    }

    if (request.method === "POST" && request.url === "/billing/portal") {
      await handleBillingPortal(request, response);
      return;
    }

    if (request.method === "POST" && request.url === "/alerts/notify") {
      await handleNotify(request, response);
      return;
    }

    jsonResponse(response, 404, { ok: false, error: "Not found" });
  } catch (error) {
    jsonResponse(response, error.statusCode || 500, { ok: false, error: error.message || "Server error" });
  }
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Job watcher alert backend listening on http://localhost:${PORT}`);
  });
}

module.exports = {
  buildAlertText,
  normalizePayload,
  server,
};
