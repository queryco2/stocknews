import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { projectRoot } from "./store.ts";

export function workBuddyTaskUrl(prompt: string) {
  const url = new URL("workbuddy://task");
  url.searchParams.set("action", "start");
  url.searchParams.set("prompt", prompt);
  url.searchParams.set("cwd", projectRoot);
  return url.toString();
}

// WorkBuddy 5.5.6 task links prepare a draft; they do not auto-send it.
export async function openWorkBuddy(prompt: string) {
  if (process.platform !== "darwin")
    throw new Error("当前仅支持 macOS WorkBuddy");
  await promisify(execFile)("/usr/bin/open", [workBuddyTaskUrl(prompt)], {
    timeout: 10000,
  });
}
