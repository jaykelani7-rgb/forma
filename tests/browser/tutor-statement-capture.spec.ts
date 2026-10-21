import { test, expect } from "@playwright/test";
import { captureCodeforcesStatement } from "../../packages/integrations/statement-capture";

test("explicit statement extraction excludes page chrome and preserves sample line breaks in a real DOM fixture", async ({ page }) => {
  await page.route("https://codeforces.com/gym/100001/problem/A2", route => route.fulfill({ contentType: "text/html", body: `<!doctype html><html><body>
    <nav>PRIVATE ACCOUNT CONTENT</nav><aside>EDITORIAL SHOULD NEVER BE INCLUDED</aside>
    <div class="problem-statement"><div class="header"><div class="title">A2. Fixture sum</div><div>Time limit</div></div>
    <div><p>Find the sum of two numbers.</p><p>The values may be negative.</p></div>
    <div class="input-specification"><div class="section-title">Input</div><p>Two integers a and b, −100 ≤ a,b ≤ 100.</p></div>
    <div class="output-specification"><div class="section-title">Output</div><p>Their sum.</p></div>
    <div class="sample-tests"><div class="sample-test"><div class="input"><div class="title">InputCopy</div><pre>1 2<br>3 4</pre></div><div class="output"><div class="title">OutputCopy</div><pre>3<br>7</pre></div></div></div>
    <div class="note"><div>Note</div><p>Add the first pair.</p></div></div>
    <div id="submission-history">UNRELATED SUBMISSIONS</div></body></html>` }));
  await page.goto("https://codeforces.com/gym/100001/problem/A2");
  const result = await page.evaluate(captureCodeforcesStatement);
  expect(result.complete).toBe(true); expect(result.source).toBe("browser"); expect(result.url).toContain("/gym/100001/problem/A2");
  expect(result.samples).toEqual([{ input: "1 2\n3 4", output: "3\n7" }]);
  expect(result.description).toContain("Find the sum"); expect(JSON.stringify(result)).not.toMatch(/PRIVATE ACCOUNT|EDITORIAL|UNRELATED SUBMISSIONS|Time limit|InputCopy/);
  await page.locator(".input-specification p").evaluate(node => node.remove());
  expect((await page.evaluate(captureCodeforcesStatement)).complete).toBe(false);
});
