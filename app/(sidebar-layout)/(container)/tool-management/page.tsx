'use client';

import { ListToolsResultSchema } from '@modelcontextprotocol/sdk/types.js';
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { Copy, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import useSWR, { useSWRConfig } from 'swr';

import { getFirstApiKey } from '@/app/actions/api-keys';
import { getMcpServers } from '@/app/actions/mcp-servers';
import { updateProfileCapabilities } from '@/app/actions/profiles';
import {
  getToolsByMcpServerUuid,
  saveToolsToDatabase,
  toggleToolStatus,
} from '@/app/actions/tools';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  McpServerStatus,
  ProfileCapability,
  ToggleStatus,
  WorkspaceMode,
} from '@/db/schema';
import { useProfiles } from '@/hooks/use-profiles';
import { useProjects } from '@/hooks/use-projects';
import { useToast } from '@/hooks/use-toast';
import { useConnectionMulti } from '@/hooks/useConnectionMulti';

export default function ToolsManagementPage() {
  const { currentProfile, mutateActiveProfile } = useProfiles();
  const { currentProject } = useProjects();
  const { toast } = useToast();
  const [expandedServers, setExpandedServers] = useState<Set<string>>(
    new Set()
  );
  const [refreshingServers, setRefreshingServers] = useState<Set<string>>(
    new Set()
  );
  const { mutate: globalMutate } = useSWRConfig();

  const { connectionStatuses, connect, disconnect, makeRequest } =
    useConnectionMulti();

  const hasToolsManagement = currentProfile?.enabled_capabilities?.includes(
    ProfileCapability.TOOLS_MANAGEMENT
  );

  const { data: mcpServers, mutate: mutateMcpServers } = useSWR(
    currentProfile?.uuid ? ['getMcpServers', currentProfile.uuid] : null,
    () => getMcpServers(currentProfile?.uuid || '', McpServerStatus.ACTIVE)
  );

  // Auto-expand all servers when data is loaded
  useEffect(() => {
    if (mcpServers) {
      setExpandedServers(new Set(mcpServers.map((server) => server.uuid)));
    }
  }, [mcpServers]);

  const { data: apiKey } = useSWR(
    currentProject?.uuid ? `${currentProject?.uuid}/api-keys/getFirst` : null,
    () => getFirstApiKey(currentProject?.uuid || '')
  );

  const allToolsData = useSWR(
    mcpServers && mcpServers.length > 0
      ? ['allTools', mcpServers.map((s) => s.uuid)]
      : null,
    async () => {
      const results = await Promise.all(
        mcpServers!.map((server) => getToolsByMcpServerUuid(server.uuid))
      );
      return results.flat();
    }
  );

  // Calculate global tool counts
  const globalTotalTools = allToolsData.data?.length || 0;
  const globalEnabledTools =
    allToolsData.data?.filter((tool) => tool.status === ToggleStatus.ACTIVE)
      .length || 0;

  // Function to refresh global tools data
  const refreshGlobalTools = () => {
    allToolsData.mutate();
  };

  const toggleServerExpansion = (serverUuid: string) => {
    const newExpanded = new Set(expandedServers);
    if (newExpanded.has(serverUuid)) {
      newExpanded.delete(serverUuid);
    } else {
      newExpanded.add(serverUuid);
    }
    setExpandedServers(newExpanded);
  };

  // Function to refresh tools for a specific SSE server
  const refreshSseTools = async (serverUuid: string) => {
    if (!currentProfile?.uuid) {
      toast({
        title: 'Error',
        description: 'Profile information is missing',
        variant: 'destructive',
      });
      return;
    }

    try {
      // Mark this server as refreshing
      setRefreshingServers((prev) => new Set([...prev, serverUuid]));

      // Connect to the server
      await connect(serverUuid);

      // Request the tool list
      const response = await makeRequest(
        serverUuid,
        {
          method: 'tools/list',
          params: {},
        },
        ListToolsResultSchema
      );

      // Save tools to the database
      if (response.tools.length > 0) {
        await saveToolsToDatabase(serverUuid, response.tools);

        // Force refresh data in the database
        await getToolsByMcpServerUuid(serverUuid);

        // Refresh the UI by mutating the SWR cache for this server's tools
        globalMutate(['getToolsByMcpServerUuid', serverUuid]);

        toast({
          description: `${response.tools.length} tools refreshed successfully`,
        });
      } else {
        toast({
          description: 'No tools found to refresh',
        });

        // Still refresh the UI in case tools were removed
        globalMutate(['getToolsByMcpServerUuid', serverUuid]);
      }
    } catch (error) {
      console.error('Error refreshing SSE tools:', error);
      toast({
        variant: 'destructive',
        title: 'Error refreshing tools',
        description:
          error instanceof Error ? error.message : 'An unknown error occurred',
      });
    } finally {
      // Disconnect from the server
      try {
        await disconnect(serverUuid);
      } catch (disconnectError) {
        console.error('Error disconnecting:', disconnectError);
      }

      // Mark this server as no longer refreshing
      setRefreshingServers((prev) => {
        const next = new Set([...prev]);
        next.delete(serverUuid);
        return next;
      });
    }
  };

  const handleToggleToolsManagement = async (checked: boolean) => {
    if (!currentProfile) return;

    const newCapabilities = checked
      ? [
          ...(currentProfile.enabled_capabilities || []),
          ProfileCapability.TOOLS_MANAGEMENT,
        ]
      : (currentProfile.enabled_capabilities || []).filter(
          (cap) => cap !== ProfileCapability.TOOLS_MANAGEMENT
        );

    try {
      await updateProfileCapabilities(currentProfile.uuid, newCapabilities);
      await Promise.all([mutateActiveProfile(), mutateMcpServers()]);
      toast({
        description: checked
          ? 'Tool Management enabled'
          : 'Tool Management disabled',
      });
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Error updating capabilities',
        description:
          error instanceof Error ? error.message : 'An unknown error occurred',
      });
    }
  };

  if (!mcpServers) return <div>Loading...</div>;

  return (
    <div className='container mx-auto px-4 py-8'>
      <div className='flex justify-between items-center mb-8'>
        <div>
          <h1 className='text-3xl font-bold'>Tool Management</h1>
          <p className='text-muted-foreground mt-2'>
            Manage all tools across your active MCP servers
          </p>
          {hasToolsManagement && (
            <div className='mt-3 text-sm'>
              <span className='font-medium text-green-600'>
                {globalEnabledTools} enabled
              </span>
              <span className='mx-2 text-muted-foreground'>•</span>
              <span className='font-medium text-foreground'>
                {globalTotalTools} total tools
              </span>
              <span className='ml-2 text-muted-foreground'>
                across all servers
              </span>
            </div>
          )}
        </div>
        <div className='flex items-center space-x-2'>
          <Switch
            id='tool-management'
            checked={hasToolsManagement}
            onCheckedChange={handleToggleToolsManagement}
          />
          <Label htmlFor='tool-management'>Enable Tool Management</Label>
        </div>
      </div>

      {!hasToolsManagement ? (
        <Card>
          <CardContent className='pt-6'>
            <p className='text-muted-foreground'>
              Tool Management is currently disabled. Enable it to manage your
              tools.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className='space-y-6'>
          {mcpServers.map((server) => (
            <Card key={server.uuid} className='shadow-none'>
              <CardHeader className='pb-4'>
                <div className='flex items-center justify-between'>
                  <div>
                    <CardTitle className='text-xl'>{server.name}</CardTitle>
                    <CardDescription>
                      {server.description || 'No description'}
                    </CardDescription>
                  </div>
                  <div className='flex items-center gap-2'>
                    {server.type === 'SSE' ||
                    currentProfile?.workspace_mode === WorkspaceMode.REMOTE ? (
                      <Button
                        size='sm'
                        onClick={() => refreshSseTools(server.uuid)}
                        disabled={
                          refreshingServers.has(server.uuid) ||
                          connectionStatuses[server.uuid] === 'connecting'
                        }>
                        {refreshingServers.has(server.uuid) ||
                        connectionStatuses[server.uuid] === 'connecting' ? (
                          <>
                            <div className='mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent' />
                            {connectionStatuses[server.uuid] === 'connecting'
                              ? 'Connecting...'
                              : 'Refreshing...'}
                          </>
                        ) : (
                          <>
                            <RefreshCw className='mr-2 h-4 w-4' />
                            Refresh
                          </>
                        )}
                      </Button>
                    ) : (
                      <Dialog>
                        <DialogTrigger asChild>
                          <Button size='sm'>
                            <RefreshCw className='mr-2 h-4 w-4' />
                            Refresh
                          </Button>
                        </DialogTrigger>
                        <DialogContent className='w-full max-w-4xl'>
                          <DialogHeader>
                            <DialogTitle>Refresh Tools</DialogTitle>
                          </DialogHeader>
                          <div className='py-4'>
                            <p className='mb-4'>
                              In <b>Compatibility (Local) mode</b>,
                              Command-based MCP servers need to run locally. On
                              next time you run MetaMCP MCP server, it will
                              automatically refresh tools. To refresh tools
                              manually for all installed MCP servers, run the
                              following command:
                            </p>
                            <div className='relative'>
                              <Button
                                size='sm'
                                variant='outline'
                                className='absolute top-2 right-2 z-10'
                                onClick={() => {
                                  const command = `npx -y @metamcp/mcp-server-metamcp@latest --metamcp-api-key=${apiKey?.api_key ?? '<create an api key first>'} --metamcp-api-base-url ${process.env.NEXT_PUBLIC_METATOOL_APP_URL} --report`;
                                  navigator.clipboard.writeText(command);
                                  toast({
                                    description: 'Command copied to clipboard',
                                  });
                                }}>
                                <Copy className='h-4 w-4' />
                              </Button>
                              <div className='overflow-x-auto max-w-full'>
                                <pre className='bg-[#f6f8fa] text-[#24292f] p-4 rounded-md whitespace-pre-wrap break-words'>
                                  {`npx -y @metamcp/mcp-server-metamcp@latest --metamcp-api-key=${apiKey?.api_key ?? '<create an api key first>'} --metamcp-api-base-url ${process.env.NEXT_PUBLIC_METATOOL_APP_URL} --report`}
                                </pre>
                              </div>
                            </div>
                            <p className='mt-4 text-sm text-muted-foreground'>
                              After running the command, your tools will be
                              refreshed.
                            </p>
                          </div>
                        </DialogContent>
                      </Dialog>
                    )}
                    <Button
                      variant='ghost'
                      size='sm'
                      onClick={() => toggleServerExpansion(server.uuid)}>
                      {expandedServers.has(server.uuid)
                        ? 'Hide Tools'
                        : 'Show Tools'}
                    </Button>
                  </div>
                </div>
              </CardHeader>
              {expandedServers.has(server.uuid) && (
                <CardContent>
                  <ToolsList
                    mcpServerUuid={server.uuid}
                    onToolToggle={refreshGlobalTools}
                  />
                </CardContent>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function ToolsList({
  mcpServerUuid,
  onToolToggle,
}: {
  mcpServerUuid: string;
  onToolToggle?: () => void;
}) {
  const {
    data: tools,
    error,
    mutate,
  } = useSWR(
    mcpServerUuid ? ['getToolsByMcpServerUuid', mcpServerUuid] : null,
    () => getToolsByMcpServerUuid(mcpServerUuid)
  );

  // Calculate enabled vs total tools
  const totalTools = tools?.length || 0;
  const enabledTools =
    tools?.filter((tool) => tool.status === ToggleStatus.ACTIVE).length || 0;

  const columnHelper = createColumnHelper<any>();

  const columns = [
    columnHelper.accessor('name', {
      cell: (info) => info.getValue(),
      header: 'Name',
    }),
    columnHelper.accessor('description', {
      cell: (info) => info.getValue() || '-',
      header: 'Description',
    }),
    columnHelper.accessor('status', {
      cell: (info) => (
        <Switch
          checked={info.getValue() === ToggleStatus.ACTIVE}
          onCheckedChange={async (checked) => {
            await toggleToolStatus(
              info.row.original.uuid,
              checked ? ToggleStatus.ACTIVE : ToggleStatus.INACTIVE
            );
            mutate();
            onToolToggle?.();
          }}
        />
      ),
      header: 'Status',
    }),
    columnHelper.accessor('created_at', {
      cell: (info) => new Date(info.getValue()).toLocaleString(),
      header: 'Reported At',
    }),
  ];

  const table = useReactTable({
    data: tools || [],
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  if (error) return <div>Failed to load tools</div>;
  if (!tools) return <div>Loading tools...</div>;
  if (tools.length === 0) return <div>No tools found for this MCP server.</div>;

  return (
    <div>
      <div className='mb-4 flex items-center justify-between'>
        <div className='text-sm text-muted-foreground'>
          <span className='font-medium text-green-600'>
            {enabledTools} enabled
          </span>
          <span className='mx-2'>•</span>
          <span className='font-medium'>{totalTools} total tools</span>
        </div>
      </div>
      <div className='overflow-x-auto'>
        <table className='min-w-full bg-white border border-gray-300'>
          <thead>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <th
                    key={header.id}
                    className='py-2 px-4 border-b text-left font-semibold bg-gray-100'>
                    {flexRender(
                      header.column.columnDef.header,
                      header.getContext()
                    )}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id} className='hover:bg-gray-50'>
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className='py-2 px-4 border-b'>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
