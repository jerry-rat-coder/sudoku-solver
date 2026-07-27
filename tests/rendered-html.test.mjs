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
