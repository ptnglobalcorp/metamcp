'use server';

import { eq } from 'drizzle-orm';

import { db } from '@/db';
import { ProfileCapability, profilesTable, WorkspaceMode } from '@/db/schema';
import { projectsTable } from '@/db/schema';
import { retryDbQuery } from '@/lib/utils';

export async function createProfile(
  currentProjectUuid: string,
  name: string,
  mode: string = 'default'
) {
  // Set capabilities based on mode
  const capabilities =
    mode === 'compatibility'
      ? [ProfileCapability.TOOLS_MANAGEMENT, ProfileCapability.TOOL_LOGS]
      : [];

  // Map the mode string to WorkspaceMode enum
  const workspaceMode =
    mode === 'compatibility' ? WorkspaceMode.LOCAL : WorkspaceMode.REMOTE;

  const profile = await retryDbQuery(() =>
    db
      .insert(profilesTable)
      .values({
        name,
        project_uuid: currentProjectUuid,
        enabled_capabilities: capabilities,
        workspace_mode: workspaceMode,
      })
      .returning()
  );

  return profile[0];
}

export async function getProfile(profileUuid: string) {
  const profile = await retryDbQuery(() =>
    db
      .select()
      .from(profilesTable)
      .where(eq(profilesTable.uuid, profileUuid))
      .limit(1)
  );

  if (profile.length === 0) {
    throw new Error('Profile not found');
  }

  return profile[0];
}

export async function getProfiles(currentProjectUuid: string) {
  const profiles = await retryDbQuery(() =>
    db
      .select()
      .from(profilesTable)
      .where(eq(profilesTable.project_uuid, currentProjectUuid))
  );

  return profiles;
}

export async function getProjectActiveProfile(currentProjectUuid: string) {
  const project = await retryDbQuery(() =>
    db
      .select()
      .from(projectsTable)
      .where(eq(projectsTable.uuid, currentProjectUuid))
      .limit(1)
  );

  if (project.length === 0) {
    throw new Error('Project not found');
  }

  const currentProject = project[0];

  // Try to get active profile if set
  if (currentProject.active_profile_uuid) {
    const activeProfile = await retryDbQuery(() =>
      db
        .select()
        .from(profilesTable)
        .where(eq(profilesTable.uuid, currentProject.active_profile_uuid!)) // non-null assertion
        .limit(1)
    );

    if (activeProfile.length > 0) {
      return activeProfile[0];
    }
  }

  // If no active profile or not found, get all profiles
  const profiles = await retryDbQuery(() =>
    db
      .select()
      .from(profilesTable)
      .where(eq(profilesTable.project_uuid, currentProjectUuid))
  );

  // If there are profiles, use the first one and set it as active
  if (profiles.length > 0) {
    await retryDbQuery(() =>
      db
        .update(projectsTable)
        .set({ active_profile_uuid: profiles[0].uuid })
        .where(eq(projectsTable.uuid, currentProjectUuid))
    );

    return profiles[0];
  }

  // If no profiles exist, create a default one
  const defaultProfile = await retryDbQuery(() =>
    db
      .insert(profilesTable)
      .values({
        name: 'Default Workspace',
        project_uuid: currentProjectUuid,
        enabled_capabilities: [], // Default mode has no special capabilities
      })
      .returning()
  );

  // Set it as active
  await retryDbQuery(() =>
    db
      .update(projectsTable)
      .set({ active_profile_uuid: defaultProfile[0].uuid })
      .where(eq(projectsTable.uuid, currentProjectUuid))
  );

  return defaultProfile[0];
}

export async function setProfileActive(
  projectUuid: string,
  profileUuid: string
) {
  const project = await retryDbQuery(() =>
    db
      .select()
      .from(projectsTable)
      .where(eq(projectsTable.uuid, projectUuid))
      .limit(1)
  );

  if (project.length === 0) {
    throw new Error('Project not found');
  }

  const updatedProject = await retryDbQuery(() =>
    db
      .update(projectsTable)
      .set({ active_profile_uuid: profileUuid })
      .where(eq(projectsTable.uuid, projectUuid))
      .returning()
  );

  if (updatedProject.length === 0) {
    throw new Error('Project not found');
  }
}

export async function updateProfileName(profileUuid: string, newName: string) {
  const profile = await retryDbQuery(() =>
    db
      .select()
      .from(profilesTable)
      .where(eq(profilesTable.uuid, profileUuid))
      .limit(1)
  );

  if (profile.length === 0) {
    throw new Error('Profile not found');
  }

  const updatedProfile = await retryDbQuery(() =>
    db
      .update(profilesTable)
      .set({ name: newName })
      .where(eq(profilesTable.uuid, profileUuid))
      .returning()
  );

  return updatedProfile[0];
}

export async function deleteProfile(profileUuid: string) {
  const profile = await retryDbQuery(() =>
    db
      .select()
      .from(profilesTable)
      .where(eq(profilesTable.uuid, profileUuid))
      .limit(1)
  );

  if (profile.length === 0) {
    throw new Error('Profile not found');
  }

  // Check if this is the last profile
  const profileCount = await retryDbQuery(() =>
    db.select().from(profilesTable)
  );

  if (profileCount.length === 1) {
    throw new Error('Cannot delete the last profile');
  }

  await retryDbQuery(() =>
    db.delete(profilesTable).where(eq(profilesTable.uuid, profileUuid))
  );

  return { success: true };
}

export async function setActiveProfile(profileUuid: string) {
  const profile = await retryDbQuery(() =>
    db
      .select()
      .from(profilesTable)
      .where(eq(profilesTable.uuid, profileUuid))
      .limit(1)
  );

  if (profile.length === 0) {
    throw new Error('Profile not found');
  }

  return profile[0];
}

export async function updateProfileCapabilities(
  profileUuid: string,
  capabilities: ProfileCapability[]
) {
  const profile = await retryDbQuery(() =>
    db
      .select()
      .from(profilesTable)
      .where(eq(profilesTable.uuid, profileUuid))
      .limit(1)
  );

  if (profile.length === 0) {
    throw new Error('Profile not found');
  }

  const updatedProfile = await retryDbQuery(() =>
    db
      .update(profilesTable)
      .set({ enabled_capabilities: capabilities })
      .where(eq(profilesTable.uuid, profileUuid))
      .returning()
  );

  return updatedProfile[0];
}
