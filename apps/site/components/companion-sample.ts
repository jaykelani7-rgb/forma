import type {
  DeskIdeaReview,
  IdeaChallenge,
  IdeaOutline,
  TutorTurn,
} from "../../../packages/tutor/types";

export type TourScene =
  | "focus"
  | "desk"
  | "idea"
  | "hint"
  | "reflect"
  | "recall"
  | "appearance";
export type SampleReflection = { outcome: string; takeaway: string };
export type SamplePractice = {
  reflectionRevision: number;
  code: boolean;
  thought: string;
  reflection: SampleReflection | null;
  recall: { text: string; outcome: string } | null;
};
export const tourScenes: {
  id: TourScene;
  label: string;
  title: string;
  description: string;
  task: string;
}[] = [
  {
    id: "focus",
    label: "Focus",
    title: "Your problem. A little room to focus.",
    description:
      "Start a measured session, pause when you need to, and tuck the Ribbon away while you code.",
    task: "Try starting the timer, then collapse the companion.",
  },
  {
    id: "desk",
    label: "Problem desk",
    title: "Everything you’re thinking, in one place.",
    description:
      "Keep a thread, a hypothesis, a failing input, or a code selection beside the problem it belongs to.",
    task: "Pin the sample code, or leave a thread in your own words.",
  },
  {
    id: "idea",
    label: "Explain an idea",
    title: "An idea is a beginning. Explore its edges.",
    description:
      "Explain your approach, edit its outline, then choose an assumption to challenge with your Tutor.",
    task: "Outline the sample idea, select its assumption, and challenge it.",
  },
  {
    id: "hint",
    label: "One small hint",
    title: "Just enough to find your next step.",
    description:
      "Review the context you’re sharing and ask for one observation. Keep the useful part as your next step.",
    task: "Review the statement, then reveal the prepared hint.",
  },
  {
    id: "reflect",
    label: "Reflect",
    title: "Accepted is a verdict. Learning is yours.",
    description:
      "Record how you solved it and what you want to remember. Platform results never choose your learning outcome.",
    task: "Choose an outcome and save something you learned.",
  },
  {
    id: "recall",
    label: "Recall",
    title: "See what stayed with you.",
    description:
      "Try the approach again before opening your old notes. Forma’s revisit workflow brings earlier learning back into practice.",
    task: "Write what you remember before revealing your saved thought.",
  },
  {
    id: "appearance",
    label: "Make it yours",
    title: "A small presence, on your terms.",
    description:
      "Choose a timer strip or a small fold, a resting edge, and gentle or still motion.",
    task: "Change the Ribbon’s shape and try its focus preview.",
  },
];

export const sampleCode =
  '#include <iostream>\nusing namespace std;\n\nint main() {\n    int w;\n    cin >> w;\n    if (w % 2 == 0) {\n        cout << "YES";\n    } else {\n        cout << "NO";\n    }\n}';
export const sampleExplanation =
  "I think checking whether the weight is even is enough. Then it should split into two even parts.";
export const sampleOutline: IdeaOutline = {
  approach: "Check whether the weight is even.",
  assumptions: [
    "Every even weight can be split into two positive even weights.",
  ],
  uncertainty: "Does the smallest even weight work too?",
};
export const sampleChallenge: IdeaChallenge = {
  observation: "Two positive even parts must each be at least 2.",
  question: "What happens when the entire watermelon weighs only 2?",
  cases: [
    {
      id: "smallest-even",
      input: "2",
      expectedOutput: "NO",
      reason: "There isn’t enough weight for two positive even parts.",
    },
  ],
};
export const sampleReview: DeskIdeaReview = {
  provider: {
    provider: "gemini",
    name: "The sample Tutor",
    capabilities: { text: true, transcription: false, speech: false },
    configured: true,
    model: "prepared-example",
    transcriptionModel: "",
    speechModel: "",
    message: "Prepared responses. No provider connection.",
  },
  contestMode: false,
  activeRequestId: null,
  conversationId: "sample-watermelon",
  target: {
    problemId: "sample-4-a",
    sessionId: "sample-session",
    recoveryEpoch: "sample",
    provider: "gemini",
    model: "prepared-example",
  },
  statement: {
    id: "sample-statement",
    revision: "sample-1",
    capturedAt: "2026-11-13T09:00:00.000Z",
    identity: "contest:4:A",
    url: "https://codeforces.com/problemset/problem/4/A",
    title: "Watermelon",
    description:
      "Split a watermelon of weight w into two positive parts, each with an even weight.",
    input: "One integer w.",
    output: "YES if such a split exists; otherwise NO.",
    constraints: "1 ≤ w ≤ 100",
    samples: [{ input: "8", output: "YES" }],
    explanation: "For 8, the parts can weigh 2 and 6.",
    complete: true,
    source: "manual",
  },
  code: {
    id: "sample-code",
    identity: "contest:4:A",
    workspaceId: "sample",
    clientId: "sample",
    fileUri: "",
    filename: "watermelon.cpp",
    language: "cpp",
    startLine: 1,
    endLine: 12,
    text: sampleCode,
    revision: "sample-1",
    capturedAt: "2026-11-13T09:00:00.000Z",
  },
};
export const sampleHint: TutorTurn = {
  id: "sample-hint",
  requestId: "sample-request",
  conversationId: "sample-watermelon",
  action: "small-hint",
  userText: "Give me one small hint without the solution.",
  assistantText:
    "What is the **smallest total weight** you can make from two positive even pieces? Compare that with the smallest even input.",
  context: {
    version: 1,
    identity: "contest:4:A",
    problemId: "sample-4-a",
    title: "Watermelon",
    url: "https://codeforces.com/problemset/problem/4/A",
    workspaceId: "sample",
    conversationId: "sample-watermelon",
    sessionId: "sample-session",
    statement: sampleReview.statement,
    code: null,
    notes: [],
    evidence: {
      platform: "unknown",
      checkedAt: null,
      localTests: "unknown",
      submissions: [],
    },
    frozenAt: "2026-11-13T09:00:00.000Z",
  },
  status: "completed",
  createdAt: "2026-11-13T09:00:00.000Z",
  completedAt: "2026-11-13T09:00:00.000Z",
  error: null,
  hintLevel: 1,
  exposed: false,
  usage: null,
  model: "prepared-example",
};
