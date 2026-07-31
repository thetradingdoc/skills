import { chromium } from "playwright";

const APP = "http://localhost:5174";
// Reuse a persistent profile so the session survives between runs — sign in
// once in the window it opens and every later run is already authenticated.
const b = await chromium.launchPersistentContext("/tmp/flicker-profile", {
  headless: false,
  viewport: { width: 1600, height: 1000 },
});
const page = b.pages()[0] ?? (await b.newPage());

await page.addInitScript(() => {
  window.__events = { enter: 0, leave: 0, move: 0, mutations: 0 };
});

await page.goto(APP, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(4000);

if (!(await page.locator(".react-flow__node").count())) {
  console.log("\n  SIGN IN NOW in the window that opened, scan a repo, and switch to 2D.");
  console.log("  Waiting 90 seconds, then measuring automatically.\n");
  await page.waitForTimeout(90000);
}

const twoD = page.getByRole("button", { name: /^2D$/ });
if (await twoD.count()) { await twoD.first().click(); await page.waitForTimeout(2500); }

const node = page.locator(".react-flow__node").first();
if (!(await node.count())) {
  console.log("no nodes — sign in and scan a repo first, then rerun");
  await b.close();
  process.exit(0);
}

await page.evaluate(() => {
  const root = document.querySelector(".react-flow__renderer") ?? document.body;
  window.__events.mutationDetail = {};
  window.__obs = new MutationObserver((m) => {
    window.__events.mutations += m.length;
    for (const r of m) {
      const t = r.target;
      const key = (t.nodeName || "?") + "." + ((t.className || "") + "").split(" ")[0] +
        (r.type === "attributes" ? " [" + r.attributeName + "]" : " [" + r.type + "]");
      window.__events.mutationDetail[key] = (window.__events.mutationDetail[key] || 0) + 1;
    }
  });
  window.__obs.observe(root, { subtree: true, attributes: true, childList: true });
  ["mouseenter", "mouseleave", "mousemove"].forEach((t) =>
    root.addEventListener(t, () => { window.__events[t.replace("mouse", "")] += 1; }, true)
  );
});

const box = await node.boundingBox();
console.log("holding the mouse still on a node for 3 seconds…");
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.waitForTimeout(3000);

const r = await page.evaluate(() => window.__events);
console.log("\n  enter: " + r.enter + "   leave: " + r.leave + "   move: " + r.move + "   mutations: " + r.mutations);
console.log("\n  what is mutating:");
const top = Object.entries(r.mutationDetail || {}).sort((a,b)=>b[1]-a[1]).slice(0,8);
for (const [k,v] of top) console.log("    " + String(v).padStart(6) + "  " + k);
console.log("\n  expected while stationary: enter 1, leave 0, few mutations");
console.log("  repeated enter/leave  -> the node moves out from under the cursor");
console.log("  many mutations, no enter/leave -> something re-renders on a timer");

await page.screenshot({ path: "docs/flicker.png" });
await b.close();
