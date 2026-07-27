import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { appRouteFromPath } from "../lib/app/routes.ts";

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

test("mobile OCR review keeps actions visible beside a scrollable editor", async () => {
  const css = await readFile(
    new URL("../src/styles.css", import.meta.url),
    "utf8",
  );
  assert.match(css, /\.ocr-dialog\s*\{[^}]*height:\s*100dvh/s);
  assert.match(
    css,
    /\.ocr-review\s*\{[^}]*flex:\s*1[^}]*overflow-y:\s*auto/s,
  );
  assert.match(
    css,
    /\.ocr-dialog-footer\s*\{[^}]*flex:\s*0 0 auto/s,
  );
});
