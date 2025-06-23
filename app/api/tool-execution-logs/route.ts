import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { db } from '@/db';
import {
  mcpServersTable,
  toolExecutionLogsTable,
  ToolExecutionStatus,
} from '@/db/schema';
import { retryDbQuery } from '@/lib/utils';

import { authenticateApiKey } from '../auth';

export async function POST(request: Request) {
  try {
    const auth = await authenticateApiKey(request);
    if (auth.error) return auth.error;

    const body = await request.json();
    const {
      mcp_server_uuid,
      tool_name,
      payload,
      result,
      status,
      error_message,
      execution_time_ms,
    } = body;

    // Validate required fields
    if (!tool_name) {
      console.error('Tool name is required');
      return NextResponse.json(
        { error: 'Tool name is required' },
        { status: 400 }
      );
    }

    console.log(
      `Creating tool execution log for: mcp_server_uuid: ${mcp_server_uuid}, tool: ${tool_name}`
    );

    // If mcp_server_uuid is provided, verify it belongs to the authenticated user's active profile
    if (mcp_server_uuid) {
      const mcpServer = await retryDbQuery(() =>
        db
          .select()
          .from(mcpServersTable)
          .where(
            and(
              eq(mcpServersTable.uuid, mcp_server_uuid),
              eq(mcpServersTable.profile_uuid, auth.activeProfile.uuid)
            )
          )
          .limit(1)
      );

      if (mcpServer.length === 0) {
        return NextResponse.json(
          { error: 'MCP server not found or does not belong to your profile' },
          { status: 404 }
        );
      }
    }

    // Create new tool execution log entry
    const newToolExecutionLog = await retryDbQuery(() =>
      db
        .insert(toolExecutionLogsTable)
        .values({
          mcp_server_uuid: mcp_server_uuid || null,
          tool_name,
          payload: payload || {},
          result: result || null,
          status: status || ToolExecutionStatus.PENDING,
          error_message: error_message || null,
          execution_time_ms: execution_time_ms || null,
        })
        .returning()
    );

    return NextResponse.json(newToolExecutionLog[0]);
  } catch (error) {
    console.error('Failed to create tool execution log');
    console.error(error);
    return NextResponse.json(
      { error: 'Failed to create tool execution log' },
      { status: 500 }
    );
  }
}
