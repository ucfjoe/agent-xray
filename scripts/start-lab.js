import { spawn } from "node:child_process";
import { resolve, join } from "node:path";
const root = resolve(import.meta.dirname, "..");
const args = ["web", "--no-open", "--port", process.env.XRAY_PORT || "3080"];
if (
  process.env.CODESPACE_NAME &&
  process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN
) {
  args.push(
    "--trusted-host",
    process.env.CODESPACE_NAME +
      "-" +
      (process.env.XRAY_PORT || "3080") +
      "." +
      process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN,
  );
}
const child = spawn(process.env.DSH_BIN || "dsh", args, {
  stdio: "inherit",
  env: {
    ...process.env,
    DSH_HOME: join(root, ".lab", "dsh-home"),
    XRAY_TEST_REPOSITORY: join(root, ".lab", "sample-repo"),
  },
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));
child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
