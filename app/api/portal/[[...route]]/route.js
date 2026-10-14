import handler from '../../../../handlers/portal.js';
import { callHandler } from '../../../../lib/next/call-handler.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function run(request, context) {
  const params = await context.params;
  const route = params.route || [];
  return callHandler(handler, request, { route });
}

export const GET = run;
export const POST = run;
export const PUT = run;
export const PATCH = run;
export const DELETE = run;
export const OPTIONS = run;
