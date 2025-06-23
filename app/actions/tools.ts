'use server';

import { eq, sql } from 'drizzle-orm';

import { db } from '@/db';
import { ToggleStatus, toolsTable } from '@/db/schema';
import { retryDbQuery } from '@/lib/utils';
import { Tool } from '@/types/tool';

export async function getToolsByMcpServerUuid(
  mcpServerUuid: string
): Promise<Tool[]> {
  const tools = await retryDbQuery(() =>
    db
      .select()
      .from(toolsTable)
      .where(eq(toolsTable.mcp_server_uuid, mcpServerUuid))
      .orderBy(toolsTable.name)
  );

  return tools as Tool[];
}

export async function toggleToolStatus(
  toolUuid: string,
  status: ToggleStatus
): Promise<void> {
  await retryDbQuery(() =>
    db
      .update(toolsTable)
      .set({ status: status })
      .where(eq(toolsTable.uuid, toolUuid))
  );
}

export async function saveToolsToDatabase(
  mcpServerUuid: string,
  tools: Array<{
    name: string;
    description?: string;
    inputSchema: Record<string, any>;
  }>
): Promise<{ success: boolean; count: number }> {
  if (!tools || tools.length === 0) {
    return { success: true, count: 0 };
  }

  // Format tools for database insertion
  const toolsToInsert = tools.map((tool) => ({
    name: tool.name,
    description: tool.description || '',
    toolSchema: {
      type: 'object' as const,
      ...tool.inputSchema,
    },
    mcp_server_uuid: mcpServerUuid,
  }));

  // Batch insert all tools with upsert
  const results = await retryDbQuery(() =>
    db
      .insert(toolsTable)
      .values(toolsToInsert)
      .onConflictDoUpdate({
        target: [toolsTable.mcp_server_uuid, toolsTable.name],
        set: {
          description: sql`excluded.description`,
          toolSchema: sql`excluded.tool_schema`,
        },
      })
      .returning()
  );

  return { success: true, count: results.length };
}
