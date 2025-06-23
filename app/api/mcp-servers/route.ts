import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { db } from '@/db';
import {
  mcpServersTable,
  McpServerStatus,
  oauthSessionsTable,
} from '@/db/schema';
import { retryDbQuery } from '@/lib/utils';

import { authenticateApiKey } from '../auth';

export async function GET(request: Request) {
  try {
    const auth = await authenticateApiKey(request);
    if (auth.error) return auth.error;

    const activeMcpServers = await retryDbQuery(() =>
      db
        .select({
          server: mcpServersTable,
          tokens: oauthSessionsTable.tokens,
        })
        .from(mcpServersTable)
        .leftJoin(
          oauthSessionsTable,
          eq(mcpServersTable.uuid, oauthSessionsTable.mcp_server_uuid)
        )
        .where(
          and(
            eq(mcpServersTable.status, McpServerStatus.ACTIVE),
            eq(mcpServersTable.profile_uuid, auth.activeProfile.uuid)
          )
        )
    );

    // Map the result to include tokens if they exist
    const result = activeMcpServers.map(({ server, tokens }) => ({
      ...server,
      oauth_tokens: tokens || null,
    }));

    return NextResponse.json(result);
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: 'Failed to fetch active MCP servers' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const auth = await authenticateApiKey(request);
    if (auth.error) return auth.error;

    const body = await request.json();
    const { uuid, name, description, command, args, env, status } = body;

    const newMcpServer = await retryDbQuery(() =>
      db
        .insert(mcpServersTable)
        .values({
          uuid,
          name,
          description,
          command,
          args,
          env,
          status,
          profile_uuid: auth.activeProfile.uuid,
        })
        .returning()
    );

    return NextResponse.json(newMcpServer[0]);
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: 'Failed to create MCP server' },
      { status: 500 }
    );
  }
}
