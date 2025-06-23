import { sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { db } from '@/db';
import { mcpServersTable, toolsTable } from '@/db/schema';
import { retryDbQuery } from '@/lib/utils';

import { authenticateApiKey } from '../auth';

export async function POST(request: Request) {
  try {
    const auth = await authenticateApiKey(request);
    if (auth.error) return auth.error;

    const body = await request.json();
    const { tools } = body;

    // Validate that tools is an array
    if (!Array.isArray(tools) || tools.length === 0) {
      return NextResponse.json(
        { error: 'Request must include a non-empty array of tools' },
        { status: 400 }
      );
    }

    // Validate required fields for all tools and prepare for batch insertion
    const validTools: Array<{
      name: string;
      description?: string;
      toolSchema: any;
      mcp_server_uuid: string;
    }> = [];
    const errors = [];

    for (const tool of tools) {
      const { name, description, toolSchema, mcp_server_uuid } = tool;

      // Validate required fields for each tool
      if (!name || !toolSchema || !mcp_server_uuid) {
        errors.push({
          tool,
          error:
            'Missing required fields: name, toolSchema, or mcp_server_uuid',
        });
        continue;
      }

      validTools.push({
        name,
        description,
        toolSchema,
        mcp_server_uuid,
      });
    }

    // Batch insert all valid tools with upsert
    let results: any[] = [];
    if (validTools.length > 0) {
      try {
        results = await retryDbQuery(() =>
          db
            .insert(toolsTable)
            .values(validTools)
            .onConflictDoUpdate({
              target: [toolsTable.mcp_server_uuid, toolsTable.name],
              set: {
                description: sql`excluded.description`,
                toolSchema: sql`excluded.tool_schema`,
              },
            })
            .returning()
        );
      } catch (error: any) {
        // Handle database errors for the batch operation
        console.error('Database error:', error);
        return NextResponse.json(
          {
            error: 'Failed to process tools request',
            details:
              error.code === '23503'
                ? 'One or more MCP servers not found or not associated with the active profile'
                : 'Database error occurred',
          },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({
      results,
      errors,
      success: results.length > 0,
      failureCount: errors.length,
      successCount: results.length,
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: 'Failed to process tools request' },
      { status: 500 }
    );
  }
}

export async function GET(request: Request) {
  try {
    const auth = await authenticateApiKey(request);
    if (auth.error) return auth.error;

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');

    // Join with mcp_servers table to filter by profile_uuid
    const query = db
      .select({
        mcp_server_uuid: toolsTable.mcp_server_uuid,
        name: toolsTable.name,
        status: toolsTable.status,
      })
      .from(toolsTable)
      .innerJoin(
        mcpServersTable,
        sql`${toolsTable.mcp_server_uuid} = ${mcpServersTable.uuid}`
      )
      .where(
        sql`${mcpServersTable.profile_uuid} = ${auth.activeProfile.uuid}${
          status ? sql` AND ${toolsTable.status} = ${status}` : sql``
        }`
      );

    const results = await retryDbQuery(() => query);

    return NextResponse.json({ results });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: 'Failed to fetch tools' },
      { status: 500 }
    );
  }
}
