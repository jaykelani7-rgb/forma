export type ChallengeSplit = "development" | "holdout";

interface JudgedInput {
  correct: string;
  buggy: string;
  probesAssumption: boolean;
}

export interface ChallengeFixture {
  id: string;
  split: ChallengeSplit;
  title: string;
  description: string;
  input: string;
  output: string;
  constraints: string;
  approach: string;
  assumption: string;
  code: string;
  trigger: { input: string; correct: string; buggy: string };
  control: { input: string; output: string };
  judge(input: string): JudgedInput | null;
}

function integers(input: string) {
  const tokens = input.match(/[^ \t\r\n\f\v]+/g) ?? [];
  if (!tokens.every(token => /^[+-]?\d+$/.test(token))) return null;
  const values = tokens.map(Number);
  return values.every(Number.isSafeInteger) ? values : null;
}

function readArray(values: number[] | null, start = 1) {
  if (!values) return null;
  const [size] = values;
  const entries = values.slice(start);
  if (size < 1 || size > 20 || entries.length !== size) return null;
  return entries.every(value => value >= -20 && value <= 20) ? entries : null;
}

function oneInteger(input: string, minimum: number, maximum: number) {
  const values = integers(input);
  if (!values || values.length !== 1 || values[0] < minimum || values[0] > maximum) return null;
  return values[0];
}

// A trigger and a control are labeled by hand. The judges also score other valid
// inputs using the synthetic problem rules and the behavior of the shown bug.
export const challengeFixtures: ChallengeFixture[] = [
  {
    id: "last-position",
    split: "development",
    title: "First index",
    description: "Find the first zero-based index of the target in the array.",
    input: "Read n and target, followed by n integers.",
    output: "Print the first matching index, or -1 if none exists.",
    constraints: "1 <= n <= 20. All values and the target are integers between -20 and 20.",
    approach: "Scan from the beginning and return the first matching index.",
    assumption: "The loop examines every index, including the final one.",
    code: `int firstIndex(const vector<int>& a, int target) {
  for (int i = 0; i + 1 < int(a.size()); ++i)
    if (a[i] == target) return i;
  return -1;
}`,
    trigger: { input: "3 5\n1 2 5", correct: "2", buggy: "-1" },
    control: { input: "3 5\n5 2 5", output: "0" },
    judge(input) {
      const values = integers(input);
      const entries = readArray(values, 2);
      const target = values?.[1];
      if (!entries || target === undefined || target < -20 || target > 20) return null;
      const first = entries.indexOf(target);
      return {
        correct: String(first),
        buggy: String(entries.slice(0, -1).indexOf(target)),
        probesAssumption: first === entries.length - 1,
      };
    },
  },
  {
    id: "negative-maximum",
    split: "development",
    title: "Maximum temperature",
    description: "Find the highest recorded temperature in a nonempty array.",
    input: "Read n followed by n integer temperatures.",
    output: "Print the largest temperature.",
    constraints: "1 <= n <= 20. Each temperature is between -20 and 20.",
    approach: "Start the maximum at zero and update it whenever a larger value appears.",
    assumption: "The correct maximum can never be below the zero initializer.",
    code: `int maximum(const vector<int>& a) {
  int best = 0;
  for (int x : a) best = max(best, x);
  return best;
}`,
    trigger: { input: "3\n-7 -3 -8", correct: "-3", buggy: "0" },
    control: { input: "2\n-7 4", output: "4" },
    judge(input) {
      const entries = readArray(integers(input));
      if (!entries) return null;
      const maximum = Math.max(...entries);
      return { correct: String(maximum), buggy: String(Math.max(0, maximum)), probesAssumption: maximum < 0 };
    },
  },
  {
    id: "smallest-even",
    split: "development",
    title: "Even portions",
    description: "Decide whether a weight can be split into two positive even integer portions.",
    input: "Read one integer weight.",
    output: "Print YES if the split is possible or NO otherwise.",
    constraints: "1 <= weight <= 100.",
    approach: "Check the parity of the weight.",
    assumption: "Every positive even total can be divided into two positive even portions.",
    code: `bool canSplit(int weight) {
  return weight % 2 == 0;
}`,
    trigger: { input: "2", correct: "NO", buggy: "YES" },
    control: { input: "8", output: "YES" },
    judge(input) {
      const weight = oneInteger(input, 1, 100);
      if (weight === null) return null;
      const even = weight % 2 === 0;
      return {
        correct: even && weight >= 4 ? "YES" : "NO",
        buggy: even ? "YES" : "NO",
        probesAssumption: weight === 2,
      };
    },
  },
  {
    id: "strict-orders",
    split: "holdout",
    title: "Strictly increasing readings",
    description: "Check whether each reading is strictly larger than the previous reading.",
    input: "Read n followed by n integer readings.",
    output: "Print YES for a strictly increasing sequence or NO otherwise.",
    constraints: "1 <= n <= 20. Each reading is between -20 and 20.",
    approach: "Reject the sequence if any reading is smaller than the preceding one.",
    assumption: "Equal neighboring readings should be allowed in a strictly increasing sequence.",
    code: `bool increasing(const vector<int>& a) {
  for (int i = 1; i < int(a.size()); ++i)
    if (a[i] < a[i - 1]) return false;
  return true;
}`,
    trigger: { input: "3\n1 1 2", correct: "NO", buggy: "YES" },
    control: { input: "3\n1 2 3", output: "YES" },
    judge(input) {
      const entries = readArray(integers(input));
      if (!entries) return null;
      const tail = entries.slice(1);
      return {
        correct: tail.every((value, index) => value > entries[index]) ? "YES" : "NO",
        buggy: tail.every((value, index) => value >= entries[index]) ? "YES" : "NO",
        probesAssumption: tail.some((value, index) => value === entries[index]),
      };
    },
  },
  {
    id: "clock-wrap",
    split: "holdout",
    title: "Hour after an offset",
    description: "Shift a 24-hour clock forward or backward by the given number of hours.",
    input: "Read two integers, the current hour and a signed offset.",
    output: "Print the resulting hour in the inclusive range 0 through 23.",
    constraints: "0 <= hour <= 23 and -100 <= offset <= 100.",
    approach: "Add the signed offset and take the C++ remainder modulo 24.",
    assumption: "The remainder operator always returns a nonnegative hour.",
    code: `int shiftedHour(int hour, int offset) {
  return (hour + offset) % 24;
}`,
    trigger: { input: "0 -1", correct: "23", buggy: "-1" },
    control: { input: "23 2", output: "1" },
    judge(input) {
      const values = integers(input);
      if (!values || values.length !== 2) return null;
      const [hour, offset] = values;
      if (hour < 0 || hour > 23 || offset < -100 || offset > 100) return null;
      const remainder = (hour + offset) % 24;
      return {
        correct: String((remainder + 24) % 24),
        buggy: String(remainder),
        probesAssumption: remainder < 0,
      };
    },
  },
  {
    id: "pair-product-overflow",
    split: "holdout",
    title: "Unordered pairs",
    description: "Find the number of unordered pairs of distinct elements among n labeled elements.",
    input: "Read one integer n.",
    output: "Print the exact number of pairs as an integer.",
    constraints: "1 <= n <= 100000.",
    approach: "Multiply n by n - 1 in an unsigned 32-bit intermediate, then halve it.",
    assumption: "The product before the division always fits in an unsigned 32-bit integer.",
    code: `uint64_t countPairs(uint32_t n) {
  uint32_t product = static_cast<uint32_t>(uint64_t(n) * (n - 1));
  return product / 2;
}`,
    trigger: { input: "65537", correct: "2147516416", buggy: "32768" },
    control: { input: "65536", output: "2147450880" },
    judge(input) {
      const size = oneInteger(input, 1, 100_000);
      if (size === null) return null;
      const product = size * (size - 1);
      const uint32 = 2 ** 32;
      return {
        correct: String(product / 2),
        buggy: String((product % uint32) / 2),
        probesAssumption: product >= uint32,
      };
    },
  },
];
