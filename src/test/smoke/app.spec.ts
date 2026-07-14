import { expect, test, type Page } from "@playwright/test";

async function sendChatMessage(page: Page, message: string) {
  const input = page.getByLabel("Chat message");
  const send = page.getByLabel("Send");

  await expect(input).toBeEditable();
  await input.fill(message);
  await expect(send).toBeEnabled();
  await send.click();
  await expect(page.locator(".chat-status")).toContainText("READY");
}

test("loads the Engram shell", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "ENGRAM", exact: true })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "How Engram works" })).toHaveCount(0);
  await expect(page.getByLabel("Secondary views")).toBeVisible();
  await expect(page.getByLabel("Demo controls")).toBeVisible();
  await expect(page.getByLabel("Chat message")).toBeVisible();
  await expect(page.getByLabel("Engram mode")).toBeVisible();
});

test("opens a dedicated incident workspace beside the synchronized brain", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "Incidents: Diagnose and repair a memory incident" }).click();

  const shell = page.locator(".engram-shell");
  const stage = page.getByRole("region", { name: "Engram 3D brain scene" });
  const workbench = page.getByRole("complementary", { name: "Memory Incident Workspace" });
  await expect(shell).toHaveAttribute("data-product-mode", "investigate");
  await expect(shell).toHaveAttribute("data-workbench-open", "true");
  await expect(shell).toHaveAttribute("data-incident-open", "true");
  await expect(workbench).toBeVisible();
  await expect(page.getByLabel("Chat message")).toHaveCount(0);

  await expect
    .poll(async () => {
      const stageBox = await stage.boundingBox();
      const workbenchBox = await workbench.boundingBox();
      if (!stageBox || !workbenchBox) return Number.POSITIVE_INFINITY;
      return stageBox.x + stageBox.width - workbenchBox.x;
    })
    .toBeLessThanOrEqual(8);
});

test("loads a replayable sample memory incident from an empty investigation", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "Incidents: Diagnose and repair a memory incident" }).click();
  const incident = page.getByRole("complementary", { name: "Memory Incident Workspace" });
  await expect(incident).toContainText("Start with a bad agent answer");
  await page.getByRole("button", { name: "Load reference incident" }).click();

  await expect(incident).toContainText("What city do I live in now?");
  await expect(incident).toContainText("You live in San Francisco.");
  await expect(incident).toContainText("Oakland");
  await expect(incident).toContainText("A stale fact remained active");
  await expect(incident).toContainText("Prefer the current fact");
});

test("replays a recommended incident repair and saves the proof", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Incidents: Diagnose and repair a memory incident" }).click();
  await page.getByRole("button", { name: "Load reference incident" }).click();

  const incident = page.getByRole("complementary", { name: "Memory Incident Workspace" });
  await incident.getByRole("button", { name: "Replay this fix" }).click();
  await expect(incident).toContainText("Verified against the incident expectation", { timeout: 15_000 });
  await expect(incident).toContainText("Original");
  await expect(incident).toContainText("Branch");

  const regressionDownload = page.waitForEvent("download");
  await incident.getByRole("button", { name: "Save verified regression" }).click();
  expect((await regressionDownload).suggestedFilename()).toMatch(/\.engram-test\.json$/);
  await expect(incident.getByRole("button", { name: "Download regression again" })).toBeVisible();
});

test("promotes a recorded conversation answer into an incident", async ({ page }) => {
  await page.goto("/");
  await sendChatMessage(page, "I love the color indigo.");
  await sendChatMessage(page, "What color do I love?");

  await page.getByRole("button", { name: "Incidents: Diagnose and repair a memory incident" }).click();
  const incident = page.getByRole("complementary", { name: "Memory Incident Workspace" });
  await expect(incident.getByLabel("Recorded answers")).toContainText("What color do I love?");
  await incident.getByLabel("Expected answer").fill("violet");
  await incident.getByRole("button", { name: "Diagnose this turn" }).click();

  await expect(incident).toContainText("The answer ignored available memory");
  await expect(incident).toContainText("Expected");
  await expect(incident).toContainText("violet");
});

test("keeps the incident narrative primary on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Incidents: Diagnose and repair a memory incident" }).click();
  await page.getByRole("button", { name: "Load reference incident" }).click();

  const incident = page.getByRole("complementary", { name: "Memory Incident Workspace" });
  const box = await incident.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeLessThanOrEqual(1);
  expect(box!.width).toBeGreaterThanOrEqual(389);
  await expect(page.getByLabel("Chat message")).toHaveCount(0);
  await expect(incident.getByRole("button", { name: "Inspect Memory state evidence" })).toBeVisible();
  await expect(incident.getByRole("button", { name: "Replay this fix" })).toBeVisible();
});

test("branches and replays an immutable memory checkpoint", async ({ page }) => {
  await page.goto("/");

  await sendChatMessage(page, "I love the color indigo.");
  await expect(page.getByRole("button", { name: "Story 1" })).toBeVisible({ timeout: 12_000 });
  await sendChatMessage(page, "What color do I love?");
  await expect(page.getByRole("button", { name: "Story 2" })).toBeVisible({ timeout: 12_000 });

  await page.getByRole("button", { name: "Incidents: Diagnose and repair a memory incident" }).click();
  await page.getByText("Advanced tools", { exact: true }).click();
  await page.getByRole("button", { name: "Time Machine" }).click();
  const timeMachine = page.getByRole("complementary", { name: "Memory Time Machine" });
  await expect(timeMachine).toContainText("What color do I love?");
  await expect(timeMachine.getByLabel("Investigation workflow")).toContainText("Create regression");
  await timeMachine.getByRole("button", { name: "Quarantine" }).click();
  await expect(timeMachine).toContainText("Quarantined from branch");
  await expect(timeMachine.locator('[aria-current="step"]')).toContainText("Compare");
  await timeMachine.getByRole("button", { name: "Replay branch" }).click();
  await expect(timeMachine.getByRole("region", { name: "Branch replay result" })).toContainText(
    "The answer changed",
    { timeout: 12_000 }
  );
  await expect(timeMachine.locator('[aria-current="step"]')).toContainText("Save");
  const regressionDownload = page.waitForEvent("download");
  await timeMachine.getByRole("button", { name: "Save regression" }).click();
  await expect(timeMachine).toContainText("Regression saved");
  expect((await regressionDownload).suggestedFilename()).toMatch(/\.engram-test\.json$/);
  await page.getByRole("button", { name: "Learn: Explore how memory works" }).click();
  await expect(page.getByRole("button", { name: "Memories 1" })).toBeVisible();
});

test("starts directly without an onboarding gate", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Start", exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Open how Engram works")).toBeVisible();
  await expect(page.getByLabel("Chat message")).toHaveValue("");
});

test("keeps the initial guide compact over the active brain", async ({ page }) => {
  await page.goto("/");

  const guide = await page.getByLabel("Demo controls").boundingBox();

  await expect(page.getByLabel("Current memory receipt")).toHaveCount(0);
  expect(guide).not.toBeNull();
  expect(guide!.height).toBeLessThan(62);
  expect(guide!.y).toBeGreaterThan(500);
});

test("opens a clean recording demo route", async ({ page }) => {
  await page.goto("/demo");

  await expect(page.getByRole("heading", { name: "ENGRAM", exact: true })).toBeVisible();
  await expect(page.getByLabel("Secondary views")).toHaveCount(0);
  await expect(page.getByLabel("Current memory receipt")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Exit recording mode" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Run demo" })).toBeVisible();
});

test("keeps the legacy live recorder out of the production browser surface", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Observe: Inspect an agent trace" }).click();
  const dialog = page.getByRole("dialog", { name: "Import a recorded trace" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("tab", { name: "Recorded" })).toBeVisible();
  await expect(dialog.getByRole("tab", { name: "Live" })).toHaveCount(0);

  const ingest = await page.request.post("/api/traces/live?channel=production-smoke", {
    data: {
      item: { object: "trace", id: "trace-smoke-live", workflow_name: "Live memory agent" }
    }
  });
  expect(ingest.status()).toBe(404);
});

test("exposes brain thumbnail metadata", async ({ page }) => {
  await page.goto("/");

  await expect(page.locator('link[rel="icon"][href$="/engram-icon.png"]')).toHaveCount(1);
  await expect(page.locator('meta[property="og:image"][content$="/engram-og.png"]')).toHaveCount(1);
  await expect(page.locator('meta[name="twitter:image"][content$="/engram-og.png"]')).toHaveCount(1);
  await expect(page.locator('script[src*="googletagmanager.com/gtag/js?id=G-DQX8CR91QK"]')).toHaveCount(1);
  await expect
    .poll(() => page.locator("script#google-analytics").evaluate((element) => element.textContent ?? ""), {
      timeout: 15_000
    })
    .toContain("G-DQX8CR91QK");
});

test("opens the combined conversation and memory story from the dock", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Story", exact: true }).click();
  await expect(page.getByRole("complementary", { name: "Memory story" })).toBeVisible();
});

test("opens Retrieval MRI after a memory recall", async ({ page }) => {
  await page.goto("/");

  await sendChatMessage(page, "I love the color indigo.");
  await expect(page.getByRole("button", { name: "Memories 1" })).toBeVisible({ timeout: 12_000 });
  await sendChatMessage(page, "What color do I love?");
  await page.getByRole("button", { name: "Incidents: Diagnose and repair a memory incident" }).click();
  await page.getByText("Advanced tools", { exact: true }).click();
  await page.getByRole("button", { name: "Retrieval MRI" }).click();
  const mri = page.getByRole("complementary", { name: "Retrieval MRI" });
  await expect(mri).toBeVisible();
  await expect(mri.getByLabel("Retrieval query")).toContainText("What color do I love?");
  await expect(mri.getByLabel("Retrieval pipeline")).toContainText("Candidates1Eligible1Selected1Loaded1");
  await expect(mri).toContainText(/color indigo/i);
});

test("audits the current memory state with observed integrity rules", async ({ page }) => {
  await page.goto("/");

  await sendChatMessage(page, "I love the color indigo.");
  await page.getByRole("button", { name: "Incidents: Diagnose and repair a memory incident" }).click();
  await page.getByText("Advanced tools", { exact: true }).click();
  const integrityButton = page.getByRole("button", { name: "Integrity" });
  await integrityButton.click();

  const integrity = page.getByRole("complementary", { name: "Memory Integrity" });
  await expect(integrity).toBeVisible();
  await expect(integrity).toContainText("Deterministic rule scan");
  await expect(integrity).toContainText("Risk points");
  await expect(integrity).toContainText(/Observed rule evidence|No rule violations found/);
  await expect(integrity).toContainText("not a probability");
});

test("runs the demo and focuses completed memory story turns", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "Run demo" }).click();
  await expect(page.getByRole("button", { name: "Stop demo" })).toBeVisible();
  await expect(page.getByLabel("Chat message")).toHaveValue("I love the color indigo.", { timeout: 30_000 });
  await expect(page.getByLabel("Demo controls")).toContainText("I love the color indigo.");
  await expect(page.locator(".chat-status")).toContainText("READY", { timeout: 45_000 });
  await page.getByRole("button", { name: "Stop demo" }).click({ force: true });
  await expect(page.getByLabel("Current memory receipt")).toContainText(/Stored|Preparing memory/i, { timeout: 12_000 });
  await page.getByRole("button", { name: /^Story(?: \d+)?$/ }).click({ force: true });
  const timeline = page.getByRole("complementary", { name: "Memory story" });
  await expect(timeline).toBeVisible();
  await expect(page.getByLabel("Timeline turn 1")).toBeVisible({ timeout: 12_000 });
  await page.getByLabel("Timeline turn 1").locator("button").first().click({ force: true });
  await expect(page.getByLabel("Timeline turn 1")).toHaveAttribute("data-active", "true");
  await expect(timeline).toContainText("Stored new memory", { timeout: 12_000 });
  await page.getByRole("button", { name: "Clear focus" }).click();
  await page.getByLabel("Close memory story").click();

  await page.getByRole("button", { name: "Run demo" }).click();
  await expect(page.getByRole("button", { name: "Story 2" })).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Stop demo" }).click({ force: true });
  await page.getByRole("button", { name: /^Story(?: \d+)?$/ }).click({ force: true });
  await expect(page.getByLabel("Timeline turn 2")).toBeVisible({ timeout: 12_000 });
});

test("exposes brain label and reset controls", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByLabel("Brain view controls")).toBeVisible();
  await page.getByLabel("Open how Engram works").click();
  await expect(page.getByRole("complementary", { name: "How Engram works" })).toBeVisible();
  await page.getByLabel("Close how Engram works").click();
  await page.getByLabel("Hide brain labels").click();
  await expect(page.getByLabel("Show brain labels")).toBeVisible();
  await expect(page.getByLabel("Reset brain view")).toBeVisible();
  await expect(page.getByLabel("Reset demo session")).toBeVisible();
});

test("resets the demo session from the brain controls", async ({ page }) => {
  await page.goto("/");

  await sendChatMessage(page, "I love the color indigo.");
  await expect(page.getByRole("button", { name: /^Memories [1-9]/ })).toBeVisible({ timeout: 10_000 });

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByLabel("Reset demo session").evaluate((element) => {
    (element as HTMLButtonElement).click();
  });

  await expect(page.getByLabel("Demo controls")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Memories [1-9]/ })).toHaveCount(0);
  await expect(page.getByLabel("Chat message")).toHaveValue("");
});

test("counts and browses the complete active memory library", async ({ page }) => {
  await page.goto("/");

  for (const [index, message] of ["I love the color indigo.", "I spend weekends climbing."].entries()) {
    await sendChatMessage(page, message);
    await expect(page.getByRole("button", { name: `Memories ${index + 1}` })).toBeVisible({ timeout: 12_000 });
  }

  const memories = page.getByRole("button", { name: "Memories 2" });
  await expect(memories).toBeVisible();
  await memories.click();
  const library = page.getByRole("complementary", { name: "Memory library" });
  await expect(library).toContainText("2 active");
  await expect(library).toContainText("indigo");
  await expect(library).toContainText("climbing");
});

test("opens region explanations from mobile shortcuts", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  await expect(page.getByLabel("Brain region shortcuts")).toBeVisible();
  await page.getByRole("button", { name: "Open New explanation" }).click();
  const regionPanel = page.getByRole("complementary", { name: "New Memories explanation" });
  await expect(regionPanel).toBeVisible();
  await expect(regionPanel).toContainText("durable facts land");
});

test("keeps mobile memory controls visually separated", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const topbar = await page.locator(".topbar").boundingBox();
  const shortcuts = await page.getByLabel("Brain region shortcuts").boundingBox();
  const guide = await page.getByLabel("Demo controls").boundingBox();

  expect(topbar).not.toBeNull();
  expect(shortcuts).not.toBeNull();
  expect(guide).not.toBeNull();
  expect(shortcuts!.y - (topbar!.y + topbar!.height)).toBeGreaterThan(10);
  expect(guide!.y - (shortcuts!.y + shortcuts!.height)).toBeGreaterThan(420);
  expect(guide!.height).toBeLessThan(54);
});

test("collapses secondary brain controls on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  await expect(page.getByLabel("Open brain controls")).toBeVisible();
  await expect(page.getByLabel("Reset demo session")).toBeHidden();
  await page.getByLabel("Open brain controls").click();
  await expect(page.getByLabel("Reset demo session")).toBeVisible();
  await expect(page.getByLabel("Close brain controls")).toBeVisible();
});

test("opens working memory details after retrieval", async ({ page }) => {
  await page.goto("/");

  await sendChatMessage(page, "I prefer deep red interfaces and dark dashboards.");
  await expect(page.getByRole("button", { name: /^Memories [1-9]/ })).toBeVisible({ timeout: 10_000 });

  await sendChatMessage(page, "What interface colors do I prefer?");

  const workingMemory = page.getByRole("button", {
    name: /Open working memory details: ([1-9]|10) of 10 loaded/i
  });
  await expect(workingMemory).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: /Inspect [1-9] used memor/i })).toBeVisible();
  await page.getByRole("button", { name: /Inspect [1-9] used memor/i }).click();
  await expect(page.getByLabel("Active context panel")).toContainText("loaded into active context");
  await page.getByLabel("Close active context").click();
  await page.getByRole("button", { name: /^Working [1-9]/ }).click({ force: true });
  await expect(page.getByLabel("Active context panel")).toContainText("loaded into active context");
});

test("switches between the anatomical brain and semantic memory map without changing memory state", async ({ page }) => {
  await page.goto("/");

  await sendChatMessage(page, "I love the color indigo.");
  await expect(page.getByRole("button", { name: "Memories 1" })).toBeVisible({ timeout: 12_000 });

  const semanticMap = page.getByRole("radio", { name: "Retrieval space" });
  await expect(semanticMap).toBeVisible();
  await semanticMap.click();

  await expect(semanticMap).toBeChecked();
  await expect(page.getByRole("complementary", { name: "Semantic map details" })).toContainText(
    "Distance approximates semantic similarity."
  );
  await expect(page.getByText("I love the color indigo.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Memories 1" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Explain New Memories" })).toHaveCount(0);

  await page.getByRole("radio", { name: "Brain" }).click();
  await expect(page.getByRole("radio", { name: "Brain" })).toBeChecked();
  await expect(page.getByRole("button", { name: "Explain New Memories" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Memories 1" })).toBeVisible();
});

test("runs an Ablation Replay without mutating the memory session", async ({ page }) => {
  await page.goto("/");

  await sendChatMessage(page, "I love the color indigo.");
  await expect(page.getByRole("button", { name: "Memories 1" })).toBeVisible({ timeout: 12_000 });

  await sendChatMessage(page, "What color do I love?");
  await expect(page.getByRole("button", { name: "Working 1" })).toBeVisible({ timeout: 12_000 });

  await page.getByRole("button", { name: "Inspect 1 used memory" }).click();
  await page.getByRole("button", { name: "Test without this memory" }).click();
  const replay = page.getByRole("complementary", { name: "Ablation Replay" });
  await expect(replay).toContainText("Memory omitted in replay");
  await expect(replay).toContainText("Original answer");
  await expect(replay).toContainText("does not reveal hidden model reasoning");

  await page.getByRole("button", { name: "Run without this memory" }).click();
  await expect(page.getByRole("region", { name: "Baseline rerun" })).toBeVisible({ timeout: 12_000 });
  await expect(page.getByRole("region", { name: "Answer without memory" })).toBeVisible();
  await expect(page.getByLabel("Replay evidence")).toContainText("Runs2");
  await expect(page.getByLabel("Replay evidence")).toContainText("Text difference");
  await expect(replay).toContainText("One replay does not establish causality");
  await expect(page.getByRole("button", { name: "Memories 1" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Story 2" })).toBeVisible();
});

test("imports and replays an observed OpenAI agent memory trace", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "Import agent trace" }).click();
  const dialog = page.getByRole("dialog", { name: "Import a recorded trace" });
  await expect(dialog).toContainText("Parsed locally; never uploaded");
  await page.getByRole("button", { name: "Load sample trace" }).click();

  const playback = page.getByRole("region", { name: "Trace playback controls" });
  await expect(playback).toContainText("Personalization agent");
  await expect(page.getByLabel("Chat message")).toHaveCount(0);
  await page.getByRole("button", { name: "Inspect agent topology" }).click();
  const topology = page.getByRole("complementary", { name: "Agent memory topology" });
  await expect(topology).toContainText("Coordinator");
  await expect(topology).toContainText("Memory Specialist");
  await expect(topology).toContainText("Shared memory / profile-memory");
  await expect(topology).toContainText("Delegate profile recall");
  await expect(topology).toContainText("Unknown scope remains unknown");
  await page.getByRole("button", { name: "Close agent topology" }).click({ force: true });

  await page.getByRole("button", { name: "Inspect instrumentation coverage" }).click();
  const coverage = page.getByRole("complementary", { name: "Instrumentation coverage" });
  await expect(coverage).toContainText("What this trace can support");
  await expect(coverage).toContainText("Explicit memory operations");
  await expect(coverage).toContainText("Missing telemetry is a blind spot");
  await page.getByRole("button", { name: "Close instrumentation coverage" }).click({ force: true });

  await page.getByRole("button", { name: "Next trace step" }).click();
  await expect(playback).toContainText("No memory event");
  await page.getByRole("button", { name: "Next trace step" }).click();
  await expect(playback).toContainText("Observed memory event");
  await expect(page.getByLabel("Current memory receipt")).toContainText("Stored", { timeout: 12_000 });

  await page.getByRole("button", { name: "Inspect trace" }).click();
  const inspector = page.getByRole("complementary", { name: "Trace inspector" });
  await expect(inspector).toContainText("6 observed");
  await expect(inspector).toContainText("Neither proves hidden model reasoning");
  await page.getByRole("button", { name: "Close trace inspector" }).click({ force: true });

  await page.getByRole("button", { name: "Exit trace playback" }).click({ force: true });
  await expect(page.getByLabel("Chat message")).toBeVisible();
  await expect(page.getByLabel("Demo controls")).toBeVisible();
});

test("imports an OpenAI Agents trace directly into the incident workflow", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Incidents: Diagnose and repair a memory incident" }).click();
  const workspace = page.getByRole("complementary", { name: "Memory Incident Workspace" });
  await workspace.getByRole("button", { name: "Import agent trace" }).click();

  const dialog = page.getByRole("dialog", { name: "Import a memory incident" });
  await dialog.getByLabel("Expected answer").fill("Oakland");
  await dialog.getByRole("textbox", { name: "Trace JSON", exact: true }).fill(
    JSON.stringify(incidentTraceFixture())
  );
  await dialog.getByRole("button", { name: "Create incident" }).click();

  await expect(dialog).toBeHidden();
  await expect(workspace).toContainText("Unexpected answer in Incident import smoke");
  await expect(workspace).toContainText("A stale fact remained active");
  await expect(workspace).toContainText("What city do I live in now?");
  await expect(workspace).toContainText("You live in San Francisco.");
});

test("opens and dismisses Dream Mode after enough memories", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await page.goto("/");

  for (const message of [
    "I love California beaches.",
    "I love California redwood hikes.",
    "I love California road trips."
  ]) {
    await sendChatMessage(page, message);
    await expect(page.getByRole("button", { name: /^Memories [1-9]/ })).toBeVisible({ timeout: 12_000 });
  }

  const dream = page.getByRole("button", { name: /Dream Ready/i });
  await expect(dream).toBeVisible({ timeout: 12_000 });
  await dream.click();

  const dreamPanel = page.getByRole("complementary", { name: "Dream review" });
  await expect(dreamPanel).toBeVisible({ timeout: 12_000 });
  await expect(page.getByText(/Dream review complete|Model-reviewed memories/)).toBeVisible();
  await expect(dreamPanel).toContainText("Nothing changes until you apply it");
  await expect(dreamPanel.getByLabel("Dream benchmark")).toContainText("Projected benchmark");
  await expect(dreamPanel.getByLabel("Dream benchmark")).toContainText(/est. retained/i);
  await expect(page.getByLabel("Current memory receipt")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Apply dream" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Keep current memories" })).toBeVisible();

  await page.getByRole("button", { name: "Keep current memories" }).click();
  await expect(dreamPanel).toBeHidden();
});

test("renders a nonblank brain canvas", async ({ page }) => {
  await page.goto("/");
  const canvas = page.locator("canvas").first();
  await expect(canvas).toBeVisible();

  await expect
    .poll(
      async () =>
        canvas.evaluate((element) => {
          const source = element as HTMLCanvasElement;
          const probe = document.createElement("canvas");
          probe.width = 48;
          probe.height = 48;
          const context = probe.getContext("2d");
          if (!context) return 0;
          context.drawImage(source, 0, 0, probe.width, probe.height);
          const pixels = context.getImageData(0, 0, probe.width, probe.height).data;
          let nonBlackPixels = 0;
          for (let index = 0; index < pixels.length; index += 4) {
            if (pixels[index] > 8 || pixels[index + 1] > 8 || pixels[index + 2] > 8) {
              nonBlackPixels += 1;
            }
          }
          return nonBlackPixels;
        }),
      { timeout: 15_000 }
    )
    .toBeGreaterThan(40);
});

function incidentTraceFixture() {
  const oldMemory = {
    id: "smoke-memory-sf",
    text: "User moved to San Francisco in 2022.",
    importance: 0.8,
    topic: "current location",
    kind: "location",
    entities: ["San Francisco"],
    region: "hippocampus",
    created_at: "2026-07-14T10:00:00.000Z",
    access_count: 2,
    status: "active"
  };
  const currentMemory = {
    id: "smoke-memory-oakland",
    text: "User lives in Oakland now.",
    importance: 0.9,
    topic: "current location",
    kind: "location",
    entities: ["Oakland"],
    region: "hippocampus",
    created_at: "2026-07-14T10:10:00.000Z",
    access_count: 0,
    status: "active"
  };
  const memorySpan = (id: string, event: Record<string, unknown>, minute: number) => ({
    object: "trace.span",
    id,
    trace_id: "trace-incident-smoke",
    started_at: `2026-07-14T10:${String(minute).padStart(2, "0")}:00.000Z`,
    ended_at: `2026-07-14T10:${String(minute).padStart(2, "0")}:01.000Z`,
    span_data: { type: "custom", name: "engram.memory", data: { event } }
  });

  return {
    items: [
      { object: "trace", id: "trace-incident-smoke", workflow_name: "Incident import smoke" },
      memorySpan("smoke-init", { type: "init", memories: [oldMemory, currentMemory] }, 0),
      memorySpan("smoke-retrieve", {
        type: "retrieve",
        query: "What city do I live in now?",
        ids: [oldMemory.id],
        accessed: [oldMemory],
        retrieval: {
          provider: "semantic",
          candidateCount: 2,
          eligibleCount: 2,
          selectedCount: 1,
          matches: [
            { id: oldMemory.id, rank: 1, score: 0.84, basis: "semantic", eligible: true, selected: true },
            { id: currentMemory.id, rank: 2, score: 0.82, basis: "semantic", eligible: true, selected: false }
          ]
        }
      }, 1),
      memorySpan("smoke-load", { type: "load", ids: [oldMemory.id] }, 2),
      {
        object: "trace.span",
        id: "smoke-generation",
        trace_id: "trace-incident-smoke",
        started_at: "2026-07-14T10:03:00.000Z",
        ended_at: "2026-07-14T10:03:01.000Z",
        span_data: {
          type: "generation",
          input: "What city do I live in now?",
          output: "You live in San Francisco."
        }
      }
    ]
  };
}
