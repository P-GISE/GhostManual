import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";

const ORIGIN = "https://ghostmanual.pigs0516.com";
const BRANCH = "refs/heads/codex/ghost-public-entry-check-20261026";
const VERSION = "1.63.0";
const MODES = { blank: "빈 공간 시작", example: "합성 예제 열기" };

function budget(mode, origin = ORIGIN) {
  let creates = 0;
  let violated = false;
  let approvedSent = 0;
  let fixtureAllowed = 0;
  let reason = "none";
  let resource = "none";
  const reject = (value) => {
    violated = true;
    reason = [
      "method",
      "payload",
      "duplicate",
      "api_path",
      "api_resource",
      "api_navigation",
      "api_frame",
      "read_redirect",
      "read_cookie",
      "read_error",
    ].includes(value)
      ? value
      : "unknown";
  };
  return {
    allow(request) {
      const url = new URL(request.url());
      if (url.origin !== origin) return false;
      if (["GET", "HEAD"].includes(request.method())) return true;
      if (request.method() === "POST" && url.pathname === "/api/workspaces" && !url.search) {
        creates++;
        resource = ["fetch", "xhr", "document", "other"].includes(request.resourceType())
          ? request.resourceType()
          : "unknown";
        try {
          const body = request.postDataJSON();
          if (creates === 1 && body?.mode === mode && Object.keys(body).length === 1) return true;
          reject(creates > 1 ? "duplicate" : "payload");
        } catch {
          reject("payload");
        }
        return false;
      }
      reject("method");
      return false;
    },
    valid: () => creates === 1 && !violated,
    reject,
    approved: (fixture) => {
      if (fixture) fixtureAllowed++;
      else approvedSent++;
    },
    snapshot: () => ({ reason, resource, attempts: creates, approvedSent, fixtureAllowed }),
  };
}

async function installTransport(context, mode, options = {}) {
  const limits = budget(mode, options.origin ?? ORIGIN);
  const { request } = await import("playwright");
  await context.addInitScript(() => {
    const nativeFetch = globalThis.fetch.bind(globalThis);
    Object.defineProperty(globalThis, "fetch", {
      value: (input, init) => nativeFetch(input, { ...init, redirect: "error" }),
      writable: false,
      configurable: false,
    });
  });
  await context.route("**/*", async (route) => {
    const current = route.request();
    if (!limits.allow(current)) return route.abort();
    const url = new URL(current.url());
    if (url.pathname.startsWith("/api/")) {
      let fromDocument = false;
      try {
        fromDocument = current.frame().parentFrame() === null;
      } catch {
        fromDocument = false;
      }
      const expected =
        current.method() === "POST"
          ? ["/api/workspaces"]
          : ["/api/session", "/api/manuals", "/api/sources"];
      const reason =
        url.search || !expected.includes(url.pathname)
          ? "api_path"
          : current.resourceType() !== "fetch"
            ? "api_resource"
            : current.isNavigationRequest()
              ? "api_navigation"
              : !fromDocument
                ? "api_frame"
                : null;
      if (reason) {
        limits.reject(reason);
        return route.abort();
      }
      if (current.method() === "POST") limits.approved(Boolean(options.fixture));
      if (options.fixture) return fixtureResponse(route, options.fixture, mode);
      return route.continue();
    }
    if (options.fixture) return fixtureResponse(route, options.fixture, mode);
    // A fresh isolated jar cannot seed the browser or later reads with response cookies.
    const reads = await request.newContext();
    let response;
    try {
      response = await reads.fetch(current, { maxRedirects: 0, maxRetries: 0, timeout: 20000 });
      const sessionCookie = response
        .headersArray()
        .some(
          (header) =>
            header.name.toLowerCase() === "set-cookie" &&
            /^\s*gm_(owner|reader)=/i.test(header.value),
        );
      if ((response.status() >= 300 && response.status() < 400) || sessionCookie) {
        limits.reject(sessionCookie ? "read_cookie" : "read_redirect");
        return await route.abort();
      }
      return await route.fulfill({ response });
    } catch {
      limits.reject("read_error");
      return route.abort();
    } finally {
      await response?.dispose();
      await reads.dispose();
    }
  });
  return { limits };
}

// All fixture requests are fulfilled in memory; this mode never contacts the public site.
async function fixtureResponse(route, fault, mode) {
  const path = new URL(route.request().url()).pathname;
  const expiry = "2030-01-01T00:00:00.000Z";
  if (path === "/") {
    const html = `<button onclick="start()">${MODES[mode]}</button><script>
      async function start() {
        const r = await fetch('/api/workspaces', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'${mode}'})});
        if (${fault === "duplicate"}) await fetch('/api/workspaces', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'blank'})}).catch(()=>{});
        await r.json();
        const s = await fetch('/api/session');
        if (s.status !== 200) return;
        history.pushState(null,'','/manuals');
        const lists = await Promise.all([fetch('/api/manuals'),fetch('/api/sources')]);
        if(lists.every(r=>r.status===200)) document.body.innerHTML='<h1>업무 문서함</h1>${mode === "blank" ? "<h3>아직 매뉴얼이 없습니다.</h3>" : '<label for="search">매뉴얼 제목 검색</label><input type="search" id="search">'}';
      }
    </script>`;
    return route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: html });
  }
  if (path === "/api/workspaces") {
    const headers =
      fault === "cookie"
        ? {}
        : {
            "Set-Cookie":
              "gm_owner=synthetic-private-cookie; Path=/; Secure; HttpOnly; SameSite=Lax",
          };
    return route.fulfill({
      status: 201,
      headers,
      contentType: "application/json",
      body: fault === "parse" ? "invalid" : JSON.stringify({ expiresAt: expiry }),
    });
  }
  if (path === "/api/session") {
    return route.fulfill({
      status: ["cookie", "session"].includes(fault) ? 401 : 200,
      contentType: "application/json",
      body: JSON.stringify({ role: "owner", expiresAt: expiry }),
    });
  }
  if (["/api/manuals", "/api/sources"].includes(path)) {
    return route.fulfill({
      status: fault === "manuals" && path === "/api/manuals" ? 401 : 200,
      contentType: "application/json",
      body: mode === "blank" ? "[]" : "[{}]",
    });
  }
  return route.abort();
}

async function runCase(browser, profile, engine, mode, options = {}) {
  const emit = options.emit ?? ((line) => process.stdout.write(`${line}\n`));
  const timeout = options.timeout ?? 20000;
  const context = await browser.newContext({
    ...profile,
    serviceWorkers: "block",
    acceptDownloads: false,
  });
  const transport = await installTransport(context, mode, options);
  const { limits } = transport;
  let stage = "anonymous";
  let status = 0;
  let passed = true;
  const record = (ok) => {
    passed &&= ok;
    emit(
      `public_entry engine=${engine} mode=${mode} stage=${stage} status=${status} result=${ok ? "pass" : "fail"}`,
    );
  };
  const require = (ok) => {
    record(ok);
    if (!ok) throw new Error("stage_failed");
  };
  try {
    require((await context.cookies()).length === 0);
    const page = await context.newPage();
    page.setDefaultTimeout(timeout);
    page.setDefaultNavigationTimeout(timeout);
    stage = "home";
    const home = await page.goto(`${ORIGIN}/`, { waitUntil: "domcontentloaded" });
    status = home?.status() ?? 0;
    require(status === 200 && new URL(page.url()).origin === ORIGIN);
    const response = (path, method) =>
      page
        .waitForResponse(
          (item) => {
            const url = new URL(item.url());
            return (
              url.origin === ORIGIN && url.pathname === path && item.request().method() === method
            );
          },
          { timeout },
        )
        .catch(() => null);
    const created = response("/api/workspaces", "POST");
    const session = response("/api/session", "GET");
    const manuals = response("/api/manuals", "GET");
    const sources = response("/api/sources", "GET");
    stage = "create";
    status = 0;
    await page.getByRole("button", { name: MODES[mode], exact: true }).click();
    const creation = await created;
    status = creation?.status() ?? 0;
    require(status === 201);
    stage = "create_json";
    const data = await creation.json();
    require(
      typeof data.expiresAt === "string" &&
        /^\d{4}-\d{2}-\d{2}T/.test(data.expiresAt) &&
        Number.isFinite(Date.parse(data.expiresAt)),
    );
    stage = "cookie";
    status = 0;
    const owner = (await context.cookies(ORIGIN)).filter((cookie) => cookie.name === "gm_owner");
    record(
      owner.length === 1 &&
        owner[0].secure &&
        owner[0].httpOnly &&
        owner[0].sameSite === "Lax" &&
        owner[0].path === "/",
    );
    stage = "session";
    const current = await session;
    status = current?.status() ?? 0;
    require(status === 200);
    stage = "session_json";
    const identity = await current.json();
    require(identity.role === "owner" && identity.expiresAt === data.expiresAt);
    stage = "navigation";
    status = 0;
    await page.waitForURL(`${ORIGIN}/manuals`, { timeout });
    record(true);
    for (const [name, pending] of [
      ["manuals", manuals],
      ["sources", sources],
    ]) {
      stage = name;
      const list = await pending;
      status = list?.status() ?? 0;
      require(status === 200);
      const values = await list.json();
      require(
        Array.isArray(values) && (mode === "blank" ? values.length === 0 : values.length > 0),
      );
    }
    stage = "ui";
    status = 0;
    await page.getByRole("heading", { name: "업무 문서함", exact: true }).waitFor();
    if (mode === "blank") {
      await page.getByRole("heading", { name: "아직 매뉴얼이 없습니다.", exact: true }).waitFor();
    } else {
      await page.getByRole("searchbox", { name: "매뉴얼 제목 검색", exact: true }).waitFor();
    }
    require((await page.locator("[role=alert].error").count()) === 0);
  } catch {
    record(false);
  } finally {
    stage = "request_budget";
    status = 0;
    record(limits.valid());
    const guard = limits.snapshot();
    emit(
      `public_guard engine=${engine} mode=${mode} phase=${options.fixture ? "synthetic" : "public"} reason=${guard.reason} resource=${guard.resource} attempts=${guard.attempts} approved_sent=${guard.approvedSent} fixture_allowed=${guard.fixtureAllowed}`,
    );
    stage = "cleanup";
    try {
      await context.close();
    } catch {
      record(false);
    }
  }
  return passed;
}

async function redirectTests(browser, profile) {
  let followups = 0;
  let creates = 0;
  let code = 307;
  let target = "/followup";
  let nativeCookie = false;
  const server = createServer((request, response) => {
    if (request.url === "/api/workspaces") {
      creates++;
      response.writeHead(
        nativeCookie ? 201 : code,
        nativeCookie
          ? { "Set-Cookie": "gm_owner=synthetic-native-cookie; Path=/; HttpOnly; SameSite=Lax" }
          : { Location: target },
      );
    } else if (request.url === "/api/session") {
      response.writeHead(
        request.headers.cookie?.includes("gm_owner=synthetic-native-cookie") ? 200 : 401,
      );
    } else if (request.url === "/jump" || request.url === "/asset") {
      response.writeHead(code, { Location: target });
    } else if (request.url === "/cookie") {
      response.writeHead(200, {
        "Set-Cookie": "gm_owner=synthetic-forbidden-cookie; Path=/; HttpOnly; SameSite=Lax",
      });
    } else if (request.url === "/followup") {
      followups++;
      response.writeHead(200);
    } else {
      response.writeHead(200, { "Content-Type": "text/html" });
    }
    response.end("synthetic");
  });
  const foreign = createServer((_request, response) => {
    followups++;
    response.writeHead(200, { "Access-Control-Allow-Origin": "*" });
    response.end("synthetic");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  await new Promise((resolve) => foreign.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const redirectCode of [307, 308]) {
      for (const crossOrigin of [false, true]) {
        code = redirectCode;
        target = crossOrigin ? `http://127.0.0.1:${foreign.address().port}/followup` : "/followup";
        followups = 0;
        creates = 0;
        const context = await browser.newContext(profile);
        await installTransport(context, "blank", { origin });
        try {
          const page = await context.newPage();
          await page.goto(origin);
          await page.evaluate(async () => {
            try {
              await fetch("/api/workspaces", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ mode: "blank" }),
              });
            } catch {
              return;
            }
          });
          process.stdout.write(
            `redirect_self_test status=${code} creates=${creates} followups=${followups}\n`,
          );
          assert.equal(creates, 1);
          assert.equal(followups, 0);
        } finally {
          await context.close();
        }
      }
    }
    for (const redirectCode of [307, 308]) {
      for (const crossOrigin of [false, true]) {
        code = redirectCode;
        target = crossOrigin ? `http://127.0.0.1:${foreign.address().port}/followup` : "/followup";
        followups = 0;
        const context = await browser.newContext(profile);
        await installTransport(context, "blank", { origin });
        try {
          const page = await context.newPage();
          await page.goto(origin);
          const loaded = await page.evaluate(
            () =>
              new Promise((resolve) => {
                const image = new Image();
                image.onload = () => resolve(true);
                image.onerror = () => resolve(false);
                image.src = "/asset";
              }),
          );
          assert.equal(loaded, false);
          let navigated = true;
          try {
            await page.goto(`${origin}/jump`);
          } catch {
            navigated = false;
          }
          assert.equal(navigated, false);
          assert.equal(followups, 0);
          process.stdout.write(
            `redirect_read_self_test status=${code} followups=${followups} result=pass\n`,
          );
        } finally {
          await context.close();
        }
      }
    }
    const context = await browser.newContext(profile);
    await installTransport(context, "blank", { origin });
    try {
      let page = await context.newPage();
      let accepted = true;
      try {
        await page.goto(`${origin}/cookie`);
      } catch {
        accepted = false;
      }
      assert.equal(accepted, false);
      assert.equal(
        (await context.cookies()).some((cookie) => cookie.name === "gm_owner"),
        false,
      );
      process.stdout.write("cookie_isolation_self_test stored=0 result=pass\n");
      await page.close();
      page = await context.newPage();
      await page.goto(origin);
      const anonymous = await page.evaluate(async () => (await fetch("/api/session")).status);
      assert.equal(anonymous, 401);
      nativeCookie = true;
      creates = 0;
      const statuses = await page.evaluate(async () => {
        const created = await fetch("/api/workspaces", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "blank" }),
        });
        const session = await fetch("/api/session");
        return [created.status, session.status];
      });
      assert.deepEqual(statuses, [201, 200]);
      assert.equal(creates, 1);
      const owner = (await context.cookies()).filter((cookie) => cookie.name === "gm_owner");
      assert.equal(owner.length, 1);
      assert.equal(owner[0].httpOnly, true);
      assert.equal(owner[0].sameSite, "Lax");
      assert.equal(owner[0].path, "/");
      assert.equal(await page.evaluate(() => document.cookie.includes("gm_owner")), false);
      const duplicate = await page.evaluate(async () => {
        try {
          await fetch("/api/workspaces", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mode: "blank" }),
          });
          return true;
        } catch {
          return false;
        }
      });
      assert.equal(duplicate, false);
      assert.equal(creates, 1);
      process.stdout.write(
        "native_cookie_self_test anonymous=401 create=201 session=200 result=pass\n",
      );
    } finally {
      await context.close();
    }
    const rejectedContext = await browser.newContext(profile);
    await installTransport(rejectedContext, "blank", { origin });
    try {
      const page = await rejectedContext.newPage();
      await page.goto(origin);
      creates = 0;
      const loaded = await page.evaluate(
        () =>
          new Promise((resolve) => {
            const xhr = new XMLHttpRequest();
            xhr.open("POST", "/api/workspaces");
            xhr.setRequestHeader("Content-Type", "application/json");
            xhr.onload = () => resolve(true);
            xhr.onerror = () => resolve(false);
            xhr.send(JSON.stringify({ mode: "blank" }));
          }),
      );
      assert.equal(loaded, false);
      assert.equal(creates, 0);
      process.stdout.write("non_fetch_post_self_test creates=0 result=pass\n");
    } finally {
      await rejectedContext.close();
    }
  } finally {
    await Promise.all([
      new Promise((resolve) => server.close(resolve)),
      new Promise((resolve) => foreign.close(resolve)),
    ]);
  }
}

async function selfTest(engine) {
  if (!["chromium", "webkit"].includes(engine)) throw new Error("engine_guard");
  const playwright = await import("playwright");
  const profile = engine === "webkit" ? playwright.devices["iPhone 13"] : {};
  const browser = await playwright[engine].launch({
    channel: process.platform === "win32" && engine === "chromium" ? "chrome" : undefined,
  });
  try {
    for (const [fault, mode] of [
      ["none", "blank"],
      ["none", "example"],
      ["cookie", "blank"],
      ["session", "blank"],
      ["manuals", "blank"],
      ["parse", "blank"],
      ["duplicate", "blank"],
    ]) {
      const lines = [];
      const result = await runCase(browser, profile, engine, mode, {
        fixture: fault,
        emit: (line) => lines.push(line),
        timeout: 2000,
      });
      if (result !== (fault === "none")) {
        for (const line of lines) process.stdout.write(`${line}\n`);
      }
      assert.equal(result, fault === "none");
      assert.ok(lines.some((line) => line.startsWith("public_guard ")));
      assert.ok(
        lines.some((line) =>
          line.endsWith(
            `attempts=${fault === "duplicate" ? 2 : 1} approved_sent=0 fixture_allowed=1`,
          ),
        ),
      );
      const expectedFailure = {
        cookie: "cookie",
        session: "session",
        manuals: "manuals",
        parse: "create_json",
        duplicate: "request_budget",
      }[fault];
      if (expectedFailure)
        assert.ok(
          lines.some(
            (line) => line.includes(`stage=${expectedFailure} `) && line.endsWith("result=fail"),
          ),
        );
      assert.ok(
        lines.every(
          (line) =>
            /^public_entry engine=(chromium|webkit) mode=(blank|example) stage=[a-z_]+ status=\d{1,3} result=(pass|fail)$/.test(
              line,
            ) ||
            /^public_guard engine=(chromium|webkit) mode=(blank|example) phase=(synthetic|public) reason=(none|method|payload|duplicate|api_path|api_resource|api_navigation|api_frame|read_redirect|read_cookie|read_error|unknown) resource=(none|fetch|xhr|document|other|unknown) attempts=\d+ approved_sent=\d+ fixture_allowed=\d+$/.test(
              line,
            ),
        ),
      );
      assert.ok(lines.every((line) => !line.includes("synthetic-private-cookie")));
    }
    process.stdout.write("public_entry_self_test scenarios=7 result=pass\n");
    await redirectTests(browser, profile);
  } finally {
    await browser.close();
  }
}

async function main() {
  if (process.argv[2] === "--self-test") return selfTest(process.argv[3] ?? "chromium");
  const engine = process.argv[2];
  if (
    !["chromium", "webkit"].includes(engine) ||
    process.env.CI !== "true" ||
    process.env.GITHUB_REPOSITORY !== "P-GISE/GhostManual" ||
    process.env.GITHUB_REF !== BRANCH ||
    process.env.GITHUB_EVENT_NAME !== "workflow_dispatch" ||
    process.env.PUBLIC_ENTRY_PHASE !== "live-reviewed" ||
    process.env.GITHUB_RUN_ATTEMPT !== "1" ||
    process.env.PUBLIC_ENTRY_APPROVED !== "four-synthetic-spaces"
  ) {
    throw new Error("execution_guard");
  }
  const lock = JSON.parse(await readFile(new URL("../package-lock.json", import.meta.url), "utf8"));
  if (lock.packages["node_modules/playwright"].version !== VERSION)
    throw new Error("version_guard");
  const playwright = await import("playwright");
  const profile = engine === "webkit" ? playwright.devices["iPhone 13"] : {};
  const browser = await playwright[engine].launch();
  try {
    for (const mode of Object.keys(MODES)) {
      if (!(await runCase(browser, profile, engine, mode))) process.exitCode = 1;
    }
  } finally {
    await browser.close();
  }
}

main().catch(() => {
  process.stdout.write("public_entry stage=guard_or_runtime status=0 result=fail\n");
  process.exitCode = 1;
});
