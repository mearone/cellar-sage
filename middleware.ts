import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PROTECTED = [/^\/admin(\/|$)/, /^\/api\/admin(\/|$)/];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isProtected = PROTECTED.some((re) => re.test(pathname));
  if (!isProtected) return NextResponse.next();

  const user = process.env.ADMIN_USER || "";
  const pass = process.env.ADMIN_PASS || "";
  const auth = req.headers.get("authorization") || "";

  // Decode Basic auth header
  const ok = (() => {
    if (!auth.toLowerCase().startsWith("basic ")) return false;
    try {
      const [, b64] = auth.split(" ");
      const [u, p] = Buffer.from(b64, "base64").toString().split(":");
      return u === user && p === pass;
    } catch {
      return false;
    }
  })();

  if (ok) return NextResponse.next();

  return new NextResponse("Authentication required.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Admin Area"' },
  });
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};
