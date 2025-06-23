'use server';

import {
  OAuthClientInformation,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import { eq } from 'drizzle-orm';

import { db } from '@/db';
import { oauthSessionsTable } from '@/db/schema';
import { retryDbQuery } from '@/lib/utils';

export async function saveOAuthSession({
  mcpServerUuid,
  clientInformation,
  tokens,
  codeVerifier,
}: {
  mcpServerUuid: string;
  clientInformation?: OAuthClientInformation;
  tokens?: OAuthTokens;
  codeVerifier?: string;
}) {
  // Check if session exists
  const existingSession = await retryDbQuery(() =>
    db.query.oauthSessionsTable.findFirst({
      where: eq(oauthSessionsTable.mcp_server_uuid, mcpServerUuid),
    })
  );

  if (existingSession) {
    // Update existing session
    await retryDbQuery(() =>
      db
        .update(oauthSessionsTable)
        .set({
          ...(clientInformation && { client_information: clientInformation }),
          ...(tokens && { tokens }),
          ...(codeVerifier && { code_verifier: codeVerifier }),
          updated_at: new Date(),
        })
        .where(eq(oauthSessionsTable.mcp_server_uuid, mcpServerUuid))
    );
  } else if (clientInformation) {
    // Create new session (require client_information for creation)
    await retryDbQuery(() =>
      db.insert(oauthSessionsTable).values({
        mcp_server_uuid: mcpServerUuid,
        client_information: clientInformation,
        ...(tokens && { tokens }),
        ...(codeVerifier && { code_verifier: codeVerifier }),
      })
    );
  }
}

export async function getOAuthSession(mcpServerUuid: string) {
  return await retryDbQuery(() =>
    db.query.oauthSessionsTable.findFirst({
      where: eq(oauthSessionsTable.mcp_server_uuid, mcpServerUuid),
    })
  );
}
