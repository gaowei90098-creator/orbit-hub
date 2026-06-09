// 生成"如何启动 orbit CLI"的命令片段，供两处复用：
//   1) cli.ts 启动横幅里的连接命令；
//   2) routes.ts /api/connect 给 Claude Code / Codex 生成的连接配置。
// 两处必须一致，否则用户从横幅和从面板拿到的命令会不同。
//
// 关键决策：command 用稳定的 "node"（依赖 PATH），而不是 process.execPath。
// process.execPath 在 homebrew 下是 /opt/homebrew/Cellar/node/<版本号>/bin/node，
// 带版本号——一旦 `brew upgrade node`，该路径失效，而 Codex 已把它持久化进
// config.toml，会导致连接静默断开且用户无从排查。Claude Code 与 Codex 本身都是
// node 程序，运行时 PATH 必然有 node，所以 "node" 既稳定又可用。

export interface LaunchParts {
  command: string;
  baseArgs: string[];
}

// cliPath：orbit CLI 入口的绝对路径（dist/cli.js，或开发期的 src/cli.ts）。
export function launchParts(cliPath: string): LaunchParts {
  return cliPath.endsWith(".ts")
    ? { command: "npx", baseArgs: ["tsx", cliPath] }
    : { command: "node", baseArgs: [cliPath] };
}
