import { scrapedStore, runRefresh } from "../lib/refresh.mjs";

export default async () => {
  await runRefresh(scrapedStore());
};

export const config = { schedule: "0 22,3 * * *" };
