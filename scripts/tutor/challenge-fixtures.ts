import { challengeOutputEqual } from "../../packages/tutor/challenge-run";
import { challengeRankingFeatures, type ChallengeRankingDataset } from "../../packages/tutor/challenge-ranking";

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
    id: "overlapping-intervals",
    split: "development",
    title: "Covered coordinates",
    description: "Count the distinct integer coordinates covered by either of two closed intervals.",
    input: "Read four integers a, b, c and d describing intervals [a, b] and [c, d].",
    output: "Print the number of covered coordinates.",
    constraints: "-20 <= a <= b <= 20 and -20 <= c <= d <= 20.",
    approach: "Count the coordinates in each interval and add the two counts.",
    assumption: "The two intervals cannot cover any of the same coordinates.",
    code: `int covered(int a, int b, int c, int d) {
  return (b - a + 1) + (d - c + 1);
}`,
    trigger: { input: "1 3 3 5", correct: "5", buggy: "6" },
    control: { input: "1 3 5 6", output: "5" },
    judge(input) {
      const values = integers(input);
      if (!values || values.length !== 4 || values.some(value => value < -20 || value > 20)) return null;
      const [a, b, c, d] = values;
      if (a > b || c > d) return null;
      const total = b - a + 1 + d - c + 1;
      const overlap = Math.max(0, Math.min(b, d) - Math.max(a, c) + 1);
      return { correct: String(total - overlap), buggy: String(total), probesAssumption: overlap > 0 };
    },
  },
  {
    id: "partial-batch",
    split: "development",
    title: "Packing boxes",
    description: "Find the minimum number of boxes required to pack every item.",
    input: "Read the item count n and the maximum number k of items per box.",
    output: "Print the minimum number of boxes.",
    constraints: "1 <= n <= 200 and 1 <= k <= 200. A box can be partly filled.",
    approach: "Divide the item count by the capacity using integer division.",
    assumption: "The number of items is always divisible by the box capacity.",
    code: `int boxes(int n, int k) {
  return n / k;
}`,
    trigger: { input: "10 3", correct: "4", buggy: "3" },
    control: { input: "12 3", output: "4" },
    judge(input) {
      const values = integers(input);
      if (!values || values.length !== 2 || values.some(value => value < 1 || value > 200)) return null;
      const [count, capacity] = values;
      return {
        correct: String(Math.ceil(count / capacity)),
        buggy: String(Math.floor(count / capacity)),
        probesAssumption: count % capacity !== 0,
      };
    },
  },
  {
    id: "zero-digit-count",
    split: "development",
    title: "Number of digits",
    description: "Count the digits in the ordinary decimal representation of a nonnegative integer.",
    input: "Read one integer n.",
    output: "Print the number of digits. Zero is written as 0 and has one digit.",
    constraints: "0 <= n <= 100000.",
    approach: "Count how many times I divide the value by ten before it reaches zero.",
    assumption: "The digit-counting loop always runs at least once.",
    code: `int digits(int n) {
  int count = 0;
  while (n > 0) { ++count; n /= 10; }
  return count;
}`,
    trigger: { input: "0", correct: "1", buggy: "0" },
    control: { input: "237", output: "3" },
    judge(input) {
      const value = oneInteger(input, 0, 100_000);
      if (value === null) return null;
      const digits = String(value).length;
      return { correct: String(digits), buggy: value ? String(digits) : "0", probesAssumption: value === 0 };
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
  {
    id: "preserve-reversed-zeros",
    split: "holdout",
    title: "Mirror a code",
    description: "Reverse every character in a fixed-width code made of decimal digits.",
    input: "Read one nonempty token of decimal digits.",
    output: "Print the reversed token, preserving its width and every zero.",
    constraints: "The code contains 1 to 20 digits. Leading and trailing zeros are allowed.",
    approach: "Reverse the string and normalize it as a decimal number.",
    assumption: "Zeros at the beginning of the reversed code can be discarded.",
    code: `string mirror(string code) {
  reverse(code.begin(), code.end());
  while (code.size() > 1 && code.front() == '0') code.erase(code.begin());
  return code;
}`,
    trigger: { input: "1200", correct: "0021", buggy: "21" },
    control: { input: "1234", output: "4321" },
    judge(input) {
      const tokens = input.match(/[^ \t\r\n\f\v]+/g);
      if (tokens?.length !== 1 || !/^[0-9]{1,20}$/.test(tokens[0])) return null;
      const [code] = tokens;
      const reversed = [...code].reverse().join("");
      return {
        correct: reversed,
        buggy: reversed.replace(/^0+(?=.)/, ""),
        probesAssumption: reversed.length > 1 && reversed.startsWith("0"),
      };
    },
  },
  {
    id: "nonadjacent-mixed-parity",
    split: "holdout",
    title: "Nonadjacent prizes",
    description: "Choose prizes to maximize their total value. You may not choose two prizes at adjacent positions.",
    input: "Read n followed by n nonnegative prize values.",
    output: "Print the highest total value.",
    constraints: "1 <= n <= 20 and each prize value is between 0 and 20.",
    approach: "Sum each parity of positions and take the larger sum.",
    assumption: "Some optimal choice always uses positions of only one parity.",
    code: `int total(const vector<int>& prizes) {
  int byParity[2] = {};
  for (int i = 0; i < int(prizes.size()); ++i) byParity[i % 2] += prizes[i];
  return max(byParity[0], byParity[1]);
}`,
    trigger: { input: "5\n9 0 0 8 0", correct: "17", buggy: "9" },
    control: { input: "4\n5 2 4 1", output: "9" },
    judge(input) {
      const prizes = readArray(integers(input));
      if (!prizes || prizes.some(value => value < 0)) return null;
      const byParity = [0, 0];
      let beforePrevious = 0, previous = 0;
      for (const [index, prize] of prizes.entries()) {
        byParity[index % 2] += prize;
        [beforePrevious, previous] = [previous, Math.max(previous, beforePrevious + prize)];
      }
      const parityBest = Math.max(...byParity);
      return { correct: String(previous), buggy: String(parityBest), probesAssumption: previous > parityBest };
    },
  },
  {
    id: "two-way-reachability",
    split: "holdout",
    title: "Connected towns",
    description: "Determine whether one town can reach another using two-way roads.",
    input: "Read n, m, start and goal, followed by m pairs of town numbers for the roads.",
    output: "Print YES if goal is reachable from start, or NO otherwise.",
    constraints: "1 <= n <= 8, 0 <= m <= 12. All town numbers are between 1 and n. Road endpoints differ.",
    approach: "Store each road as listed and visit all reachable neighbors from the start.",
    assumption: "Traversing every road only from its first listed endpoint is enough for reachability.",
    code: `bool reachable(int n, const vector<pair<int, int>>& roads, int start, int goal) {
  vector<vector<int>> edges(n + 1);
  for (auto [u, v] : roads) edges[u].push_back(v);
  vector<bool> seen(n + 1);
  vector<int> queue{start};
  seen[start] = true;
  for (size_t i = 0; i < queue.size(); ++i)
    for (int next : edges[queue[i]])
      if (!seen[next]) { seen[next] = true; queue.push_back(next); }
  return seen[goal];
}`,
    trigger: { input: "2 1 1 2\n2 1", correct: "YES", buggy: "NO" },
    control: { input: "2 1 1 2\n1 2", output: "YES" },
    judge(input) {
      const values = integers(input);
      if (!values || values.length < 4) return null;
      const [towns, count, start, goal, ...numbers] = values;
      if (towns < 1 || towns > 8 || count < 0 || count > 12 || numbers.length !== 2 * count) return null;
      if ([start, goal, ...numbers].some(town => town < 1 || town > towns)) return null;
      const roads = Array.from({ length: count }, (_, index) => [numbers[2 * index], numbers[2 * index + 1]]);
      if (roads.some(([first, second]) => first === second)) return null;
      function canReach(twoWay: boolean) {
        const reached = new Set([start]);
        for (const town of reached) {
          for (const [first, second] of roads) {
            if (town === first) reached.add(second);
            if (twoWay && town === second) reached.add(first);
          }
        }
        return reached.has(goal);
      }
      const correct = canReach(true), buggy = canReach(false);
      return { correct: correct ? "YES" : "NO", buggy: buggy ? "YES" : "NO", probesAssumption: correct && !buggy };
    },
  },
];

/** Hand-picked candidates exercise the ranker without provider calls. */
export function challengeRankingFixtureDataset(): ChallengeRankingDataset {
  return {
    format: "forma-challenge-ranking",
    version: 1,
    source: "benchmark",
    groups: challengeFixtures.map((fixture, index) => {
      const reason = "Inspect the result for this input.";
      const trigger = { input: fixture.trigger.input, expectedOutput: fixture.trigger.correct, reason };
      const control = { input: fixture.control.input, expectedOutput: fixture.control.output, reason };
      const ordered = index % 2 === 0 ? [control, trigger] : [trigger, control];
      return {
        id: `fixture:${fixture.id}`,
        problemKey: fixture.id,
        split: fixture.split,
        cases: ordered.map((candidate, position) => {
          const judged = fixture.judge(candidate.input);
          if (!judged) throw new Error(`Invalid checked-in ranking fixture: ${fixture.id}`);
          return {
            id: `case-${position + 1}`,
            ...challengeRankingFeatures(candidate),
            runs: [],
            feedback: null,
            targetedMismatch: judged.probesAssumption && !challengeOutputEqual(judged.correct, judged.buggy),
          };
        }),
      };
    }),
  };
}
