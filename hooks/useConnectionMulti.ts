import { auth } from '@modelcontextprotocol/sdk/client/auth.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  SSEClientTransport,
  SseError,
} from '@modelcontextprotocol/sdk/client/sse.js';
import { RequestOptions } from '@modelcontextprotocol/sdk/shared/protocol.js';
import {
  ClientNotification,
  ClientRequest,
} from '@modelcontextprotocol/sdk/types.js';
import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';

import { getMcpServerByUuid } from '@/app/actions/mcp-servers';
import { McpServerType } from '@/db/schema';
import { useProfiles } from '@/hooks/use-profiles';
import { useToast } from '@/hooks/use-toast';
import { ConnectionStatus, SESSION_KEYS } from '@/lib/constants';
import {
  Notification,
  StdErrNotificationSchema,
} from '@/lib/notificationTypes';
import { createAuthProvider } from '@/lib/oauth-provider';
import packageJson from '@/package.json';

interface UseConnectionMultiOptions {
  onNotification?: (serverUuid: string, notification: Notification) => void;
  onStdErrNotification?: (
    serverUuid: string,
    notification: Notification
  ) => void;
}

export function useConnectionMulti({
  onNotification,
  onStdErrNotification,
}: UseConnectionMultiOptions = {}) {
  const { currentProfile } = useProfiles();
  const { toast } = useToast();
  const [activeConnections, setActiveConnections] = useState<
    Record<string, boolean>
  >({});
  const [connectionStatuses, setConnectionStatuses] = useState<
    Record<string, ConnectionStatus>
  >({});
  const clientsRef = useRef<Record<string, Client | null>>({});

  // Function to create a notification handler for a specific server
  const createNotificationHandler = (
    serverUuid: string,
    handler?: (serverUuid: string, notification: Notification) => void
  ) => {
    if (!handler) return undefined;
    return (notification: Notification) => {
      handler(serverUuid, notification);
    };
  };

  // Utility function to check if the MCP proxy is healthy
  const checkProxyHealth = async () => {
    try {
      const proxyHealthUrl = new URL(
        process.env.USE_DOCKER_HOST === 'true'
          ? `${process.env.NEXT_PUBLIC_INTERNAL_REMOTE_HOSTING_URL}/health`
          : `${process.env.NEXT_PUBLIC_REMOTE_HOSTING_URL}/health`
      );
      const proxyHealthResponse = await fetch(proxyHealthUrl);
      const proxyHealth = await proxyHealthResponse.json();
      if (proxyHealth?.status !== 'ok') {
        throw new Error('MCP Proxy Server is not healthy');
      }
    } catch (e) {
      console.error("Couldn't connect to MCP Proxy Server", e);
      throw e;
    }
  };

  // Handle OAuth authentication errors
  const handleAuthError = async (
    serverUuid: string,
    error: unknown,
    serverUrl: string
  ) => {
    const authProvider = createAuthProvider(serverUuid, currentProfile?.uuid);

    if (error instanceof SseError && error.code === 401) {
      sessionStorage.setItem(SESSION_KEYS.SERVER_URL, serverUrl || '');
      sessionStorage.setItem(SESSION_KEYS.MCP_SERVER_UUID, serverUuid);
      if (currentProfile?.uuid) {
        sessionStorage.setItem(SESSION_KEYS.PROFILE_UUID, currentProfile.uuid);
      }

      const result = await auth(authProvider, {
        serverUrl: serverUrl || '',
      });
      return result === 'AUTHORIZED';
    }

    return false;
  };

  // Connect to a specific server
  const connect = async (serverUuid: string): Promise<void> => {
    if (!currentProfile?.uuid) {
      toast({
        title: 'Error',
        description: 'Profile information is missing',
        variant: 'destructive',
      });
      setConnectionStatuses((prev) => ({ ...prev, [serverUuid]: 'error' }));
      return;
    }

    // Get server details
    const mcpServer = await getMcpServerByUuid(currentProfile.uuid, serverUuid);
    if (!mcpServer) {
      toast({
        title: 'Error',
        description: 'MCP server data not available',
        variant: 'destructive',
      });
      setConnectionStatuses((prev) => ({ ...prev, [serverUuid]: 'error' }));
      return;
    }

    // Update connection status
    setConnectionStatuses((prev) => ({ ...prev, [serverUuid]: 'connecting' }));

    // Create a client
    const client = new Client(
      {
        name: 'mcp-inspector',
        version: packageJson.version,
      },
      {
        capabilities: {
          sampling: {},
          roots: {
            listChanged: true,
          },
          tools: {},
        },
      }
    );

    // Set client in ref
    clientsRef.current[serverUuid] = client;

    // Check proxy health
    try {
      await checkProxyHealth();
    } catch {
      setConnectionStatuses((prev) => ({
        ...prev,
        [serverUuid]: 'error-connecting-to-proxy',
      }));
      return;
    }

    // Create proxy URL
    const mcpProxyServerUrl = new URL(
      process.env.USE_DOCKER_HOST === 'true'
        ? `${process.env.NEXT_PUBLIC_INTERNAL_REMOTE_HOSTING_URL}/server/${serverUuid}/sse`
        : `${process.env.NEXT_PUBLIC_REMOTE_HOSTING_URL}/server/${serverUuid}/sse`
    );
    mcpProxyServerUrl.searchParams.append(
      'transportType',
      mcpServer.type.toLowerCase()
    );
    if (mcpServer.type === McpServerType.STDIO) {
      mcpProxyServerUrl.searchParams.append('command', mcpServer.command || '');
      mcpProxyServerUrl.searchParams.append('args', mcpServer.args.join(' '));
      mcpProxyServerUrl.searchParams.append(
        'env',
        JSON.stringify(mcpServer.env)
      );
    } else {
      mcpProxyServerUrl.searchParams.append('url', mcpServer.url || '');
    }

    try {
      // Get auth provider
      const authProvider = createAuthProvider(serverUuid, currentProfile.uuid);

      // Prepare auth headers
      const headers: HeadersInit = {};
      const token = (await authProvider.tokens())?.access_token;
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      // Create transport
      const clientTransport = new SSEClientTransport(mcpProxyServerUrl, {
        eventSourceInit: {
          fetch: (url, init) => fetch(url, { ...init, headers }),
        },
        requestInit: {
          headers,
        },
      });

      // Set up notification handlers
      if (onNotification) {
        const serverNotificationHandler = createNotificationHandler(
          serverUuid,
          onNotification
        );
        client.fallbackNotificationHandler = (
          notification: Notification
        ): Promise<void> => {
          if (serverNotificationHandler) {
            serverNotificationHandler(notification);
          }
          return Promise.resolve();
        };
      }

      if (onStdErrNotification) {
        const serverStdErrHandler = createNotificationHandler(
          serverUuid,
          onStdErrNotification
        );
        if (serverStdErrHandler) {
          client.setNotificationHandler(
            StdErrNotificationSchema,
            serverStdErrHandler
          );
        }
      }

      // Connect to the server
      try {
        await client.connect(clientTransport);
      } catch (error) {
        console.error(
          `Failed to connect to MCP Server via the MCP Inspector Proxy: ${mcpProxyServerUrl}:`,
          error
        );

        // Try to handle auth errors
        const shouldRetry = await handleAuthError(
          serverUuid,
          error,
          mcpServer.url || ''
        );
        if (shouldRetry) {
          // Try connecting again
          setConnectionStatuses((prev) => ({
            ...prev,
            [serverUuid]: 'disconnected',
          }));
          return connect(serverUuid);
        }

        if (error instanceof SseError && error.code === 401) {
          // Don't set error state if we're about to redirect for auth
          return;
        }

        throw error;
      }

      // Successfully connected
      setConnectionStatuses((prev) => ({ ...prev, [serverUuid]: 'connected' }));
      setActiveConnections((prev) => ({ ...prev, [serverUuid]: true }));
    } catch (error) {
      console.error(`Error connecting to server ${serverUuid}:`, error);
      setConnectionStatuses((prev) => ({ ...prev, [serverUuid]: 'error' }));

      // Clean up
      clientsRef.current[serverUuid] = null;
      throw error;
    }
  };

  // Disconnect from a specific server
  const disconnect = async (serverUuid: string): Promise<void> => {
    const client = clientsRef.current[serverUuid];
    if (client) {
      try {
        await client.close();
      } catch (error) {
        console.error(`Error disconnecting from server ${serverUuid}:`, error);
      } finally {
        clientsRef.current[serverUuid] = null;
        setConnectionStatuses((prev) => ({
          ...prev,
          [serverUuid]: 'disconnected',
        }));
        setActiveConnections((prev) => {
          const result = { ...prev };
          delete result[serverUuid];
          return result;
        });
      }
    }
  };

  // Make a request to a specific server
  const makeRequest = async <T extends z.ZodType>(
    serverUuid: string,
    request: ClientRequest,
    schema: T,
    options?: RequestOptions & { suppressToast?: boolean }
  ): Promise<z.output<T>> => {
    const client = clientsRef.current[serverUuid];
    if (!client) {
      throw new Error(`MCP client not connected for server ${serverUuid}`);
    }

    try {
      const abortController = new AbortController();

      // Prepare request options
      const mcpRequestOptions: RequestOptions = {
        signal: options?.signal ?? abortController.signal,
        resetTimeoutOnProgress: options?.resetTimeoutOnProgress ?? true,
        timeout: options?.timeout ?? 6000,
        maxTotalTimeout: options?.maxTotalTimeout ?? 6000,
      };

      // Add progress handler if needed
      if (mcpRequestOptions.resetTimeoutOnProgress && onNotification) {
        const serverNotificationHandler = createNotificationHandler(
          serverUuid,
          onNotification
        );
        mcpRequestOptions.onprogress = (params) => {
          if (serverNotificationHandler) {
            serverNotificationHandler({
              method: 'notification/progress',
              params,
            });
          }
        };
      }

      // Make the request
      return await client.request(request, schema, mcpRequestOptions);
    } catch (error) {
      if (!options?.suppressToast) {
        const errorString =
          error instanceof Error ? error.message : String(error);
        toast({
          title: 'Error',
          description: errorString,
          variant: 'destructive',
        });
      }
      throw error;
    }
  };

  // Send a notification to a specific server
  const sendNotification = async (
    serverUuid: string,
    notification: ClientNotification
  ): Promise<void> => {
    const client = clientsRef.current[serverUuid];
    if (!client) {
      throw new Error(`MCP client not connected for server ${serverUuid}`);
    }

    await client.notification(notification);
  };

  // Get connection status for a specific server
  const getConnectionStatus = (serverUuid: string): ConnectionStatus => {
    return connectionStatuses[serverUuid] || 'disconnected';
  };

  // Disconnect from all servers
  const disconnectAll = async (): Promise<void> => {
    const disconnectPromises = Object.keys(activeConnections).map(
      (serverUuid) => disconnect(serverUuid)
    );
    await Promise.all(disconnectPromises);
  };

  // Clean up on unmount
  useEffect(() => {
    // Capture the current ref value inside the effect
    const currentClients = clientsRef.current;

    return () => {
      // Use the captured value in the cleanup function
      Object.entries(currentClients).forEach(([_, client]) => {
        if (client) {
          client.close().catch(console.error);
        }
      });
    };
  }, []);

  return {
    activeConnections,
    connectionStatuses,
    getConnectionStatus,
    connect,
    disconnect,
    disconnectAll,
    makeRequest,
    sendNotification,
  };
}
