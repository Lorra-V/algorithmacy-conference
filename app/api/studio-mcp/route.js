import handler from '../../../handlers/studio-mcp.js';
import { callHandler } from '../../../lib/next/call-handler.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function run(request) {
  return callHandler(handler, request);
}

export const GET = run;
export const POST = run;
export const PUT = run;
export const PATCH = run;
export const DELETE = run;
export const OPTIONS = run;
