import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { appRouteFromPath } from "../lib/app/routes.ts";
import worker from "../worker/index.ts";

const developmentPreviewMeta =
  /<meta(?=[^>]*\bname=["']codex-preview["'])(?=[^>]*\bcontent=["']development["'])[^>]*>/i;

test("builds the Vite application shell with preview metadata", async () => {
  const html = await readFile(
    new URL("../dist/client/index.html", import.meta.url),
    "utf8",
  );

  assert.match(html, developmentPreviewMeta);
  assert.match(html, /数独推演器/);
  assert.match(html, /<div id="root"><\/div>/);
});

test("entry and replay URLs resolve to separate application pages", () => {
  assert.equal(appRouteFromPath("/"), "entry");
  assert.equal(appRouteFromPath("/anything-else"), "entry");
  assert.equal(appRouteFromPath("/replay"), "replay");
  assert.equal(appRouteFromPath("/replay/step/12"), "replay");
});

test("direct replay requests redirect home before static asset handling", async () => {
  let assetRequests = 0;
  const env = {
    ASSETS: {
      async fetch() {
        assetRequests += 1;
        return new Response("unexpected");
      },
    },
  };

  for (const path of ["/replay", "/replay/step/12"]) {
    const response = await worker.fetch(
      new Request(`https://sudoku.example${path}`),
      env,
    );
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), "https://sudoku.example/");
  }
  assert.equal(assetRequests, 0);
});

test("mobile OCR review keeps actions visible beside a scrollable editor", async () => {
  const css = await readFile(
    new URL("../src/styles.css", import.meta.url),
    "utf8",
  );
  const mobileCss = css.match(
    /@media \(max-width: 700px\) \{([\s\S]*)\n\}\n\n@media \(prefers-reduced-motion/,
  )?.[1];
  assert.ok(mobileCss);
  assert.match(
    mobileCss,
    /\.ocr-dialog\s*\{[^}]*position:\s*relative[^}]*height:\s*100dvh/s,
  );
  assert.match(
    mobileCss,
    /\.ocr-review\s*\{[^}]*overflow-y:\s*auto[^}]*padding-bottom:\s*calc\([^)]*safe-area-inset-bottom[^)]*\)/s,
  );
  assert.match(
    mobileCss,
    /\.ocr-dialog-footer\s*\{[^}]*position:\s*absolute[^}]*right:\s*0[^}]*bottom:\s*0[^}]*left:\s*0/s,
  );
});

test("Sudoku boards keep all nine rows at equal height", async () => {
  const css = await readFile(
    new URL("../src/styles.css", import.meta.url),
    "utf8",
  );
  assert.match(
    css,
    /\.sudoku-board\s*\{[^}]*grid-template-rows:\s*repeat\(9,\s*minmax\(0,\s*1fr\)\)/s,
  );
  assert.match(
    css,
    /\.ocr-mini-grid\s*\{[^}]*grid-template-rows:\s*repeat\(9,\s*minmax\(0,\s*1fr\)\)/s,
  );
});

test("Killer cage drawing disables touch scrolling while dragging", async () => {
  const css = await readFile(
    new URL("../src/styles.css", import.meta.url),
    "utf8",
  );
  assert.match(
    css,
    /\.sudoku-board\.cage-drawing\s*\{[^}]*touch-action:\s*none/s,
  );
});

test("mobile entry toolbar keeps the puzzle clear action visible", async () => {
  const [component, css] = await Promise.all([
    readFile(
      new URL("../src/components/SudokuApp.tsx", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../src/styles.css", import.meta.url), "utf8"),
  ]);

  assert.match(
    component,
    /className="input-actions"[\s\S]*className="clear-puzzle-button"[\s\S]*清空题盘/,
  );
  assert.match(
    css,
    /@media \(max-width: 700px\)[\s\S]*\.input-actions\s*\{[^}]*grid-column:\s*1 \/ -1[^}]*justify-content:\s*flex-end/s,
  );
});

test("Killer cage sums use an auto-saving range control", async () => {
  const component = await readFile(
    new URL("../src/components/SudokuApp.tsx", import.meta.url),
    "utf8",
  );

  assert.match(component, /className="cage-sum-slider"[\s\S]*type="range"/);
  assert.match(component, /切换输入模式或点击空白处时自动保存/);
  assert.match(
    component,
    /event\.key === "Enter"[\s\S]*cageDraft\.canSave[\s\S]*finalizeCageDraft\(\)/,
  );
  assert.doesNotMatch(component, />\s*添加笼\s*</);
});
