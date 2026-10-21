/** Self-contained: Chrome serializes this function into the explicitly clicked active tab. */
export function captureCodeforcesStatement() {
  const before = location.href;
  const root = document.querySelector<HTMLElement>(".problem-statement");
  if (!root) throw new Error("No Codeforces statement is visible. Wait for the problem to load.");
  const text = (node: Element | null): string => {
    if (!node) return "";
    // Read only these statement sections, never the page body or account/navigation content.
    return ((node as HTMLElement).innerText ?? node.textContent ?? "").replace(/\r\n?/g, "\n").replace(/\u00a0/g, " ").trim();
  };
  const description = Array.from(root.children)
    .filter(node => !node.matches(".header,.input-specification,.output-specification,.sample-tests,.note,.constraints,script,style"))
    .map(text).filter(Boolean).join("\n\n");
  const requirements = (selector: string): string => {
    const section = root.querySelector(selector);
    if (!section) return "";
    return Array.from(section.childNodes).map(node => node.nodeType === 3 ? node.textContent?.trim() ?? "" : node.nodeType === 1 && !(node as Element).matches(".section-title,script,style") ? text(node as Element) : "").filter(Boolean).join("\n\n");
  };
  const input = requirements(".input-specification");
  const output = requirements(".output-specification");
  const samples = Array.from(root.querySelectorAll(".sample-test")).flatMap(sample => {
    const inputs = Array.from(sample.querySelectorAll(".input pre"));
    const outputs = Array.from(sample.querySelectorAll(".output pre"));
    return Array.from({ length: Math.max(inputs.length, outputs.length) }, (_, index) => ({ input: text(inputs[index] ?? null), output: text(outputs[index] ?? null) }));
  });
  if (location.href !== before) throw new Error("The problem changed during capture. Try again.");
  const title = text(root.querySelector(".header .title") ?? root.querySelector(".title"));
  if (!title || !description) throw new Error("The statement is missing its title or description. Wait for it to load.");
  return { url: before, title, description, input, output, constraints: text(root.querySelector(".constraints")), samples, explanation: text(root.querySelector(".note")), complete: !!(description && input && output && samples.length && samples.every(sample => sample.input && sample.output)), source: "browser" as const };
}
