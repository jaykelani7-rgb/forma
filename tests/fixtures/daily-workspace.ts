import {
  connectProfile,
  dailyReflectionBatch,
  mergeActivity,
  saveQuickReflection,
  skipReflection,
} from "../../src/lib/codeforces";
import { emptyData, type Data } from "../../src/lib/model";
import type { ActivityPage } from "../../src/lib/codeforces-types";

export const dailyHandle = "daily_fixture";

export function dailyPage(start = 1, count = 7): ActivityPage {
  return {
    handle: dailyHandle,
    from: 1,
    count: 50,
    submissions: Array.from({ length: count }, (_, index) => {
      const id = start + index;
      return {
        id,
        submittedAt: new Date(
          Date.parse("2026-10-05T06:00:00Z") + id * 60000,
        ).toISOString(),
        verdict: "OK",
        language: "GNU C++20",
        problem: {
          key: `contest:${2000 + id}:A`,
          title: `Daily reflection fixture ${id}`,
          code: `${2000 + id}A`,
          url: `https://codeforces.com/problemset/problem/${2000 + id}/A`,
          rating: 1000,
          tags: ["implementation"],
        },
      };
    }),
  };
}

/** Yesterday has five commitments: one reflected, two skipped, two pending.
 * Two older pending records remain available for tomorrow's four-item batch. */
export function dailyFixture(day: Date): Data {
  let data = mergeActivity(
    connectProfile(
      emptyData(),
      { handle: dailyHandle, rating: 1400, rank: "specialist" },
      day,
    ),
    dailyHandle,
    [dailyPage()],
    "refresh",
    day,
  );
  const batch = dailyReflectionBatch(data, dailyHandle, day);
  data = saveQuickReflection(
    data,
    batch[0].id,
    {
      outcome: "independent",
      difficulty: null,
      takeaway: "Already reflected yesterday.",
      reviewAt: null,
      overrideSchedule: true,
    },
    day,
  );
  data = skipReflection(data, batch[1].id);
  return skipReflection(data, batch[2].id);
}
