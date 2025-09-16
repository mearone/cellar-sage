// Optional Next.js route to trigger validation via HTTP: /api/validate-fees
import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import path from "node:path";

export async function GET() {
  return new Promise((resolve) => {
    const script = path.join(process.cwd(), "scripts", "validate-fees.ts");
    const npxBin = process.platform === "win32" ? "npx.cmd" : "npx";
    const child = spawn(npxBin, ["tsx", script], { cwd: process.cwd() });

    let out = ""; let err = "";
    child.stdout.on("data", (d) => out += d.toString());
    child.stderr.on("data", (d) => err += d.toString());
    child.on("close", (code) => resolve(NextResponse.json({ code, out, err })));
  });
}
