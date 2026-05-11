import { dreamProposalSchema, engramMemorySchema } from "@/lib/events/schema";
import { configuredDreamPlanner } from "@/lib/memory/planner-config";
import type { EngramMemory } from "@/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    clientMemories?: unknown;
    now?: string;
  };

  try {
    const planner = configuredDreamPlanner();
    const proposal = await planner.decide({
      memories: parseClientMemories(body.clientMemories),
      now: body.now
    });

    return Response.json({ proposal: dreamProposalSchema.parse(proposal) });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Dream review failed."
      },
      { status: 500 }
    );
  }
}

function parseClientMemories(input: unknown): EngramMemory[] {
  if (!Array.isArray(input)) return [];

  return input.flatMap((memory) => {
    const result = engramMemorySchema.safeParse(memory);
    return result.success ? [result.data] : [];
  });
}
