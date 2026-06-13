import type { AgentRun } from "../core/types.js";

// M3.2 /rescue 委派命令：救援停滞/受阻的 worker。
// 纯逻辑（哪些 worker 看起来卡住了）放这里以便单测；真正的唤醒由 run-manager.resume 执行。

// 停滞阈值：在途 worker 超过这么久没有活动就视为可能卡住（对齐前端 timeline 的 STALL_AFTER_MS）。
export const RESCUE_STALL_MS = 5 * 60_000;

// 一个 worker 是否需要救援：
// - waiting_for_input：明确在等输入（被阻塞），与时长无关，永远是救援对象；
// - failed：执行失败，尝试唤醒重试；
// - running / starting：仅当超过停滞阈值（很久没活动）才视为卡住；
// - done / stopped：正常结束或人工停止，不救援。
export function needsRescue(run: AgentRun, now: number, stallMs: number): boolean {
  switch (run.status) {
    case "waiting_for_input":
    case "failed":
      return true;
    case "running":
    case "starting":
      return now - run.updatedAt > stallMs;
    default:
      return false;
  }
}

// 选出某 mission 下需要救援的 worker，最久没活动的排在前面（优先处理）。
export function selectRescueTargets(workers: AgentRun[], now: number, stallMs: number): AgentRun[] {
  return workers
    .filter((w) => needsRescue(w, now, stallMs))
    .sort((a, b) => a.updatedAt - b.updatedAt);
}

// 注入给停滞 worker 的救援提示：先报告进度与卡点，再继续或明确求助。
export function buildRescuePrompt(): string {
  return [
    "你之前在执行一个任务，但已经一段时间没有进展了。请：",
    "1) 简要报告你当前的进度和遇到的卡点；",
    "2) 如果还能继续，就继续把任务完成；",
    "3) 如果确实被阻塞（等待某个决定、缺少信息或权限），用 Orbit 的 send_message 工具说明你需要什么。",
  ].join("\n");
}
