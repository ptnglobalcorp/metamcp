import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { db } from '@/db';
import { profilesTable } from '@/db/schema';
import { retryDbQuery } from '@/lib/utils';

import { authenticateApiKey } from '../auth';

export async function GET(request: Request) {
  try {
    const auth = await authenticateApiKey(request);
    if (auth.error) return auth.error;

    const profile = await retryDbQuery(() =>
      db
        .select({
          enabled_capabilities: profilesTable.enabled_capabilities,
        })
        .from(profilesTable)
        .where(eq(profilesTable.uuid, auth.activeProfile.uuid))
        .limit(1)
    );

    if (profile.length === 0) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
    }

    return NextResponse.json({
      profileCapabilities: profile[0].enabled_capabilities,
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: 'Failed to fetch profile capabilities' },
      { status: 500 }
    );
  }
}
